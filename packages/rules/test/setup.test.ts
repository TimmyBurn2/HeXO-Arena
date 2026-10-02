import { describe, expect, it } from 'vitest';
import {
    type Coord,
    originSetup,
    otherPlayer,
    playTurn,
    positionKey,
    replay,
    type Setup,
    setupProblem,
    type Stone,
    type TurnCells,
    type TurnPlay,
} from '../src';
import { createRng } from './helpers/prng';

function played(result: TurnPlay): Setup {
    if (!result.ok) throw new Error(`unexpected refusal ${result.rejection.kind} at ${String(result.index)}`);
    return result.setup;
}

function stones(player: 0 | 1, ...cells: readonly (readonly [number, number])[]): Stone[] {
    return cells.map(([x, y]) => ({ x, y, player }));
}

describe('playTurn', () => {
    it('places two stones for the player to move and passes the move', () => {
        const result = playTurn(originSetup, [
            { x: 1, y: 0 },
            { x: 0, y: 1 },
        ]);
        expect(result).toEqual({
            ok: true,
            setup: { stones: [...originSetup.stones, ...stones(1, [1, 0], [0, 1])], toMove: 0 },
            win: null,
        });
    });

    it('measures the second stone from the first as well as from the board', () => {
        const setup = played(playTurn(originSetup, [
            { x: 8, y: 0 },
            { x: 16, y: 0 },
        ]));
        expect(setup.stones).toHaveLength(3);
    });

    it('refuses a stone beyond the radius of every stone and names its index', () => {
        expect(playTurn(originSetup, [
            { x: 1, y: 0 },
            { x: 0, y: 10 },
        ])).toEqual({ ok: false, index: 1, rejection: { kind: `outside-placement-radius` } });
    });

    it('refuses a taken cell, the turn\'s own first stone included', () => {
        expect(playTurn(originSetup, [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
        ])).toEqual({ ok: false, index: 0, rejection: { kind: `cell-occupied` } });
        expect(playTurn(originSetup, [
            { x: 1, y: 0 },
            { x: 1, y: 0 },
        ])).toEqual({ ok: false, index: 1, rejection: { kind: `cell-occupied` } });
    });

    it('ends the turn on a first stone that completes six', () => {
        const setup: Setup = { stones: stones(0, [0, 0], [1, 0], [2, 0], [3, 0], [4, 0]), toMove: 0 };
        const result = playTurn(setup, [{ x: 5, y: 0 }]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.win?.player).toBe(0);
        expect(result.win?.cells).toHaveLength(6);
        expect(result.setup.toMove).toBe(1);
    });

    it('refuses a second stone after a first that completes six', () => {
        const setup: Setup = { stones: stones(0, [0, 0], [1, 0], [2, 0], [3, 0], [4, 0]), toMove: 0 };
        expect(playTurn(setup, [
            { x: 5, y: 0 },
            { x: 0, y: 1 },
        ])).toEqual({ ok: false, index: 1, rejection: { kind: `game-finished` } });
    });

    it('refuses a single stone that completes no six', () => {
        expect(playTurn(originSetup, [{ x: 1, y: 0 }])).toEqual({ ok: false, index: 1, rejection: { kind: `turn-unfinished` } });
    });

    it('refuses every turn on a set-up board that already holds a six anywhere', () => {
        const setup: Setup = {
            stones: [...stones(1, [0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3]), ...stones(0, [0, 0])],
            toMove: 0,
        };
        expect(playTurn(setup, [
            { x: -1, y: 0 },
            { x: -2, y: 0 },
        ])).toEqual({ ok: false, index: 0, rejection: { kind: `game-finished` } });
    });

    it('plays turns for whichever player a set-up board names', () => {
        const setup: Setup = { stones: stones(1, [0, 0], [2, 2]), toMove: 1 };
        const after = played(playTurn(setup, [
            { x: 1, y: 1 },
            { x: 3, y: 3 },
        ]));
        expect(after.stones.slice(2).map((stone) => stone.player)).toEqual([1, 1]);
        expect(after.toMove).toBe(0);
    });

    it('reaches the same stones and win as replaying the placements from the origin', () => {
        const rng = createRng(0xa11a);
        let wins = 0;
        for (let game = 0; game < 40; game += 1) {
            let setup = originSetup;
            const cells: Coord[] = [{ x: 0, y: 0 }];
            for (let turn = 0; turn < 60; turn += 1) {
                const turnCells = nearbyTurn(rng, setup);
                const result = playTurn(setup, turnCells);
                if (!result.ok) continue;
                cells.push(...turnCells);
                setup = result.setup;
                if (result.win !== null) {
                    const replayed = replay(cells);
                    expect(replayed.ok && replayed.win).toEqual(result.win);
                    wins += 1;
                    break;
                }
            }
            const replayed = replay(cells);
            expect(replayed.ok && replayed.position.stones).toEqual(setup.stones);
        }
        expect(wins).toBeGreaterThan(0);
    });
});

