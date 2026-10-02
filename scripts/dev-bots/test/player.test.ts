import { hexDistance, lineAxes, place, replay, type Coord, type Position } from '@hexo-arena/rules';
import { describe, expect, it } from 'vitest';
import { chooseGreedyTurn, chooseTurn } from '../src/player';

const opening: Position = {
    stones: [
        { x: 0, y: 0, player: 0 },
        { x: 1, y: 0, player: 1 },
        { x: -1, y: 1, player: 1 },
    ],
};

describe('chooseTurn', () => {
    it('picks two distinct empty cells, each touching a stone', () => {
        for (const draw of [0, 0.3, 0.6, 0.999]) {
            const [first, second] = chooseTurn(opening, () => draw);
            expect(first).not.toEqual(second);
            for (const cell of [first, second]) {
                expect(opening.stones.some((stone) => stone.x === cell.x && stone.y === cell.y)).toBe(false);
                expect(opening.stones.some((stone) => hexDistance(stone, cell) === 1)).toBe(true);
            }
        }
    });

    it('answers a turn the rules accept stone by stone', () => {
        const [first, second] = chooseTurn(opening, () => 0.5);
        const placed = place(opening, first);
        expect(placed.ok).toBe(true);
        if (placed.ok) expect(place(placed.position, second).ok).toBe(true);
    });

    it('plays from the lone origin', () => {
        const [first, second] = chooseTurn({ stones: [{ x: 0, y: 0, player: 0 }] }, () => 0);
        expect(hexDistance(first, { x: 0, y: 0 })).toBe(1);
        expect(hexDistance(second, { x: 0, y: 0 })).toBe(1);
    });
});

// A position from cells in placement order, the origin first.
function played(cells: readonly Coord[]): Position {
    const result = replay(cells);
    if (!result.ok) throw new Error(`illegal test position`);
    return result.position;
}

function longestRun(position: Position, player: 0 | 1): number {
    const owned = new Set(position.stones.filter((stone) => stone.player === player).map((stone) => `${String(stone.x)},${String(stone.y)}`));
    let longest = 0;
    for (const stone of position.stones.filter((each) => each.player === player)) {
        for (const axis of lineAxes) {
            let run = 1;
            while (owned.has(`${String(stone.x + run * axis.x)},${String(stone.y + run * axis.y)}`)) run += 1;
            longest = Math.max(longest, run);
        }
    }
    return longest;
}

describe('chooseGreedyTurn', () => {
    it('completes six when one stone wins', () => {
        // x holds (0,0) and (1..4,0); o holds two stones apart; x to move.
        const position = played([
            { x: 0, y: 0 },
            { x: 0, y: 3 },
            { x: 0, y: -3 },
            { x: 1, y: 0 },
            { x: 2, y: 0 },
            { x: 3, y: 3 },
            { x: 3, y: -3 },
            { x: 3, y: 0 },
            { x: 4, y: 0 },
            { x: -3, y: 3 },
            { x: -3, y: -1 },
        ]);
        const [first] = chooseGreedyTurn(position, () => 0);
        const placed = place(position, first);
        expect(placed.ok && placed.win?.player).toBe(0);
    });

    it('extends its own line rather than scattering', () => {
        // x to move, holding the origin alone, with an o pair nearby.
        const position = played([
            { x: 0, y: 0 },
            { x: 2, y: 2 },
            { x: 2, y: 3 },
        ]);
        const [first, second] = chooseGreedyTurn(position, () => 0);
        const afterFirst = place(position, first);
        if (!afterFirst.ok) throw new Error(`illegal first stone`);
        const afterSecond = place(afterFirst.position, second);
        if (!afterSecond.ok) throw new Error(`illegal second stone`);
        expect(longestRun(afterSecond.position, 0)).toBe(3);
    });
});
