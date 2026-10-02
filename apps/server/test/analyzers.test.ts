import { analysisGraceMs, analysisSessionResendMs, analyzerBenchMs, engineStrayFrameCap, internalToWire, sessionTokenTtlMs, type AnalysisSessionEvent } from '@hexo-arena/contract';
import type { Setup } from '@hexo-arena/rules';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyzerSessions, type ReadingOutcome } from '../src/analyzers';
import type { EngineSocket } from '../src/game-registry';

class FakeSocket implements EngineSocket {
    readonly sent: unknown[] = [];
    bufferedAmount = 0;
    closed: { code: number | undefined; reason: string | undefined } | null = null;
    #listeners: (() => void)[] = [];

    send(text: string): void {
        this.sent.push(JSON.parse(text) as unknown);
    }

    close(code?: number, reason?: string): void {
        this.closed = { code, reason };
        this.hangUp();
    }

    onceClose(listener: () => void): void {
        this.#listeners.push(listener);
    }

    hangUp(): void {
        const listeners = this.#listeners;
        this.#listeners = [];
        for (const listener of listeners) listener();
    }

    last(type: string): Record<string, unknown> | undefined {
        // Every packet the sessions send is a JSON object with a type.
        return (this.sent as Record<string, unknown>[]).filter((packet) => packet[`type`] === type).at(-1);
    }
}

// x to move after o's first turn: quiet, so any legal line reads.
const board: Setup = {
    stones: [
        { x: 0, y: 0, player: 0 },
        { x: 1, y: 0, player: 1 },
        { x: 0, y: 1, player: 1 },
    ],
    toMove: 0,
};

const answer = (requestId: unknown, evaluation: object = { heuristic: 0.1 }) =>
    JSON.stringify({
        type: `move_response`,
        move: { pieces: [internalToWire({ x: 2, y: 2 }), internalToWire({ x: -1, y: 0 })], evaluation },
        request_id: requestId,
    });

