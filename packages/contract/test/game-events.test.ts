import { describe, expect, it } from 'vitest';
import { gameEventSchema, gameFinishSchema, gameTurnSchema, gameWatcherCap, siteWatcherCap } from '../src/game-events';

const turn = {
    turn: 3,
    side: `o`,
    cells: [
        { x: 1, y: 0 },
        { x: 2, y: 0 },
    ],
    toMove: `x`,
    clock: { mode: `turn`, remainingTurnMs: 30_000 },
};

describe('gameTurnSchema', () => {
    it('carries one or two cells and nothing outside that', () => {
        expect(gameTurnSchema.parse(turn)).toEqual(turn);
        expect(gameTurnSchema.safeParse({ ...turn, cells: turn.cells.slice(0, 1) }).success).toBe(true);
        expect(gameTurnSchema.safeParse({ ...turn, cells: [] }).success).toBe(false);
        expect(gameTurnSchema.safeParse({ ...turn, cells: [...turn.cells, { x: 3, y: 0 }] }).success).toBe(false);
    });

    it('never numbers a player turn as the origin', () => {
        expect(gameTurnSchema.safeParse({ ...turn, turn: 0 }).success).toBe(false);
    });
});

describe('gameEventSchema', () => {
    it('pairs each event name with its own payload', () => {
        const finish = { winner: null, reason: `aborted`, voided: false, clock: { mode: `unlimited` } };
        expect(gameFinishSchema.parse(finish)).toEqual(finish);
        expect(gameEventSchema.parse({ event: `turn`, data: turn }).event).toBe(`turn`);
        expect(gameEventSchema.parse({ event: `finish`, data: finish }).event).toBe(`finish`);
        expect(gameEventSchema.safeParse({ event: `finish`, data: turn }).success).toBe(false);
        expect(gameEventSchema.safeParse({ event: `chat`, data: {} }).success).toBe(false);
    });
});

describe('watcher caps', () => {
    it('allow fifty watchers a game and five hundred in total', () => {
        expect(gameWatcherCap).toBe(50);
        expect(siteWatcherCap).toBe(500);
    });
});
