import { describe, expect, it } from 'vitest';
import {
    type Coord,
    emptyPosition,
    hexDistance,
    isWithinPlacementRadius,
    place,
    placementsRemaining,
    playerToMove,
    type Position,
    type RejectionKind,
    rejection,

    winner,
    type Win,
} from '../src';
import { createRng, type Rng } from './helpers/prng';

function playAll(coords: readonly Coord[]): Position {
    let position = emptyPosition;
    for (const coord of coords) {
        const result = place(position, coord);
        if (!result.ok) {
            throw new Error(`unexpected rejection ${result.rejection.kind}`);
        }
        position = result.position;
    }
    return position;
}

// A position reached by uniformly-ish sampling legal cells near the stones.
function randomPosition(rng: Rng, moves: number): Position {
    let position = emptyPosition;
    for (let i = 0; i < moves; i += 1) {
        const result = place(position, randomNearbyCoord(rng, position));
        if (result.ok) {
            position = result.position;
        }
    }
    return position;
}

function randomNearbyCoord(rng: Rng, position: Position): Coord {
    if (position.stones.length === 0) {
        return { x: 0, y: 0 };
    }
    const anchor = rng.pick(position.stones);
    let x = anchor.x;
    let y = anchor.y;
    while (x === anchor.x && y === anchor.y) {
        x = anchor.x + rng.int(17) - 8;
        y = anchor.y + rng.int(17) - 8;
    }
    return { x, y };
}

const wildValues = [1.5, -0.25, 1e9, -1e9, Number.POSITIVE_INFINITY, Number.NaN];

function wildCoord(rng: Rng): Coord {
    const pickWild = () => wildValues[rng.int(wildValues.length)] ?? 0;
    return { x: pickWild(), y: pickWild() };
}

function assertNever(value: never): never {
    throw new Error(`unreachable ${JSON.stringify(value)}`);
}

// Player 0 opens at the origin; the win lands on the 12th stone.
const straightWinMoves: readonly Coord[] = [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: 2 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 1, y: 1 },
    { x: 1, y: 2 },
    { x: 3, y: 0 },
    { x: 4, y: 0 },
    { x: 2, y: 1 },
    { x: 2, y: 2 },
    { x: 5, y: 0 },
];

// Player 1 completes a line with the first stone of a two-stone turn.
const midTurnWinMoves: readonly Coord[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: 2 },
    { x: 3, y: 0 },
    { x: 4, y: 0 },
    { x: -1, y: 0 },
    { x: -2, y: 0 },
    { x: 5, y: 0 },
    { x: 5, y: 1 },
    { x: -3, y: 0 },
    { x: -4, y: 0 },
    { x: 6, y: 0 },
];

describe('opening turn', () => {
    it('rejects a first stone anywhere but the origin', () => {
        expect(rejection(emptyPosition, { x: 1, y: 0 })?.kind).toBe(
            `first-stone-off-origin`,
        );
        expect(rejection(emptyPosition, { x: -3, y: 7 })?.kind).toBe(
            `first-stone-off-origin`,
        );
    });

    it('places the origin stone for player 0 as the single opening move', () => {
        const result = place(emptyPosition, { x: 0, y: 0 });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.position.stones).toEqual([
                { x: 0, y: 0, player: 0 },
            ]);
            expect(result.win).toBeNull();
        }
        expect(playerToMove(emptyPosition)).toBe(0);
        expect(placementsRemaining(emptyPosition)).toBe(1);
    });
});

describe('turn parity', () => {
    it('follows one opening stone then alternating pairs', () => {
        const rng = createRng(0x5eed);
        let position = emptyPosition;
        let expectedPlayer = 0;
        let expectedRemaining = 1;
        for (let move = 0; move < 200; move += 1) {
            expect(playerToMove(position)).toBe(expectedPlayer);
            expect(placementsRemaining(position)).toBe(expectedRemaining);
            const result = place(position, randomNearbyCoord(rng, position));
            if (result.ok) {
                position = result.position;
                if (expectedRemaining === 1) {
                    expectedPlayer = expectedPlayer === 0 ? 1 : 0;
                    expectedRemaining = 2;
                } else {
                    expectedRemaining = 1;
                }
            }
        }
    });
});

