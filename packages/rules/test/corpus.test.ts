import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { axialCoordSchema, playerColorSchema } from '@hexarena/contract';
import { describe, expect, it } from 'vitest';
import {
    emptyPosition,
    place,
    type Player,
    playerToMove,
    winner,
} from '../src';

// The corpus is our own fixture, not a wire contract, so its schema lives
// beside the test and reuses the contract's board primitives.
const moveSchema = axialCoordSchema.extend({ p: playerColorSchema });
const traceSchema = z.object({
    kind: z.enum([
        `uniform`,
        `adjacent`,
        `greedy`,
        `spread`,
        `empty`,
        `origin-only`,
    ]),
    moves: z.array(moveSchema),
    finalStones: z.array(moveSchema),
    outcome: z.object({
        winner: playerColorSchema.nullable(),
        line: z.array(axialCoordSchema).nullable(),
    }),
    probes: z.array(
        z.object({
            x: z.number().int(),
            y: z.number().int(),
            rejects: z.enum([
                `game-finished`,
                `cell-occupied`,
                `first-stone-off-origin`,
                `outside-placement-radius`,
            ]),
        }),
    ),
});
const corpusSchema = z.object({
    format: z.literal(1),
    seed: z.number().int(),
    traces: z.array(traceSchema),
});

function loadCorpus() {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(resolve(here, `corpus/traces.json`), `utf8`);
    return corpusSchema.parse(JSON.parse(raw));
}

type RecordedMove = { readonly x: number; readonly y: number; readonly p: Player };

function cellIds(
    cells: readonly { readonly x: number; readonly y: number; readonly player: Player }[],
): string[] {
    return cells
        .map(
            (cell) =>
                `${String(cell.x)},${String(cell.y)}:${String(cell.player)}`,
        )
        .sort();
}

// Moves fully determine the intermediate boards, so replaying them and
// comparing the final board transitively checks every board along the way.
describe('differential corpus', () => {
    it('parses', () => {
        const corpus = loadCorpus();
        expect(corpus.traces.length).toBeGreaterThan(100);
        expect(
            corpus.traces.some((trace) => trace.outcome.winner !== null),
        ).toBe(true);
    });

    it('replays every oracle trace to the same board, outcome and refusals', () => {
        const corpus = loadCorpus();
        for (const trace of corpus.traces) {
            let position = emptyPosition;
            for (const move of trace.moves as RecordedMove[]) {
                expect(playerToMove(position)).toBe(move.p);
                const result = place(position, { x: move.x, y: move.y });
                if (!result.ok) {
                    throw new Error(
                        `corpus move rejected: ${result.rejection.kind}`,
                    );
                }
                position = result.position;
            }
            expect(cellIds(position.stones)).toEqual(
                cellIds(
                    trace.finalStones.map((stone) => ({
                        x: stone.x,
                        y: stone.y,
                        player: stone.p,
                    })),
                ),
            );
            const win = winner(position);
            expect(win?.player ?? null).toBe(trace.outcome.winner);
            expect(win?.cells ?? null).toEqual(trace.outcome.line);
            for (const probe of trace.probes) {
                const result = place(position, { x: probe.x, y: probe.y });
                expect(result.ok).toBe(false);
                if (!result.ok) {
                    expect(result.rejection.kind).toBe(probe.rejects);
                }
            }
        }
    });
});
