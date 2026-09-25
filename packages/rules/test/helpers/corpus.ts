import type { Coord, Player, RejectionKind, Stone } from '../../src';
import type { Oracle, OracleGame } from './oracle';
import { oracleRejectionKind } from './oracle';
import { createRng, type Rng } from './prng';
import { type Seat, type StrategyKind, pickMove } from './strategies';

export type TraceKind = StrategyKind | `empty` | `origin-only`;

export interface TracePlan {
    kind: TraceKind;
    cap: number;
}

export interface CorpusTrace {
    kind: TraceKind;
    moves: readonly { x: number; y: number; p: Player }[];
    finalStones: readonly { x: number; y: number; p: Player }[];
    outcome: { winner: Player | null; line: readonly Coord[] | null };
    probes: readonly { x: number; y: number; rejects: RejectionKind }[];
}

export interface Corpus {
    format: 1;
    seed: number;
    traces: readonly CorpusTrace[];
}

// The committed corpus mix; regeneration with the same seed is byte-stable.
export function planCorpus(): TracePlan[] {
    return [
        ...repeat(`greedy`, 50, 120),
        ...repeat(`adjacent`, 40, 160),
        ...repeat(`uniform`, 40, 100),
        ...repeat(`spread`, 8, 80),
        { kind: `empty`, cap: 0 },
        { kind: `origin-only`, cap: 1 },
    ];
}

// A smaller mix for the live lockstep test against the sibling checkout.
export function planSmoke(): TracePlan[] {
    return [
        ...repeat(`greedy`, 8, 80),
        ...repeat(`adjacent`, 8, 60),
        ...repeat(`uniform`, 6, 40),
        ...repeat(`spread`, 4, 40),
        { kind: `origin-only`, cap: 1 },
    ];
}

function repeat(kind: StrategyKind, count: number, cap: number): TracePlan[] {
    return Array.from({ length: count }, () => ({ kind, cap }));
}

export function generateTraces(
    oracle: Oracle,
    plans: readonly TracePlan[],
    seed: number,
): CorpusTrace[] {
    const rng = createRng(seed);
    return plans.map((plan) => generateTrace(oracle, plan, rng));
}

function generateTrace(oracle: Oracle, plan: TracePlan, rng: Rng): CorpusTrace {
    const game = oracle.newGame();
    const moves: { x: number; y: number; p: Player }[] = [];
    while (moves.length < plan.cap && oracle.winLine(game) === null) {
        const coord =
            plan.kind === `empty`
                ? null
                : plan.kind === `origin-only`
                  ? { x: 0, y: 0 }
                  : pickMove(oracleSeat(oracle, game), plan.kind, rng);
        if (coord === null) {
            break;
        }
        const player = oracle.playerToMove(game);
        const message = oracle.apply(game, player, coord);
        if (message !== null) {
            throw new Error(`oracle rejected a chosen move: ${message}`);
        }
        moves.push({ x: coord.x, y: coord.y, p: player });
    }
    const finalStones = oracle.stones(game);
    return {
        kind: plan.kind,
        moves,
        finalStones: finalStones.map(({ x, y, player }) => ({ x, y, p: player })),
        outcome: toOutcome(oracle, game),
        probes: probesFor(oracle, game, finalStones),
    };
}

function oracleSeat(oracle: Oracle, game: OracleGame): Seat {
    return {
        stones: () => oracle.stones(game),
        playerToMove: () => oracle.playerToMove(game),
        isLegal: (coord) => oracle.isLegal(game, coord),
    };
}

function toOutcome(oracle: Oracle, game: OracleGame): CorpusTrace[`outcome`] {
    const win = oracle.winLine(game);
    return win === null
        ? { winner: null, line: null }
        : { winner: win.player, line: win.cells };
}

// Probes are placed against the finished board, so a finished game answers
// game-finished even for occupied cells: precedence is part of the record.
// They run last; an accepted probe would corrupt the trace, so it is an error.
function probesFor(
    oracle: Oracle,
    game: OracleGame,
    stones: readonly Stone[],
): CorpusTrace[`probes`] {
    if (stones.length === 0) {
        return [probe(oracle, game, { x: 1, y: 1 })];
    }
    const maxX = Math.max(...stones.map((stone) => stone.x));
    const first = stones[0];
    if (first === undefined) {
        throw new Error(`stones vanished`);
    }
    return [
        probe(oracle, game, { x: first.x, y: first.y }),
        probe(oracle, game, { x: maxX + 9, y: 0 }),
    ];
}

function probe(
    oracle: Oracle,
    game: OracleGame,
    coord: Coord,
): { x: number; y: number; rejects: RejectionKind } {
    const message = oracle.apply(game, oracle.playerToMove(game), coord);
    if (message === null) {
        throw new Error(`probe was legal`);
    }
    return { x: coord.x, y: coord.y, rejects: oracleRejectionKind(message) };
}