describe('AnalyzerSessions', () => {
    let now = 0;
    let online = true;
    let declared = true;
    let offers: AnalysisSessionEvent[] = [];
    let sessions: AnalyzerSessions;

    beforeEach(() => {
        vi.useFakeTimers();
        now = 1_000_000;
        online = true;
        declared = true;
        offers = [];
        sessions = new AnalyzerSessions({
            online: () => online,
            mayAnalyze: () => declared,
            send: (_botId, event) => {
                offers.push(event);
            },
            now: () => now,
        });
    });

    afterEach(() => {
        sessions.stop();
        vi.useRealTimers();
    });

    it('offers a session only to a bot that may analyze, each token replacing the last until it expires', () => {
        const first = sessions.offer(`b1`);
        const second = sessions.offer(`b1`);
        expect(second?.engine.socketUrl).toBe(`/api/bot/analysis/socket`);
        expect(second?.engine.token).toMatch(/^has_/);
        expect(sessions.claim(first?.engine.token ?? ``)).toBeNull();
        expect(sessions.claim(second?.engine.token ?? ``)).toBe(`b1`);
        now += sessionTokenTtlMs;
        expect(sessions.claim(second?.engine.token ?? ``)).toBeNull();
        declared = false;
        expect(sessions.offer(`b1`)).toBeNull();
    });

    it('reads a position as a fresh setup and a move request for the side to move, then the checked lines', async () => {
        const socket = new FakeSocket();
        sessions.attach(`b1`, socket);
        expect(sessions.isIdle(`b1`)).toBe(true);
        const reading = sessions.read(`b1`, { setup: board, lines: 1, seconds: 2 });
        expect(sessions.isIdle(`b1`)).toBe(false);
        expect(socket.last(`setup`)).toEqual({ type: `setup`, board: { cells: [{ q: 0, r: 0, p: `x` }, { q: 1, r: 0, p: `o` }, { q: 1, r: -1, p: `o` }] } });
        const request = socket.last(`move_request`);
        expect(request).toEqual({ type: `move_request`, side: `x`, previous: [], move_time_limit: 2, request_id: 1 });
        now += 700;
        sessions.message(`b1`, socket, answer(1));
        expect(await reading).toEqual({ kind: `read`, lines: [{ cells: [{ x: 2, y: 2 }, { x: -1, y: 0 }], heuristic: 0.1 }], elapsedMs: 700 });
        expect(sessions.isIdle(`b1`)).toBe(true);
    });

    it('times out past the seconds and the grace, interrupting the request, and keeps a late answer apart', async () => {
        const socket = new FakeSocket();
        sessions.attach(`b1`, socket);
        const late: unknown[] = [];
        const reading = sessions.read(`b1`, { setup: board, lines: 1, seconds: 1 }, (lines) => late.push(lines));
        vi.advanceTimersByTime(1_000 + analysisGraceMs);
        expect(await reading).toEqual({ kind: `failed`, failure: `timeout` });
        expect(socket.last(`interrupt`)).toEqual({ type: `interrupt`, request_id: 1 });
        sessions.message(`b1`, socket, answer(1));
        expect(late).toHaveLength(1);
        expect(socket.closed).toBeNull();
    });

    it('fails a reading that breaks the rules, and benches the analyzer at the third failure', async () => {
        const socket = new FakeSocket();
        sessions.attach(`b1`, socket);
        const outcomes: ReadingOutcome[] = [];
        for (const evaluation of [{}, { heuristic: 2e6 }, { win_in: 0 }]) {
            const reading = sessions.read(`b1`, { setup: board, lines: 1, seconds: 2 });
            sessions.message(`b1`, socket, answer(outcomes.length + 1, evaluation));
            outcomes.push(await reading);
            if (outcomes.length < 3) expect(sessions.isBenched(`b1`)).toBe(false);
        }
        expect(outcomes).toEqual([
            { kind: `failed`, failure: `no_evaluation` },
            { kind: `failed`, failure: `inconsistent` },
            { kind: `failed`, failure: `inconsistent` },
        ]);
        expect(sessions.isBenched(`b1`)).toBe(true);
        now += analyzerBenchMs;
        expect(sessions.isBenched(`b1`)).toBe(false);
    });

    it('closes on a malformed frame or a packet of the wrong kind, failing the request for the protocol', async () => {
        for (const frame of [`{oops`, JSON.stringify({ type: `eval_response`, evaluation: { heuristic: 0 } })]) {
            const socket = new FakeSocket();
            sessions.attach(`b1`, socket);
            const reading = sessions.read(`b1`, { setup: board, lines: 1, seconds: 2 });
            sessions.message(`b1`, socket, frame);
            expect(await reading).toEqual({ kind: `failed`, failure: `protocol` });
            expect(socket.closed?.code).toBe(1008);
        }
    });

    it(`closes after more than ${String(engineStrayFrameCap)} frames that answer nothing`, () => {
        const socket = new FakeSocket();
        sessions.attach(`b1`, socket);
        for (let frame = 0; frame <= engineStrayFrameCap; frame += 1) sessions.message(`b1`, socket, answer(9));
        expect(socket.closed).toEqual({ code: 1008, reason: `rate limit exceeded` });
        expect(sessions.isReady(`b1`)).toBe(false);
    });

    it('fails the request in flight when the bot hangs up, and offers a new session a few seconds later', async () => {
        const socket = new FakeSocket();
        sessions.attach(`b1`, socket);
        const reading = sessions.read(`b1`, { setup: board, lines: 1, seconds: 2 });
        socket.hangUp();
        expect(await reading).toEqual({ kind: `failed`, failure: `disconnect` });
        expect(offers).toEqual([]);
        vi.advanceTimersByTime(analysisSessionResendMs);
        expect(offers.map((offer) => offer.type)).toEqual([`analysisSession`]);
    });

    it('calls a request off without fault when the bot dials again or is withdrawn', async () => {
        const socket = new FakeSocket();
        sessions.attach(`b1`, socket);
        const replaced = sessions.read(`b1`, { setup: board, lines: 1, seconds: 2 });
        sessions.attach(`b1`, new FakeSocket());
        expect(await replaced).toEqual({ kind: `interrupted` });
        expect(socket.closed?.code).toBe(1000);
        const withdrawn = sessions.read(`b1`, { setup: board, lines: 1, seconds: 2 });
        sessions.close(`b1`);
        expect(await withdrawn).toEqual({ kind: `interrupted` });
        expect(sessions.isReady(`b1`)).toBe(false);
        vi.advanceTimersByTime(analysisSessionResendMs);
        expect(offers).toEqual([]);
    });
});
