import { streamKeepaliveMs, type StreamEvent } from '@hexarena/contract';
import { describe, expect, it, vi } from 'vitest';
import { PresenceRegistry } from '../src/presence';
import { FakeStreamSocket } from './helpers';


const gameStart = (gameId: string): StreamEvent => ({
    type: `gameStart`,
    gameId,
    side: `x`,
    opponent: { name: `otherbot`, rating: 1500, provisional: true },
    timeControl: { mode: `unlimited` },
    openingPlies: 5,
    rated: false,
    engine: { socketUrl: `/api/bot/game/${gameId}/socket`, token: `hgs_token` },
});

const moveRequest = (gameId: string): StreamEvent => ({
    type: `moveRequest`,
    gameId,
    request: { board: { to_move: `x`, cells: [] } },
});

describe('PresenceRegistry keepalive', () => {
    it('writes a bare newline every 10 s and nothing sooner', () => {
        vi.useFakeTimers();
        try {
            const registry = new PresenceRegistry();
            const socket = new FakeStreamSocket();
            registry.attach(`bot`, socket, false);
            vi.advanceTimersByTime(streamKeepaliveMs - 1);
            expect(socket.writes).toEqual([]);
            vi.advanceTimersByTime(1);
            expect(socket.writes).toEqual([`\n`]);
            vi.advanceTimersByTime(3 * streamKeepaliveMs);
            expect(socket.writes).toEqual([`\n`, `\n`, `\n`, `\n`]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('stops the keepalive and drops presence when the socket closes', () => {
        vi.useFakeTimers();
        try {
            const registry = new PresenceRegistry();
            const socket = new FakeStreamSocket();
            registry.attach(`bot`, socket, true);
            expect(registry.isOnline(`bot`)).toBe(true);
            socket.emitClose();
            expect(registry.isOnline(`bot`)).toBe(false);
            expect(registry.isOpenForChallenges(`bot`)).toBe(false);
            const writes = socket.writes.length;
            vi.advanceTimersByTime(5 * streamKeepaliveMs);
            expect(socket.writes).toHaveLength(writes);
        } finally {
            vi.useRealTimers();
        }
    });

    it('clears the keepalive on an explicit close and ends the socket', () => {
        vi.useFakeTimers();
        try {
            const registry = new PresenceRegistry();
            const socket = new FakeStreamSocket();
            registry.attach(`bot`, socket, true);
            registry.close(`bot`);
            expect(socket.ended).toBe(true);
            expect(registry.isOnline(`bot`)).toBe(false);
            const writes = socket.writes.length;
            vi.advanceTimersByTime(5 * streamKeepaliveMs);
            expect(socket.writes).toHaveLength(writes);
            socket.emitClose();
            expect(registry.isOnline(`bot`)).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('PresenceRegistry reconnect', () => {
    it('closes the old stream, stops its keepalive, and keeps the new one', () => {
        vi.useFakeTimers();
        try {
            const registry = new PresenceRegistry();
            const old = new FakeStreamSocket();
            const fresh = new FakeStreamSocket();
            registry.attach(`bot`, old, true);
            registry.attach(`bot`, fresh, false);
            expect(old.ended).toBe(true);
            expect(registry.isOnline(`bot`)).toBe(true);
            expect(registry.isOpenForChallenges(`bot`)).toBe(false);
            vi.advanceTimersByTime(3 * streamKeepaliveMs);
            expect(old.writes).toEqual([]);
            expect(fresh.writes).toEqual([`\n`, `\n`, `\n`]);
            // The replaced stream's close event arrives late and must not
            // touch the entry that replaced it.
            old.emitClose();
            expect(registry.isOnline(`bot`)).toBe(true);
            vi.advanceTimersByTime(streamKeepaliveMs);
            expect(fresh.writes).toHaveLength(4);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('PresenceRegistry replay', () => {
    it('writes the replay source as NDJSON lines in order on every attach', () => {
        const replay = vi.fn(() => [
            gameStart(`g1`),
            moveRequest(`g1`),
            gameStart(`g2`),
        ] as const);
        const registry = new PresenceRegistry(replay);
        const first = new FakeStreamSocket();
        registry.attach(`bot`, first, true);
        expect(first.writes).toEqual([
            `${JSON.stringify(gameStart(`g1`))}\n`,
            `${JSON.stringify(moveRequest(`g1`))}\n`,
            `${JSON.stringify(gameStart(`g2`))}\n`,
        ]);
        const second = new FakeStreamSocket();
        registry.attach(`bot`, second, false);
        expect(second.writes).toEqual(first.writes);
    });

    it('asks the replay source for the connecting bot', () => {
        const replay = vi.fn(() => [] as const);
        const registry = new PresenceRegistry(replay);
        registry.attach(`some-bot`, new FakeStreamSocket(), false);
        expect(replay).toHaveBeenCalledWith(`some-bot`);
    });

    it('writes no replay lines when the source has none', () => {
        const registry = new PresenceRegistry(() => []);
        const socket = new FakeStreamSocket();
        registry.attach(`bot`, socket, false);
        expect(socket.writes).toEqual([]);
    });
});

describe('PresenceRegistry open declaration', () => {
    it('reports open-for-challenges only while an open stream is held', () => {
        const registry = new PresenceRegistry();
        const socket = new FakeStreamSocket();
        registry.attach(`bot`, socket, true);
        expect(registry.isOnline(`bot`)).toBe(true);
        expect(registry.isOpenForChallenges(`bot`)).toBe(true);
        socket.emitClose();
        expect(registry.isOpenForChallenges(`bot`)).toBe(false);
    });

    it('keeps a plain stream online but not open', () => {
        const registry = new PresenceRegistry();
        registry.attach(`bot`, new FakeStreamSocket(), false);
        expect(registry.isOnline(`bot`)).toBe(true);
        expect(registry.isOpenForChallenges(`bot`)).toBe(false);
    });
});