// Two cells near existing stones; the second may complete nothing, in which
// case the turn plays both, or the first may win, which the test trims.
function nearbyTurn(rng: ReturnType<typeof createRng>, setup: Setup): TurnCells {
    const pick = (): Coord => {
        const anchor = rng.pick(setup.stones);
        return { x: anchor.x + rng.int(5) - 2, y: anchor.y + rng.int(5) - 2 };
    };
    const first = pick();
    const alone = playTurn(setup, [first]);
    if (alone.ok) return [first];
    return [first, pick()];
}

describe('setupProblem', () => {
    const cap = 5;

    it('accepts a board with stones of either player and none in a six', () => {
        expect(setupProblem({ stones: stones(1, [3, 3], [4, 3]), toMove: 0 }, cap)).toBeNull();
    });

    it('refuses an empty board', () => {
        expect(setupProblem({ stones: [], toMove: 0 }, cap)).toEqual({ kind: `no-stones` });
    });

    it('refuses more stones than the cap', () => {
        const many = stones(0, [0, 0], [0, 2], [0, 4], [0, 6], [0, 8], [0, 10]);
        expect(setupProblem({ stones: many, toMove: 1 }, cap)).toEqual({ kind: `too-many-stones`, count: 6 });
    });

    it('refuses two stones on one cell', () => {
        const twice = [...stones(0, [2, -1]), ...stones(1, [2, -1])];
        expect(setupProblem({ stones: twice, toMove: 1 }, cap)).toEqual({ kind: `cell-taken`, cell: { x: 2, y: -1 } });
    });

    it('refuses a board that already holds a six, naming its cells', () => {
        const six = stones(1, [0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5]);
        expect(setupProblem({ stones: six, toMove: 0 }, 10)).toEqual({
            kind: `six-on-board`,
            win: { player: 1, cells: six.map(({ x, y }) => ({ x, y })) },
        });
    });
});

describe('positionKey', () => {
    it('ignores the order the stones were placed in', () => {
        const forward: Setup = { stones: [...stones(0, [0, 0], [1, 1]), ...stones(1, [2, 0])], toMove: 1 };
        const backward: Setup = { stones: [...forward.stones].reverse(), toMove: 1 };
        expect(positionKey(backward)).toBe(positionKey(forward));
    });

    it('tells apart the player to move and the owner of each stone', () => {
        const setup: Setup = { stones: [...stones(0, [0, 0]), ...stones(1, [2, 0])], toMove: 1 };
        expect(positionKey({ ...setup, toMove: otherPlayer(setup.toMove) })).not.toBe(positionKey(setup));
        const swapped = setup.stones.map((stone) => ({ ...stone, player: otherPlayer(stone.player) }));
        expect(positionKey({ ...setup, stones: swapped })).not.toBe(positionKey(setup));
    });

    it('tells apart the same shape at another place', () => {
        const here: Setup = { stones: stones(0, [0, 0], [1, 0]), toMove: 1 };
        const there: Setup = { stones: stones(0, [1, 0], [2, 0]), toMove: 1 };
        expect(positionKey(there)).not.toBe(positionKey(here));
    });
});
