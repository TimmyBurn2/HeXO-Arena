import {
    analysisGraceMs,
    analysisSessionResendMs,
    analyzerBenchMs,
    analyzerStrikeLimit,
    analyzerStrikeWindowMs,
    botAnalysisSocketPath,
    bwsHeartbeatPacketSchema,
    bwsInterruptPacketSchema,
    bwsMoveRequestPacketSchema,
    bwsMoveResponsePacketSchema,
    bwsSetupPacketSchema,
    engineStrayFrameCap,
    internalToWire,
    sessionHeartbeatMs,
    sessionTokenTtlMs,
    sideOf,
    streamBacklogLimitBytes,
    type AnalysisFailure,
    type AnalysisLine,
    type AnalysisSessionEvent,
} from '@hexo-arena/contract';
import type { Setup } from '@hexo-arena/rules';
import { checkReading } from './analysis-checks';
import type { EngineSocket } from './game-registry';
import { randomToken } from './tokens';

type Timer = ReturnType<typeof setTimeout>;

// A position to read: the board, the lines the analyzer declared, and the seconds it is given.
interface ReadingAsk {
    readonly setup: Setup;
    readonly lines: number;
    readonly seconds: number;
}

/** How a reading ended: read, failed for the analyzer, or called off with no fault of its. */
export type ReadingOutcome =
    | { readonly kind: `read`; readonly lines: readonly AnalysisLine[]; readonly elapsedMs: number }
    | { readonly kind: `failed`; readonly failure: AnalysisFailure }
    | { readonly kind: `interrupted` };

interface Outstanding {
    readonly requestId: number;
    readonly ask: ReadingAsk;
    readonly sentAt: number;
    readonly timer: Timer;
    readonly settle: (outcome: ReadingOutcome) => void;
    // Takes an answer that comes after the request was called off.
    readonly late: ((lines: readonly AnalysisLine[]) => void) | null;
}

interface Session {
    readonly socket: EngineSocket;
    readonly heartbeat: ReturnType<typeof setInterval>;
    // Frames that answered no outstanding request.
    strays: number;
    requestCounter: number;
    outstanding: Outstanding | null;
    // The latest request called off, whose answer may still arrive and is kept, never judged.
    calledOff: Omit<Outstanding, `timer` | `settle`> | null;
}

interface AnalyzerDeps {
    // Whether the bot holds its stream, so an offer can reach it.
    readonly online: (botId: string) => boolean;
    // Whether the bot declares an analyzer and may read: not delisted, its owner not banned.
    readonly mayAnalyze: (botId: string) => boolean;
    readonly send: (botId: string, event: AnalysisSessionEvent) => void;
    readonly now: () => number;
}

/**
 * Every analyzer's one analysis session: the tokens the stream offers, the
 * htttx basic_websocket exchange with the server as client, one request at a
 * time, and the strikes that bench an analyzer whose readings fail.
 */
export class AnalyzerSessions {
    readonly #deps: AnalyzerDeps;
    readonly #sessions = new Map<string, Session>();
    readonly #tokens = new Map<string, { readonly botId: string; readonly expiresAt: number }>();
    readonly #tokenOf = new Map<string, string>();
    readonly #strikes = new Map<string, number[]>();
    readonly #benchedUntil = new Map<string, number>();
    readonly #resends = new Map<string, Timer>();
    readonly #readyListeners: ((botId: string) => void)[] = [];

    constructor(deps: AnalyzerDeps) {
        this.#deps = deps;
    }

    /** Tells a listener whenever an analyzer dials in; whoever sent a request learns of its end from the request. */
    onReady(listener: (botId: string) => void): void {
        this.#readyListeners.push(listener);
    }