describe('placement radius', () => {
    it('is axial hex distance', () => {
        expect(hexDistance({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(0);
        expect(hexDistance({ x: 2, y: -2 }, { x: 0, y: 0 })).toBe(2);
        expect(hexDistance({ x: 3, y: 4 }, { x: 0, y: 0 })).toBe(7);
        expect(hexDistance({ x: -3, y: -4 }, { x: 1, y: 1 })).toBe(9);
    });

    it('chains: the board grows without bound, eight hexes at a time', () => {
        const chained = playAll([
            { x: 0, y: 0 },
            { x: 8, y: 0 },
            { x: 16, y: 0 },
        ]);
        expect(chained.stones).toHaveLength(3);
        const result = place(chained, { x: 24, y: 0 });
        expect(result.ok).toBe(true);
    });

    it('rejects a cell eight hexes past the outermost stone', () => {
        const chained = playAll([
            { x: 0, y: 0 },
            { x: 8, y: 0 },
        ]);
        expect(rejection(chained, { x: 17, y: 0 })?.kind).toBe(
            `outside-placement-radius`,
        );
        expect(rejection(chained, { x: 16, y: 0 })).toBeNull();
        expect(isWithinPlacementRadius(chained.stones, { x: 0, y: 8 })).toBe(true);
        expect(isWithinPlacementRadius(chained.stones, { x: 0, y: 9 })).toBe(false);
    });
});

describe('rejections', () => {
    it('refuses occupied cells', () => {
        const position = playAll([{ x: 0, y: 0 }]);
        expect(rejection(position, { x: 0, y: 0 })?.kind).toBe(`cell-occupied`);
    });

    it('finishes the game on a six line and then refuses everything', () => {
        let position = emptyPosition;
        let win: Win | null = null;
        for (const coord of straightWinMoves) {
            const result = place(position, coord);
            expect(result.ok).toBe(true);
            if (result.ok) {
                position = result.position;
                win = result.win;
            }
        }
        expect(win?.player).toBe(0);
        expect(win?.cells).toEqual([
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 2, y: 0 },
            { x: 3, y: 0 },
            { x: 4, y: 0 },
            { x: 5, y: 0 },
        ]);
        expect(winner(position)?.player).toBe(0);
        // Finished outranks occupied: the refusal reason is the game state.
        expect(rejection(position, { x: 0, y: 0 })?.kind).toBe(`game-finished`);
        expect(rejection(position, { x: 90, y: 90 })?.kind).toBe(`game-finished`);
    });

    it('ends the game mid-turn, on the first stone of a pair', () => {
        let position = emptyPosition;
        for (const coord of midTurnWinMoves) {
            const result = place(position, coord);
            expect(result.ok).toBe(true);
            if (result.ok) {
                position = result.position;
            }
        }
        expect(winner(position)).toEqual({
            player: 1,
            cells: [
                { x: 1, y: 0 },
                { x: 2, y: 0 },
                { x: 3, y: 0 },
                { x: 4, y: 0 },
                { x: 5, y: 0 },
                { x: 6, y: 0 },
            ],
        });
        expect(place(position, { x: 7, y: 0 }).ok).toBe(false);
    });

    it('is total: every input yields ok or one of the four closed reasons', () => {
        const rng = createRng(0xC10E);
        const observed = new Set<RejectionKind>();
        const positions = [
            emptyPosition,
            playAll(straightWinMoves),
            playAll(midTurnWinMoves),
        ];
        for (let i = 0; i < 40; i += 1) {
            positions.push(randomPosition(rng, rng.int(80)));
        }
        for (const position of positions) {
            const candidates = [
                wildCoord(rng),
                wildCoord(rng),
                { x: rng.int(61) - 30, y: rng.int(61) - 30 },
                { x: rng.int(61) - 30, y: rng.int(61) - 30 },
                randomNearbyCoord(rng, position),
            ];
            for (const candidate of candidates) {
                const result = place(position, candidate);
                if (result.ok) {
                    expect(result.position.stones).toHaveLength(
                        position.stones.length + 1,
                    );
                    continue;
                }
                switch (result.rejection.kind) {
                    case `game-finished`:
                    case `cell-occupied`:
                    case `first-stone-off-origin`:
                    case `outside-placement-radius`:
                        observed.add(result.rejection.kind);
                        break;
                    default:
                        assertNever(result.rejection);
                }
            }
        }
        expect(observed).toEqual(
            new Set<RejectionKind>([
                `game-finished`,
                `cell-occupied`,
                `first-stone-off-origin`,
                `outside-placement-radius`,
            ]),
        );
    });
});

describe('purity', () => {
    it('never mutates the position it applies to', () => {
        const rng = createRng(0x1AA7);
        for (let trial = 0; trial < 120; trial += 1) {
            const position = randomPosition(rng, rng.int(60));
            const before = structuredClone(position);
            for (let attempt = 0; attempt < 8; attempt += 1) {
                const candidate =
                    attempt % 2 === 0
                        ? randomNearbyCoord(rng, position)
                        : wildCoord(rng);
                const result = place(position, candidate);
                expect(position).toEqual(before);
                expect(position.stones).toEqual(before.stones);
                if (result.ok) {
                    expect(result.position.stones).not.toBe(position.stones);
                    expect(result.position.stones).toEqual([
                        ...before.stones,
                        result.position.stones[result.position.stones.length - 1],
                    ]);
                }
            }
        }
    });

    it('keeps stones in placement order with unique cells', () => {
        const rng = createRng(0x0d5a);
        const position = randomPosition(rng, 150);
        const seen = new Set<string>();
        for (const stone of position.stones) {
            const key = `${String(stone.x)},${String(stone.y)}`;
            expect(seen.has(key)).toBe(false);
            seen.add(key);
        }
    });
});
