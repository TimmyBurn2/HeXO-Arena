import { describe, expect, it } from 'vitest';
import type { FinishedGameEntry } from '@hexo-arena/contract';
import { formOf } from '../src/game/rundown';

function game(x: string, o: string, winner: `x` | `o` | null, extra: Partial<FinishedGameEntry> = {}): FinishedGameEntry {
    return {
        gameId: `g-${x}-${o}-${String(winner)}`,
        players: { x: { name: x, rating: 1500, provisional: false, kind: `bot` }, o: { name: o, rating: 1500, provisional: false, kind: `bot` } },
        winner,
        reason: winner === null ? `terminated` : `six-in-a-row`,
        timeControl: { mode: `unlimited` },
        openingPlies: 1,
        turns: 20,
        finishedAt: `2026-10-01T10:00:00Z`,
        rated: winner !== null,
        voided: false,
        ...extra,
    };
}

describe('formOf', () => {
    it('read the named player\'s last results from their own seat, newest first, five at most', () => {
        const games = [
            game(`hextide`, `pebble`, `x`),
            game(`pebble`, `HexTide`, `x`),
            game(`hextide`, `pebble`, null),
            game(`quietlake`, `hextide`, `o`),
            game(`hextide`, `pebble`, `o`),
            game(`hextide`, `pebble`, `x`),
        ];
        expect(formOf(games, `hextide`)).toEqual([`won`, `lost`, `none`, `won`, `lost`]);
    });

    it('leave out voided and aborted games, which count in no record', () => {
        const games = [game(`hextide`, `pebble`, `x`, { voided: true, rated: false }), game(`hextide`, `pebble`, null, { reason: `aborted` }), game(`hextide`, `pebble`, `o`)];
        expect(formOf(games, `hextide`)).toEqual([`lost`]);
    });
});