    /**
     * The stream line that hands out a session, with a fresh token that
     * replaces the bot's last; null for a bot that may not analyze.
     */
    offer(botId: string): AnalysisSessionEvent | null {
        if (!this.#deps.mayAnalyze(botId)) return null;
        const previous = this.#tokenOf.get(botId);
        if (previous !== undefined) this.#tokens.delete(previous);
        const token = `has_${randomToken(32)}`;
        this.#tokens.set(token, { botId, expiresAt: this.#deps.now() + sessionTokenTtlMs });
        this.#tokenOf.set(botId, token);
        return { type: `analysisSession`, engine: { socketUrl: botAnalysisSocketPath, token } };
    }

    /** Whether the bot declares an analyzer and may read. */
    mayAnalyze(botId: string): boolean {
        return this.#deps.mayAnalyze(botId);
    }

    /** Sends a fresh offer down the bot's stream, when it holds one. */
    sendOffer(botId: string): void {
        if (!this.#deps.online(botId)) return;
        const offer = this.offer(botId);
        if (offer !== null) this.#deps.send(botId, offer);
    }

    /** The bot an unexpired token belongs to. */
    claim(token: string): string | null {
        const held = this.#tokens.get(token);
        if (held === undefined || held.expiresAt <= this.#deps.now()) return null;
        return held.botId;
    }

    /** Opens the bot's session on `socket`, replacing any it held. */
    attach(botId: string, socket: EngineSocket): void {
        this.#endSession(botId, { kind: `interrupted` }, 1000, `replaced`);
        this.#clearResend(botId);
        const session: Session = {
            socket,
            heartbeat: setInterval(() => {
                this.#send(botId, session, JSON.stringify(bwsHeartbeatPacketSchema.parse({ type: `heartbeat`, waiting: session.outstanding !== null })));
            }, sessionHeartbeatMs),
            strays: 0,
            requestCounter: 0,
            outstanding: null,
            calledOff: null,
        };
        this.#sessions.set(botId, session);
        socket.onceClose(() => {
            if (this.#sessions.get(botId) !== session) return;
            this.#endSession(botId, { kind: `failed`, failure: `disconnect` });
            this.#scheduleResend(botId);
        });
        this.#notifyReady(botId);
    }

    /** Whether the bot holds its session open. */
    isReady(botId: string): boolean {
        return this.#sessions.has(botId);
    }

    /** Whether the bot holds its session open and is reading nothing. */
    isIdle(botId: string): boolean {
        const session = this.#sessions.get(botId);
        return session !== undefined && session.outstanding === null;
    }

    /** Whether the bot's failed readings bench it now. */
    isBenched(botId: string): boolean {
        const until = this.#benchedUntil.get(botId);
        if (until === undefined) return false;
        if (until > this.#deps.now()) return true;
        this.#benchedUntil.delete(botId);
        return false;
    }

    /** The bots holding a session. */
    readyBots(): string[] {
        return [...this.#sessions.keys()];
    }

    /**
     * Sends one position to an idle analyzer: its stones as a fresh setup,
     * then a move request for the side to move.
     * Settles once it is read, fails, or is called off;
     * a failure the analyzer caused is a strike.
     * `late` takes an answer that arrives after the request is called off.
     */
    read(botId: string, ask: ReadingAsk, late: ((lines: readonly AnalysisLine[]) => void) | null = null): Promise<ReadingOutcome> {
        const session = this.#sessions.get(botId);
        if (session === undefined || session.outstanding !== null) return Promise.resolve({ kind: `interrupted` });
        return new Promise((resolve) => {
            session.requestCounter += 1;
            const requestId = session.requestCounter;
            const settle = (outcome: ReadingOutcome) => {
                if (outcome.kind === `failed`) this.#strike(botId);
                resolve(outcome);
            };
            const timer = setTimeout(() => {
                if (session.outstanding?.requestId !== requestId) return;
                this.#callOff(botId, session, { kind: `failed`, failure: `timeout` });
            }, ask.seconds * 1000 + analysisGraceMs);
            session.outstanding = { requestId, ask, sentAt: this.#deps.now(), timer, settle, late };
            session.calledOff = null;
            const cells = ask.setup.stones.map((stone) => ({ ...internalToWire(stone), p: sideOf(stone.player) }));
            this.#send(botId, session, JSON.stringify(bwsSetupPacketSchema.parse({ type: `setup`, board: { cells } })));
            this.#send(
                botId,
                session,
                JSON.stringify(
                    bwsMoveRequestPacketSchema.parse({
                        type: `move_request`,
                        side: sideOf(ask.setup.toMove),
                        previous: [],
                        move_time_limit: ask.seconds,
                        request_id: requestId,
                    }),
                ),
            );
        });
    }

    /** Calls off the analyzer's outstanding request, with no strike; its answer may still come. */
    interrupt(botId: string): void {
        const session = this.#sessions.get(botId);
        if (session === undefined || session.outstanding === null) return;
        this.#callOff(botId, session, { kind: `interrupted` });
    }

    /** Closes the bot's session, as its analyzer is withdrawn or it may analyze no more; a dial on its token then finds no analyzer. */
    close(botId: string): void {
        this.#endSession(botId, { kind: `interrupted` }, 1000, `withdrawn`);
        this.#clearResend(botId);
    }

    /** A frame from the bot's session. */
    message(botId: string, socket: EngineSocket, text: string): void {
        const session = this.#sessions.get(botId);
        if (session?.socket !== socket) return;
        // Counted before parsing, so a flood ends the session instead of going on unseen.
        const stray = () => {
            session.strays += 1;
            if (session.strays > engineStrayFrameCap) this.#endSession(botId, { kind: `failed`, failure: `protocol` }, 1008, `rate limit exceeded`);
        };
        if (session.outstanding === null && session.calledOff === null) {
            stray();
            return;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch {
            this.#endSession(botId, { kind: `failed`, failure: `protocol` }, 1008, `malformed frame`);
            return;
        }
        const packet = bwsMoveResponsePacketSchema.safeParse(parsed);
        if (!packet.success) {
            this.#endSession(botId, { kind: `failed`, failure: `protocol` }, 1008, `protocol violation`);
            return;
        }
        const outstanding = session.outstanding;
        if (outstanding !== null && packet.data.request_id === outstanding.requestId) {
            session.outstanding = null;
            clearTimeout(outstanding.timer);
            const checked = checkReading(outstanding.ask.setup, packet.data, outstanding.ask.lines);
            outstanding.settle(checked.ok ? { kind: `read`, lines: checked.lines, elapsedMs: this.#deps.now() - outstanding.sentAt } : { kind: `failed`, failure: checked.failure });
            return;
        }
        const calledOff = session.calledOff;
        if (calledOff !== null && packet.data.request_id === calledOff.requestId) {
            session.calledOff = null;
            const checked = checkReading(calledOff.ask.setup, packet.data, calledOff.ask.lines);
            if (checked.ok) calledOff.late?.(checked.lines);
            return;
        }
        stray();
    }

    /** Drops every session and timer without a word to the bots, as the process stops. */
    stop(): void {
        for (const botId of [...this.#sessions.keys()]) this.#endSession(botId, { kind: `interrupted` }, 1001, `going away`);
        for (const timer of this.#resends.values()) clearTimeout(timer);
        this.#resends.clear();
    }

    #callOff(botId: string, session: Session, outcome: ReadingOutcome): void {
        const outstanding = session.outstanding;
        if (outstanding === null) return;
        session.outstanding = null;
        clearTimeout(outstanding.timer);
        session.calledOff = { requestId: outstanding.requestId, ask: outstanding.ask, sentAt: outstanding.sentAt, late: outstanding.late };
        this.#send(botId, session, JSON.stringify(bwsInterruptPacketSchema.parse({ type: `interrupt`, request_id: outstanding.requestId })));
        outstanding.settle(outcome);
    }

    // The outstanding request ends as `outcome`; a socket the session still
    // holds is closed with the code given.
    #endSession(botId: string, outcome: ReadingOutcome, code?: number, reason?: string): void {
        const session = this.#sessions.get(botId);
        if (session === undefined) return;
        this.#sessions.delete(botId);
        clearInterval(session.heartbeat);
        const outstanding = session.outstanding;
        session.outstanding = null;
        if (outstanding !== null) {
            clearTimeout(outstanding.timer);
            outstanding.settle(outcome);
        }
        if (code !== undefined) session.socket.close(code, reason);
    }

    #scheduleResend(botId: string): void {
        this.#clearResend(botId);
        const timer = setTimeout(() => {
            this.#resends.delete(botId);
            if (!this.#sessions.has(botId)) this.sendOffer(botId);
        }, analysisSessionResendMs);
        this.#resends.set(botId, timer);
    }

    #clearResend(botId: string): void {
        const timer = this.#resends.get(botId);
        if (timer === undefined) return;
        clearTimeout(timer);
        this.#resends.delete(botId);
    }

    #strike(botId: string): void {
        const now = this.#deps.now();
        const recent = (this.#strikes.get(botId) ?? []).filter((at) => at > now - analyzerStrikeWindowMs);
        recent.push(now);
        if (recent.length >= analyzerStrikeLimit) {
            this.#benchedUntil.set(botId, now + analyzerBenchMs);
            this.#strikes.delete(botId);
            return;
        }
        this.#strikes.set(botId, recent);
    }

    // A bot that stopped reading would otherwise hold every frame sent it in memory.
    #send(botId: string, session: Session, text: string): void {
        if (this.#sessions.get(botId) !== session) return;
        session.socket.send(text);
        if (session.socket.bufferedAmount > streamBacklogLimitBytes) this.#endSession(botId, { kind: `failed`, failure: `disconnect` }, 1008, `not reading`);
    }

    #notifyReady(botId: string): void {
        for (const listener of this.#readyListeners) listener(botId);
    }
}
