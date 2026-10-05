import {
    analysesMemoMs,
    analysesPerGame,
    analysisPendingPerUser,
    analysisQueueCap,
    analysisQueueExpiryMs,
    analysisQueueRetryAfterSeconds,
    analysisRequestsPerUserDay,
    analysisTries,
    analyzerPositionQueueCap,
    nameKeyOf,
    positionBusyRetryAfterSeconds,
    positionHoldMs,
    positionQueueCap,
    positionReadingsPerUserDay,
    wholeGameSeconds,
    type AnalysisFailure,
    type AnalysisList,
    type AnalysisTurn,
    type AnalyzerRef,
    type CommunityAnalysis,
    type OwnAnalysis,
    type PositionReading,
    type Side,
} from '@hexo-arena/contract';
import { positionKey, type Setup } from '@hexo-arena/rules';
import { randomUUID } from 'node:crypto';
import {
    analysableGame,
    analysesOfGame,
    analyzersAmong,
    deleteAnalysis,
    failAnalysis,
    finishAnalysis,
    gameOptedOut,
    insertAnalysis,
    isAnalysable,
    linesOf,
    ownLinesOf,
    ownValuesOf,
    pendingAnalyses,
    requeueAnalysis,
    setOptOut,
    standingOf,
    startAnalysis,
    userRequests,
    type AnalysableGame,
    type AnalysisRow,
    type AnalyzerInfo,
} from './analysis-store';
import type { AnalyzerSessions, ReadingOutcome } from './analyzers';
import { findBot } from './bots';
import type { Query } from './db';
import type { GameRegistry } from './game-registry';
import { findGame } from './game-store';
import { ReadingCache, type CachedReading } from './reading-cache';

const dayMs = 86_400_000;

// A request's end before it is answered: its reading, why it failed, or a refusal.
type PositionResult =
    | { readonly status: `done`; readonly reading: CachedReading; readonly cached: boolean }
    | { readonly status: `failed`; readonly analyzer: AnalyzerRef; readonly failure: AnalysisFailure }
    | { readonly status: `refused`; readonly code: `superseded` | `no_analyzer` };

// What a position request answers: a reading, a place in the queue, or a failure, else a refusal.
type PositionAnswer =
    | { readonly kind: `reading`; readonly reading: PositionReading }
    | { readonly kind: `refused`; readonly code: `superseded` | `no_analyzer` | `analysis_limit` | `analysis_busy`; readonly retryAfter?: number };

// What a whole-game request answers.
type GameRequestAnswer =
    | { readonly kind: `queued`; readonly analysis: CommunityAnalysis }
    | {
          readonly kind: `refused`;
          readonly code: `not_found` | `game_live` | `opted_out` | `not_analysable` | `analysis_full` | `analysis_pending` | `pending_limit` | `no_analyzer` | `analysis_limit` | `analysis_queue_full`;
          readonly retryAfter?: number;
      };

// What a game's readings answer.
type GameListAnswer = { readonly kind: `list`; readonly list: AnalysisList } | { readonly kind: `refused`; readonly code: `not_found` | `game_live` };

interface PositionEntry {
    readonly userId: string;
    readonly key: string;
    readonly setup: Setup;
    readonly target: string | null;
    readonly lines: number;
    readonly seconds: number;
    readonly waiters: Set<(result: PositionResult) => void>;
    assigned: string | null;
    charged: boolean;
    // Its asker went away or moved on; a reading still fills the cache.
    abandoned: boolean;
    result: PositionResult | null;
    // When someone last waited on it: an unsent request no one asks after goes.
    waitedAt: number;
}

interface Attempt {
    readonly analyzer: AnalyzerInfo;
    readonly involved: boolean;
    readonly seconds: number;
    readonly turns: AnalysisTurn[];
    index: number;
    timeoutRetried: boolean;
    inFlight: boolean;
}

interface GameJob {
    readonly analysisId: string;
    readonly game: AnalysableGame;
    readonly target: string | null;
    readonly createdAt: number;
    readonly tried: Set<string>;
    attempt: Attempt | null;
    cancelled: boolean;
}

