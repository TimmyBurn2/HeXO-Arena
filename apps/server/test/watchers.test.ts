import { gameWatcherCap, siteWatcherCap, streamBacklogLimitBytes, streamKeepaliveMs, type GameEvent } from '@hexo-arena/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { frameOf, GameWatchers } from '../src/watchers';
import { FakeStreamSocket } from './helpers';

const finish: GameEvent = { event: `finish`, data: { winner: `x`, reason: `surrender`, clock: { mode: `unlimited` } } };

function snapshotEvent(gameId: string): GameEvent {
    return {
        event: `snapshot`,
        data: {
            gameId,
            status: `in-progress`,
            players: {
                x: { name: `alphabot`, rating: 1500, provisional: true, kind: `bot` },
                o: { name: `Guest a1b2`, rating: null, provisional: false, kind: `guest` },
            },
            openingPlies: 1,
            board: { cells: [{ x: 0, y: 0, side: `x` }] },
            timeControl: { mode: `unlimited` },
            toMove: `o`,
            clock: { mode: `unlimited` },
        },
    };
}

function fill(watchers: GameWatchers, gameId: string, count: number, seated = false): FakeStreamSocket[] {
    return Array.from({ length: count }, () => {
        const socket = new FakeStreamSocket();
        watchers.attach(gameId, socket, seated, snapshotEvent(gameId));
        return socket;
    });
}

describe('GameWatchers', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('writes the opening event as one event line and one data line', () => {
        const watchers = new GameWatchers();
        const [socket] = fill(watchers, `g1`, 1);
        expect(socket?.writes).toEqual([frameOf(snapshotEvent(`g1`))]);
        expect(frameOf(finish)).toBe(`event: finish\ndata: ${JSON.stringify(finish.data)}\n\n`);
    });

    it('admits fifty watchers without a seat to one game and refuses the next', () => {
        const watchers = new GameWatchers();
        fill(watchers, `g1`, gameWatcherCap - 1);
        expect(watchers.admits(`g1`)).toBe(true);
        fill(watchers, `g1`, 1);
        expect(watchers.admits(`g1`)).toBe(false);
        expect(watchers.admits(`g2`)).toBe(true);
    });

    it('admits five hundred watchers without a seat across the site and refuses the next', () => {
        const watchers = new GameWatchers();
        for (let game = 0; game < siteWatcherCap / gameWatcherCap; game += 1) fill(watchers, `g${String(game)}`, gameWatcherCap);
        expect(watchers.unseatedCount()).toBe(siteWatcherCap);
        expect(watchers.admits(`fresh`)).toBe(false);
    });

    it('never counts a seated watcher against either cap', () => {
        const watchers = new GameWatchers();
        fill(watchers, `g1`, gameWatcherCap, true);
        expect(watchers.unseatedCount(`g1`)).toBe(0);
        expect(watchers.admits(`g1`)).toBe(true);
    });

    it('frees a dropped watcher\'s slot at once and stops its keepalive', () => {
        const watchers = new GameWatchers();
        const sockets = fill(watchers, `g1`, gameWatcherCap);
        const dropped = sockets[0];
        if (dropped === undefined) throw new Error(`no socket`);
        dropped.emitClose();
        expect(watchers.admits(`g1`)).toBe(true);
        expect(watchers.unseatedCount()).toBe(gameWatcherCap - 1);
        vi.advanceTimersByTime(streamKeepaliveMs);
        expect(dropped.writes).toHaveLength(1);
    });

    it('writes a comment line every keepalive interval and nothing sooner', () => {
        const watchers = new GameWatchers();
        const [socket] = fill(watchers, `g1`, 1);
        vi.advanceTimersByTime(streamKeepaliveMs - 1);
        expect(socket?.writes).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(socket?.writes.at(-1)).toBe(`:\n\n`);
    });

    it('publishes to the game\'s watchers only', () => {
        const watchers = new GameWatchers();
        const [mine] = fill(watchers, `g1`, 1);
        const [other] = fill(watchers, `g2`, 1);
        watchers.publish(`g1`, finish);
        expect(mine?.writes.at(-1)).toBe(frameOf(finish));
        expect(other?.writes).toHaveLength(1);
    });

    it('ends every stream of a game after its last event and forgets them', () => {
        const watchers = new GameWatchers();
        const sockets = fill(watchers, `g1`, 3);
        watchers.end(`g1`, finish);
        for (const socket of sockets) {
            expect(socket.writes.at(-1)).toBe(frameOf(finish));
            expect(socket.ended).toBe(true);
            socket.emitClose();
        }
        expect(watchers.unseatedCount()).toBe(0);
    });

    it('ends every stream of every game on shutdown', () => {
        const watchers = new GameWatchers();
        const sockets = [...fill(watchers, `g1`, 2), ...fill(watchers, `g2`, 1, true)];
        watchers.closeAll();
        expect(sockets.every((socket) => socket.ended)).toBe(true);
        expect(watchers.unseatedCount()).toBe(0);
        vi.advanceTimersByTime(streamKeepaliveMs);
        expect(sockets.every((socket) => socket.writes.length === 1)).toBe(true);
    });

    it('end a watcher whose reader stopped reading once its unsent events pass the backlog limit', () => {
        const watchers = new GameWatchers();
        const slow = new FakeStreamSocket();
        const reading = new FakeStreamSocket();
        watchers.attach(`g1`, slow, false, snapshotEvent(`g1`));
        watchers.attach(`g1`, reading, false, snapshotEvent(`g1`));
        slow.writableLength = streamBacklogLimitBytes + 1;
        watchers.publish(`g1`, finish);
        expect(slow.ended).toBe(true);
        expect(reading.ended).toBe(false);
        expect(watchers.unseatedCount(`g1`)).toBe(1);
    });
});
