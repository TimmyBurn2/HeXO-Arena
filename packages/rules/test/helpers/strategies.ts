import type { Coord, Player, Stone } from '../../src';
import type { Rng } from './prng';

// What a strategy needs from whichever engine is driving the game: the
// generator implements it over the HeXO oracle, the live test over the
// engine's position, so both play from the same move-choice code.
export interface Seat {
    stones(): readonly Stone[];
    playerToMove(): Player;
    isLegal(coord: Coord): boolean;
}

export type StrategyKind = `uniform` | `adjacent` | `greedy` | `spread`;

const unitDirections: readonly Coord[] = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: -1, y: 1 },
];

const axes: readonly Coord[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: -1 },
];

export function pickMove(
    seat: Seat,
    kind: StrategyKind,
    rng: Rng,
): Coord | null {
    const stones = seat.stones();
    if (stones.length === 0) {
        return { x: 0, y: 0 };
    }
    const chosen =
        kind === `greedy`
            ? extendLongestRun(seat, rng)
              : kind === `adjacent`
                ? stepAdjacent(stones, seat, rng)
                : stepSpread(stones, seat, rng);
    return chosen ?? sampleUniform(stones, seat, rng);
}

function stepAdjacent(
    stones: readonly Stone[],
    seat: Seat,
    rng: Rng,
): Coord | null {
    for (let attempt = 0; attempt < 12; attempt += 1) {
        const stone = rng.pick(stones);
        const dir = rng.pick(unitDirections);
        const candidate = { x: stone.x + dir.x, y: stone.y + dir.y };
        if (seat.isLegal(candidate)) {
            return candidate;
        }
    }
    return null;
}

function stepSpread(
    stones: readonly Stone[],
    seat: Seat,
    rng: Rng,
): Coord | null {
    for (let attempt = 0; attempt < 12; attempt += 1) {
        const stone = rng.pick(stones);
        const dir = rng.pick(unitDirections);
        const candidate = { x: stone.x + dir.x * 8, y: stone.y + dir.y * 8 };
        if (seat.isLegal(candidate)) {
            return candidate;
        }
    }
    return null;
}

function extendLongestRun(seat: Seat, rng: Rng): Coord | null {
    const stones = seat.stones();
    const player = seat.playerToMove();
    const owned = new Set(
        stones
            .filter((stone) => stone.player === player)
            .map((stone) => `${String(stone.x)},${String(stone.y)}`),
    );
    let best: { run: Coord[]; axis: Coord } | null = null;
    for (const stone of stones) {
        if (stone.player !== player) {
            continue;
        }
        for (const axis of axes) {
            const run = runThrough(owned, stone, axis);
            if (best === null || run.length > best.run.length) {
                best = { run, axis };
            }
        }
    }
    if (best === null) {
        return null;
    }
    const head = best.run[0];
    const tail = best.run[best.run.length - 1];
    if (head === undefined || tail === undefined) {
        return null;
    }
    const candidates = [
        { x: head.x - best.axis.x, y: head.y - best.axis.y },
        { x: tail.x + best.axis.x, y: tail.y + best.axis.y },
    ];
    const legal = candidates.filter((candidate) => seat.isLegal(candidate));
    return legal.length > 0 ? rng.pick(legal) : null;
}

function runThrough(owned: ReadonlySet<string>, stone: Coord, axis: Coord): Coord[] {
    const run: Coord[] = [];
    let x = stone.x;
    let y = stone.y;
    while (owned.has(`${String(x)},${String(y)}`)) {
        run.push({ x, y });
        x -= axis.x;
        y -= axis.y;
    }
    run.reverse();
    x = stone.x + axis.x;
    y = stone.y + axis.y;
    while (owned.has(`${String(x)},${String(y)}`)) {
        run.push({ x, y });
        x += axis.x;
        y += axis.y;
    }
    return run;
}

function sampleUniform(
    stones: readonly Stone[],
    seat: Seat,
    rng: Rng,
): Coord | null {
    for (let attempt = 0; attempt < 60; attempt += 1) {
        const anchor = rng.pick(stones);
        const candidate = {
            x: anchor.x + rng.int(17) - 8,
            y: anchor.y + rng.int(17) - 8,
        };
        if (seat.isLegal(candidate)) {
            return candidate;
        }
    }
    return null;
}