interface AnalysisServiceDeps {
    readonly query: Query;
    readonly analyzers: AnalyzerSessions;
    readonly games: Pick<GameRegistry, `activeGameCount` | `isLive`>;
    readonly now: () => number;
}

/**
 * Who reads what: position requests held open for their readings, whole
 * games read position by position on one analyzer, each analyzer given one
 * request at a time, positions before games, readings kept in memory.
 */
export class AnalysisService {
    readonly #query: Query;
    readonly #analyzers: AnalyzerSessions;
    readonly #games: AnalysisServiceDeps[`games`];
    readonly #now: () => number;
    readonly #cache: ReadingCache;
    readonly #positions: PositionEntry[] = [];
    readonly #current = new Map<string, PositionEntry>();
    readonly #used = new Map<string, number>();
    #usedDay = -1;
    readonly #jobs: GameJob[] = [];
    // Jobs an analyzer has taken, until they finish, fail on it, or move on.
    readonly #taken = new Map<string, GameJob>();
    readonly #lastAssigned = new Map<string, number>();
    readonly #memo = new Map<string, { readonly at: number; readonly answer: GameListAnswer }>();
    readonly #sweep: ReturnType<typeof setInterval>;
    // A stopped service writes nothing: the sessions it ends answer after the database may be gone.
    #stopped = false;

    constructor(deps: AnalysisServiceDeps) {
        this.#query = deps.query;
        this.#analyzers = deps.analyzers;
        this.#games = deps.games;
        this.#now = deps.now;
        this.#cache = new ReadingCache(deps.now);
        this.#restore();
        this.#analyzers.onReady(() => {
            this.dispatch();
        });
        this.#sweep = setInterval(() => {
            this.expire();
            this.dispatch();
        }, 60_000);
        this.#sweep.unref();
    }

    stop(): void {
        this.#stopped = true;
        clearInterval(this.#sweep);
    }

    /** Positions the user may still have read this UTC day. */
    positionsLeft(userId: string): number {
        return Math.max(0, positionReadingsPerUserDay - this.#usedBy(userId));
    }

    /** Whole games the user may still ask to have read this UTC day. */
    gamesLeft(userId: string): number {
        return Math.max(0, analysisRequestsPerUserDay - userRequests(this.#query, userId, Math.floor(this.#dayStart() / 1000)).today);
    }

    /**
     * Reads a position for a user, held until it is read, it fails, or the
     * hold runs out; asking again for the same position waits on the same
     * request, and asking for another lets this one go.
     * `signal` aborts as the asker hangs up.
     */
    requestPosition(
        userId: string,
        ask: { setup: Setup; analyzer: string | null; lines: number; seconds: number },
        signal: AbortSignal,
    ): Promise<PositionAnswer> {
        const key = positionKey(ask.setup);
        const named = ask.analyzer === null ? null : findBot(this.#query, nameKeyOf(ask.analyzer));
        const target = named === null ? null : (named?.id ?? undefined);
        const current = this.#current.get(userId);
        if (current?.key === key && current.target === target && current.lines === ask.lines && current.seconds === ask.seconds) {
            const result = current.result;
            if (result === null) return this.#hold(current, signal);
            this.#current.delete(userId);
            return Promise.resolve(this.#answer(userId, ask.lines, result));
        }
        if (current !== undefined) this.#letGo(current, { status: `refused`, code: `superseded` });
        if (target === undefined) return Promise.resolve({ kind: `refused`, code: `no_analyzer` });
        const cached = this.#cache.find(key, target, ask.seconds);
        if (cached !== null) return Promise.resolve(this.#answer(userId, ask.lines, { status: `done`, reading: cached, cached: true }));
        if (this.#usedBy(userId) >= positionReadingsPerUserDay) return Promise.resolve({ kind: `refused`, code: `analysis_limit`, retryAfter: this.#toMidnight() });
        if (!this.#available().some((info) => target === null || info.id === target)) return Promise.resolve({ kind: `refused`, code: `no_analyzer` });
        const waiting = this.#positions.filter((entry) => entry.assigned === null);
        if (waiting.length >= positionQueueCap || (target !== null && waiting.filter((entry) => entry.target === target).length >= analyzerPositionQueueCap)) {
            return Promise.resolve({ kind: `refused`, code: `analysis_busy`, retryAfter: positionBusyRetryAfterSeconds });
        }
        const entry: PositionEntry = {
            userId,
            key,
            setup: ask.setup,
            target,
            lines: ask.lines,
            seconds: ask.seconds,
            waiters: new Set(),
            assigned: null,
            charged: false,
            abandoned: false,
            result: null,
            waitedAt: this.#now(),
        };
        this.#positions.push(entry);
        this.#current.set(userId, entry);
        const held = this.#hold(entry, signal);
        this.dispatch();
        return held;
    }

    /** Queues a stored finished game to be read whole, by the named analyzer or any that may. */
    requestGame(userId: string, gameId: string, analyzerName: string | null): GameRequestAnswer {
        const game = analysableGame(this.#query, gameId);
        if (game === undefined) return { kind: `refused`, code: this.#games.isLive(gameId) ? `game_live` : `not_found` };
        if (gameOptedOut(this.#query, game.users)) return { kind: `refused`, code: `opted_out` };
        if (!isAnalysable(game)) return { kind: `refused`, code: `not_analysable` };
        const standing = standingOf(this.#query, gameId);
        if (standing.done >= analysesPerGame.done) return { kind: `refused`, code: `analysis_full` };
        if (standing.pending >= analysesPerGame.pending) return { kind: `refused`, code: `analysis_pending` };
        const requests = userRequests(this.#query, userId, Math.floor(this.#dayStart() / 1000));
        if (requests.pending >= analysisPendingPerUser) return { kind: `refused`, code: `pending_limit` };
        if (requests.today >= analysisRequestsPerUserDay) return { kind: `refused`, code: `analysis_limit`, retryAfter: this.#toMidnight() };
        if (this.#jobs.length >= analysisQueueCap) return { kind: `refused`, code: `analysis_queue_full`, retryAfter: analysisQueueRetryAfterSeconds };
        const target = analyzerName === null ? null : (findBot(this.#query, nameKeyOf(analyzerName))?.id ?? null);
        const job: GameJob = { analysisId: `a_${randomUUID()}`, game, target, createdAt: this.#now(), tried: new Set(), attempt: null, cancelled: false };
        if ((analyzerName !== null && target === null) || !this.#available().some((info) => this.#mayRead(job, info))) return { kind: `refused`, code: `no_analyzer` };
        insertAnalysis(this.#query, { id: job.analysisId, gameId, namedBotId: target, requestedBy: userId, seconds: wholeGameSeconds, createdAt: Math.floor(job.createdAt / 1000) });
        this.#jobs.push(job);
        this.#memo.delete(gameId);
        const analysis = this.#jobView(job);
        this.dispatch();
        return { kind: `queued`, analysis };
    }

    /** A finished game's community readings and each bot seat's own view. */
    list(gameId: string): GameListAnswer {
        const now = this.#now();
        const memo = this.#memo.get(gameId);
        if (memo !== undefined && memo.at + analysesMemoMs > now) return memo.answer;
        const answer = this.#list(gameId);
        this.#memo.set(gameId, { at: now, answer });
        for (const [id, held] of this.#memo) if (held.at + analysesMemoMs <= now) this.#memo.delete(id);
        return answer;
    }

    /** Sets a user's opt-out; opting out stops and deletes the readings of their games. */
    setOptOut(userId: string, optedOut: boolean): void {
        const deleted = new Set(setOptOut(this.#query, userId, optedOut));
        for (const job of [...this.#jobs, ...this.#taken.values()]) if (deleted.has(job.analysisId)) this.#cancel(job);
        this.#memo.clear();
    }

    /** Deletes a reading, stopping it when it is pending; false when there is none. */
    delete(analysisId: string): boolean {
        const deleted = deleteAnalysis(this.#query, analysisId);
        if (deleted === undefined) return false;
        for (const job of [...this.#jobs, ...this.#taken.values()]) if (job.analysisId === analysisId) this.#cancel(job);
        this.#memo.delete(deleted.gameId);
        return true;
    }

    /**
     * Games just started: an analyzer seated in one that did not declare
     * whilePlaying stops reading, and its request goes back to the queue.
     */
    gameStarted(botIds: readonly string[]): void {
        for (const info of analyzersAmong(this.#query, botIds)) {
            if (!info.analyzer.whilePlaying) this.#analyzers.interrupt(info.id);
        }
    }

    /** An analyzer withdrawn, deleted, or barred: its session closes and its requests go elsewhere. */
    withdraw(botId: string): void {
        this.#analyzers.close(botId);
        for (const entry of this.#positions.filter((each) => each.target === botId && each.assigned === null)) {
            this.#letGo(entry, { status: `refused`, code: `no_analyzer` });
        }
        this.dispatch();
    }

    /** Fails whole-game requests no analyzer took in time, and drops positions and results no one asks after. */
    expire(): void {
        const now = this.#now();
        const forgotten = (entry: PositionEntry) => entry.waiters.size === 0 && entry.waitedAt + 2 * positionHoldMs <= now;
        for (const entry of this.#positions.filter((each) => each.assigned === null && forgotten(each))) this.#letGo(entry, null);
        for (const [userId, entry] of [...this.#current]) if (entry.result !== null && forgotten(entry)) this.#current.delete(userId);
        for (const job of [...this.#jobs]) {
            if (job.createdAt + analysisQueueExpiryMs > now) continue;
            this.#jobs.splice(this.#jobs.indexOf(job), 1);
            failAnalysis(this.#query, job.analysisId, `expired`, null, Math.floor(now / 1000));
            this.#memo.delete(job.game.gameId);
        }
    }

    /** Gives every idle analyzer that may read its next request: positions first, then its game, then a queued game. */
    dispatch(): void {
        if (this.#stopped) return;
        const available = this.#available();
        const idle = available.filter((info) => this.#analyzers.isIdle(info.id));
        idle.sort((a, b) => (this.#lastAssigned.get(a.id) ?? 0) - (this.#lastAssigned.get(b.id) ?? 0));
        for (const info of idle) {
            const entry = this.#positions.find((each) => each.assigned === null && (each.target === null || each.target === info.id));
            if (entry !== undefined) {
                void this.#readPosition(entry, info);
                continue;
            }
            const taken = this.#taken.get(info.id);
            if (taken !== undefined) {
                if (taken.attempt !== null && !taken.attempt.inFlight) void this.#readGamePosition(taken, taken.attempt);
                continue;
            }
            const job = this.#jobs.find((each) => this.#mayTake(each, info, available));
            if (job !== undefined) this.#take(job, info);
        }
    }

    // Analyzers that may be given work now: declared and listed, holding
    // their session, not benched, and between games unless they read while playing.
    #available(): AnalyzerInfo[] {
        return analyzersAmong(this.#query, this.#analyzers.readyBots()).filter(
            (info) => !this.#analyzers.isBenched(info.id) && (info.analyzer.whilePlaying || this.#games.activeGameCount(info.id) === 0),
        );
    }

    async #readPosition(entry: PositionEntry, info: AnalyzerInfo): Promise<void> {
        entry.assigned = info.id;
        this.#lastAssigned.set(info.id, this.#now());
        this.#charge(entry, 1);
        const seconds = Math.min(entry.seconds, info.analyzer.maxSeconds);
        const startedAt = this.#now();
        const keep = (lines: CachedReading[`lines`]) => {
            this.#cache.put(entry.key, this.#cached(info, seconds, lines, this.#now() - startedAt));
        };
        const outcome = await this.#analyzers.read(info.id, { setup: entry.setup, lines: info.analyzer.lines, seconds }, keep);
        if (this.#stopped) return;
        this.#positionRead(entry, info, seconds, outcome);
        this.dispatch();
    }

    #positionRead(entry: PositionEntry, info: AnalyzerInfo, seconds: number, outcome: ReadingOutcome): void {
        this.#unqueue(entry);
        if (outcome.kind === `interrupted`) {
            if (entry.abandoned) return;
            // Called off by the analyzer's game or session, not the asker: it
            // waits again at the front, free, unless its named analyzer is gone.
            this.#charge(entry, -1);
            entry.assigned = null;
            if (entry.target !== null && !this.#analyzers.isReady(entry.target)) {
                this.#settle(entry, { status: `refused`, code: `no_analyzer` });
                return;
            }
            this.#positions.unshift(entry);
            return;
        }
        if (outcome.kind === `failed`) {
            this.#charge(entry, -1);
            this.#settle(entry, { status: `failed`, analyzer: refOf(info), failure: outcome.failure });
            return;
        }
        const reading = this.#cached(info, seconds, outcome.lines, outcome.elapsedMs);
        this.#cache.put(entry.key, reading);
        this.#settle(entry, { status: `done`, reading, cached: false });
    }

    #take(job: GameJob, info: AnalyzerInfo): void {
        this.#jobs.splice(this.#jobs.indexOf(job), 1);
        const seconds = Math.min(wholeGameSeconds, info.analyzer.maxSeconds);
        const involved = involvedIn(job.game, info);
        job.attempt = { analyzer: info, involved, seconds, turns: [], index: 0, timeoutRetried: false, inFlight: false };
        this.#lastAssigned.set(info.id, this.#now());
        this.#memo.delete(job.game.gameId);
        if (!startAnalysis(this.#query, job.analysisId, { botId: info.id, version: info.version, values: info.analyzer.values, involved, seconds }, Math.floor(this.#now() / 1000))) {
            job.attempt = null;
            return;
        }
        this.#taken.set(info.id, job);
        void this.#readGamePosition(job, job.attempt);
    }

    async #readGamePosition(job: GameJob, attempt: Attempt): Promise<void> {
        const position = job.game.positions[attempt.index];
        if (position === undefined) return;
        attempt.inFlight = true;
        const info = attempt.analyzer;
        const startedAt = this.#now();
        const key = positionKey(position.setup);
        const outcome = await this.#analyzers.read(info.id, { setup: position.setup, lines: info.analyzer.lines, seconds: attempt.seconds }, (lines) => {
            this.#cache.put(key, this.#cached(info, attempt.seconds, lines, this.#now() - startedAt));
        });
        attempt.inFlight = false;
        if (this.#stopped) return;
        if (job.cancelled) {
            this.#taken.delete(info.id);
        } else {
            this.#gamePositionRead(job, attempt, position.turn, key, outcome);
        }
        this.dispatch();
    }

    #gamePositionRead(job: GameJob, attempt: Attempt, turn: number, key: string, outcome: ReadingOutcome): void {
        const info = attempt.analyzer;
        const nowSeconds = Math.floor(this.#now() / 1000);
        if (outcome.kind === `read`) {
            this.#cache.put(key, this.#cached(info, attempt.seconds, outcome.lines, outcome.elapsedMs));
            attempt.turns.push({ turn, toMove: turn % 2 === 1 ? `o` : `x`, lines: [...outcome.lines] });
            attempt.index += 1;
            attempt.timeoutRetried = false;
            if (attempt.index < job.game.positions.length) return;
            this.#taken.delete(info.id);
            finishAnalysis(this.#query, job.analysisId, attempt.turns, nowSeconds);
            this.#memo.delete(job.game.gameId);
            return;
        }
        if (outcome.kind === `failed` && outcome.failure === `timeout` && !attempt.timeoutRetried) {
            attempt.timeoutRetried = true;
            return;
        }
        this.#taken.delete(info.id);
        job.attempt = null;
        this.#memo.delete(job.game.gameId);
        if (outcome.kind === `failed`) job.tried.add(info.id);
        if (outcome.kind === `interrupted` || job.tried.size < analysisTries) {
            if (requeueAnalysis(this.#query, job.analysisId)) this.#jobs.unshift(job);
            return;
        }
        failAnalysis(this.#query, job.analysisId, outcome.failure, turn, nowSeconds);
    }

    // A game no analyzer reads twice, nor a second of one owner's analyzers.
    #mayRead(job: Pick<GameJob, `game` | `target` | `tried`>, info: AnalyzerInfo): boolean {
        if (job.target !== null && job.target !== info.id) return false;
        if (job.tried.has(info.id)) return false;
        const standing = standingOf(this.#query, job.game.gameId);
        return !standing.analyzers.includes(info.id) && !standing.owners.includes(info.ownerId);
    }

    // Asked for by no name, a game waits for an analyzer whose owner sat in
    // neither seat while one that may read it is available, busy or not;
    // only with none does one whose owner played take it.
    #mayTake(job: GameJob, info: AnalyzerInfo, available: readonly AnalyzerInfo[]): boolean {
        if (!this.#mayRead(job, info)) return false;
        if (job.target !== null || !involvedIn(job.game, info)) return true;
        return !this.#independentMayRead(job, available);
    }

    #independentMayRead(job: Pick<GameJob, `game` | `target` | `tried`>, available: readonly AnalyzerInfo[]): boolean {
        return available.some((info) => !involvedIn(job.game, info) && this.#mayRead(job, info));
    }

    #cancel(job: GameJob): void {
        job.cancelled = true;
        const queued = this.#jobs.indexOf(job);
        if (queued >= 0) this.#jobs.splice(queued, 1);
        const attempt = job.attempt;
        if (attempt === null) return;
        if (attempt.inFlight) {
            this.#analyzers.interrupt(attempt.analyzer.id);
            return;
        }
        this.#taken.delete(attempt.analyzer.id);
    }

    #hold(entry: PositionEntry, signal: AbortSignal): Promise<PositionAnswer> {
        return new Promise((resolve) => {
            const settle = (result: PositionResult) => {
                clearTimeout(timer);
                signal.removeEventListener(`abort`, abandon);
                resolve(this.#answer(entry.userId, entry.lines, result));
            };
            const timer = setTimeout(() => {
                entry.waiters.delete(settle);
                entry.waitedAt = this.#now();
                signal.removeEventListener(`abort`, abandon);
                const chosen = entry.assigned ?? entry.target;
                const analyzer = chosen === null ? undefined : analyzersAmong(this.#query, [chosen])[0];
                resolve({
                    kind: `reading`,
                    reading: { status: `queued`, ahead: this.#ahead(entry), ...(analyzer === undefined ? {} : { analyzer: refOf(analyzer) }), left: this.positionsLeft(entry.userId) },
                });
            }, positionHoldMs);
            // An asker that hangs up lets an unsent request go, free, and calls off one in flight.
            const abandon = () => {
                clearTimeout(timer);
                entry.waiters.delete(settle);
                if (entry.waiters.size === 0 && entry.result === null) this.#letGo(entry, null);
                resolve({ kind: `refused`, code: `superseded` });
            };
            entry.waiters.add(settle);
            entry.waitedAt = this.#now();
            signal.addEventListener(`abort`, abandon, { once: true });
        });
    }

    // An entry no one waits on any more: dropped while unsent, called off in flight.
    #letGo(entry: PositionEntry, result: PositionResult | null): void {
        if (this.#current.get(entry.userId) === entry) this.#current.delete(entry.userId);
        entry.abandoned = true;
        if (result !== null) {
            for (const waiter of [...entry.waiters]) waiter(result);
            entry.waiters.clear();
        }
        if (entry.result !== null) return;
        if (entry.assigned === null) {
            this.#unqueue(entry);
            return;
        }
        if (result === null) this.#analyzers.interrupt(entry.assigned);
    }

    #unqueue(entry: PositionEntry): void {
        const index = this.#positions.indexOf(entry);
        if (index >= 0) this.#positions.splice(index, 1);
    }

    // A result no one waits for stays with the entry until its asker asks again.
    #settle(entry: PositionEntry, result: PositionResult): void {
        entry.result = result;
        const delivered = entry.waiters.size > 0;
        for (const waiter of [...entry.waiters]) waiter(result);
        entry.waiters.clear();
        if ((delivered || entry.abandoned) && this.#current.get(entry.userId) === entry) this.#current.delete(entry.userId);
    }

    // A reading keeps every line the analyzer gave; an asker gets the lines it asked for.
    #answer(userId: string, lines: number, result: PositionResult): PositionAnswer {
        const left = this.positionsLeft(userId);
        switch (result.status) {
            case `done`: {
                const { reading, cached } = result;
                return {
                    kind: `reading`,
                    reading: {
                        status: `done`,
                        analyzer: reading.analyzer,
                        seconds: reading.seconds,
                        elapsedMs: reading.elapsedMs,
                        readAt: new Date(reading.readAt).toISOString(),
                        cached,
                        lines: reading.lines.slice(0, lines),
                        left,
                    },
                };
            }
            case `failed`:
                return { kind: `reading`, reading: { status: `failed`, analyzer: result.analyzer, failure: result.failure, left } };
            case `refused`:
                return { kind: `refused`, code: result.code };
        }
    }

    #ahead(entry: PositionEntry): number {
        const waiting = this.#positions.filter((each) => each.assigned === null);
        const at = waiting.indexOf(entry);
        return waiting.slice(0, at < 0 ? 0 : at).filter((each) => each.target === null || entry.target === null || each.target === entry.target).length;
    }

    #cached(info: AnalyzerInfo, seconds: number, lines: CachedReading[`lines`], elapsedMs: number): CachedReading {
        return { botId: info.id, analyzer: refOf(info), seconds, maxSeconds: info.analyzer.maxSeconds, lines, elapsedMs, readAt: this.#now() };
    }

    #charge(entry: PositionEntry, by: 1 | -1): void {
        if ((by === 1) === entry.charged) return;
        entry.charged = by === 1;
        this.#usedBy(entry.userId);
        this.#used.set(entry.userId, (this.#used.get(entry.userId) ?? 0) + by);
    }

    // The day's counts, cleared as a new UTC day begins.
    #usedBy(userId: string): number {
        const day = Math.floor(this.#now() / dayMs);
        if (day !== this.#usedDay) {
            this.#used.clear();
            this.#usedDay = day;
        }
        return this.#used.get(userId) ?? 0;
    }

    #dayStart(): number {
        return Math.floor(this.#now() / dayMs) * dayMs;
    }

    #toMidnight(): number {
        return Math.max(1, Math.ceil((this.#dayStart() + dayMs - this.#now()) / 1000));
    }

    // Requests a stopped process left queued or running wait again, in the
    // order they came, unless their wait already ran out.
    #restore(): void {
        const now = this.#now();
        for (const row of pendingAnalyses(this.#query)) {
            const game = analysableGame(this.#query, row.gameId);
            if (game === undefined) continue;
            if (row.createdAt * 1000 + analysisQueueExpiryMs <= now) {
                failAnalysis(this.#query, row.id, `expired`, null, Math.floor(now / 1000));
                continue;
            }
            if (row.status === `running`) requeueAnalysis(this.#query, row.id);
            this.#jobs.push({ analysisId: row.id, game, target: row.namedBotId, createdAt: row.createdAt * 1000, tried: new Set(), attempt: null, cancelled: false });
        }
    }

    #list(gameId: string): GameListAnswer {
        const record = findGame(this.#query, gameId);
        const game = analysableGame(this.#query, gameId);
        if (record === undefined || game === undefined) return { kind: `refused`, code: this.#games.isLive(gameId) ? `game_live` : `not_found` };
        if (gameOptedOut(this.#query, game.users)) return { kind: `list`, list: { analyses: [], optedOut: true, independentOnline: false } };
        const rows = analysesOfGame(this.#query, gameId);
        const done = rows.filter((row) => row.status === `done`).sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
        const pending = rows.filter((row) => row.status === `queued` || row.status === `running`);
        const failed = rows.filter((row) => row.status === `failed`).sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0)).slice(0, 1);
        const lines = linesOf(
            this.#query,
            done.map((row) => row.id),
        );
        const firstTurn = (record.opening.length + 1) / 2;
        const community = [
            ...done.map((row) => this.#rowView(row, game, lines.get(row.id) ?? [], firstTurn)),
            ...pending.map((row) => {
                const job = [...this.#jobs, ...this.#taken.values()].find((each) => each.analysisId === row.id);
                return job === undefined ? this.#rowView(row, game, [], firstTurn) : this.#jobView(job);
            }),
            ...failed.map((row) => this.#rowView(row, game, [], firstTurn)),
        ];
        const own = ownLinesOf(this.#query, gameId, record.opening.length);
        const values = ownValuesOf(this.#query, gameId);
        const seats: Record<Side, string | null> =
            record.kind === `bots`
                ? record.challengerSide === `x`
                    ? { x: record.challenger.name, o: record.dest.name }
                    : { x: record.dest.name, o: record.challenger.name }
                : record.kind === `human`
                  ? { x: record.userSide === `x` ? null : record.bot.name, o: record.userSide === `o` ? null : record.bot.name }
                  : { x: record.guestSide === `x` ? null : record.bot.name, o: record.guestSide === `o` ? null : record.bot.name };
        const views: OwnAnalysis[] = ([`x`, `o`] as const).flatMap((side) => {
            const player = seats[side];
            return player === null || own[side].length === 0 ? [] : [{ kind: `own` as const, side, player, values: values[side], turns: own[side] }];
        });
        const independentOnline = this.#independentMayRead({ game, target: null, tried: new Set() }, this.#available());
        return { kind: `list`, list: { analyses: [...community, ...views], optedOut: false, independentOnline } };
    }

    #rowView(row: AnalysisRow, game: AnalysableGame, turns: AnalysisTurn[], firstTurn: number): CommunityAnalysis {
        const of = game.positions.length;
        const read = row.status === `done` ? of : row.failedTurn === null ? 0 : row.failedTurn - firstTurn;
        return {
            kind: `community`,
            analysisId: row.id,
            analyzer: row.analyzerName === null ? null : { name: row.analyzerName, version: row.analyzerVersion, ownerName: row.ownerName, values: row.analyzerValues },
            involved: row.involved,
            status: row.status,
            ...(row.failure === null ? {} : { failure: row.failure }),
            ...(row.failedTurn === null ? {} : { failedTurn: row.failedTurn }),
            requestedAt: isoOf(row.createdAt),
            finishedAt: row.finishedAt === null ? null : isoOf(row.finishedAt),
            progress: { done: Math.max(0, read), of },
            seconds: row.seconds,
            turns,
        };
    }

    #jobView(job: GameJob): CommunityAnalysis {
        const attempt = job.attempt;
        const queued = this.#jobs.indexOf(job);
        return {
            kind: `community`,
            analysisId: job.analysisId,
            analyzer: attempt === null ? null : refOf(attempt.analyzer),
            involved: attempt?.involved ?? false,
            status: attempt === null ? `queued` : `running`,
            requestedAt: isoOf(Math.floor(job.createdAt / 1000)),
            finishedAt: null,
            ...(queued < 0 ? {} : { queuePosition: queued + 1 }),
            progress: { done: attempt?.turns.length ?? 0, of: job.game.positions.length },
            seconds: attempt?.seconds ?? wholeGameSeconds,
            turns: attempt === null ? [] : [...attempt.turns],
        };
    }
}

// Whether the analyzer's owner sat in the game, as a human or through any of
// their bots, the analyzer itself among them.
function involvedIn(game: AnalysableGame, info: AnalyzerInfo): boolean {
    return game.owners.includes(info.ownerId);
}

function refOf(info: AnalyzerInfo): AnalyzerRef {
    return { name: info.name, version: info.version, ownerName: info.ownerName, values: info.analyzer.values };
}

function isoOf(seconds: number): string {
    return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/u, `Z`);
}
