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
    type Stone,
    winner,
} from '../src';
import { planSmoke } from './helpers/corpus';
import { type Oracle, loadOracle, oracleRejectionKind } from './helpers/oracle';
import { createRng, type Rng } from './helpers/prng';
import { type Seat, pickMove } from './helpers/strategies';

const oracle = await loadOracle();

// Runs only where the sibling HeXO checkout exists; CI replays the committed
// corpus instead.
describe.skipIf(oracle === null)(`live oracle differential`, () => {
    // skipIf ran the body only when the load succeeded, so the oracle is set.
    const hexo = oracle as Oracle;
    it(`agrees move by move on lockstep games`, () => {
        const rng = createRng(0x5eed);
        for (const plan of planSmoke()) {
            let position = emptyPosition;
            const game = hexo.newGame();
            for (let move = 0; move < plan.cap; move += 1) {
                if (winner(position) !== null) {
                    break;
                }
                expect(playerToMove(position)).toBe(hexo.playerToMove(game));
                expect(placementsRemaining(position)).toBe(
                    hexo.placementsRemaining(game),
                );
                const coord =
                    plan.kind === `origin-only`
                        ? { x: 0, y: 0 }
                        : plan.kind === `empty`
                          ? null
                          : pickMove(rulesSeat(position), plan.kind, rng);
                if (coord === null) {
                    break;
                }
                const ours = place(position, coord);
                const message = hexo.apply(
                    game,
                    hexo.playerToMove(game),
                    coord,
                );
                if (ours.ok) {
                    if (message !== null) {
                        throw new Error(`oracle rejected what we accepted: ${message}`);
                    }
                    position = ours.position;
                    expect(cellIds(position.stones)).toEqual(
                        cellIds(hexo.stones(game)),
                    );
                    const theirWin = hexo.winLine(game);
                    expect(ours.win?.player ?? null).toBe(theirWin?.player ?? null);
                    expect(ours.win?.cells ?? null).toEqual(theirWin?.cells ?? null);
                } else {
                    if (message === null) {
                        throw new Error(
                            `oracle accepted what we rejected: ${ours.rejection.kind}`,
                        );
                    }
                    expect(oracleRejectionKind(message)).toBe(ours.rejection.kind);
                }
            }
        }
    });

    it(`agrees on hex distance and radius membership`, () => {
        const rng = createRng(0x0157);
        const position = playGreedy(rng, 40);
        const game = replayOracle(position.stones);
        for (let i = 0; i < 500; i += 1) {
            const a = randomCoord(rng);
            const b = randomCoord(rng);
            expect(hexDistance(a, b)).toBe(hexo.hexDistance(a, b));
            expect(isWithinPlacementRadius(position.stones, a)).toBe(
                hexo.isWithinRadius(game, a),
            );
        }
    });

    it(`agrees on every refusal against a finished board`, () => {
        const rng = createRng(0x2171);
        const position = playGreedy(rng, 120);
        const game = replayOracle(position.stones);
        const win = winner(position);
        if (win === null) {
            throw new Error(`greedy game did not finish`);
        }
        for (let x = -2; x <= 12; x += 1) {
            for (let y = -2; y <= 12; y += 1) {
                const coord = { x, y };
                const ours = place(position, coord);
                const message = hexo.apply(
                    game,
                    hexo.playerToMove(game),
                    coord,
                );
                if (ours.ok) {
                    throw new Error(`we accepted a move after the win`);
                }
                if (message === null) {
                    throw new Error(`oracle accepted a move after the win`);
                }
                expect(oracleRejectionKind(message)).toBe(ours.rejection.kind);
            }
        }
    });

    function rulesSeat(position: Position): Seat {
        return {
            stones: () => position.stones,
            playerToMove: () => playerToMove(position),
            isLegal: (coord) => place(position, coord).ok,
        };
    }

    function playGreedy(rng: Rng, cap: number): Position {
        let position = emptyPosition;
        for (let move = 0; move < cap; move += 1) {
            if (winner(position) !== null) {
                break;
            }
            const coord = pickMove(rulesSeat(position), `greedy`, rng);
            if (coord === null) {
                break;
            }
            const result = place(position, coord);
            if (!result.ok) {
                throw new Error(`self-play rejected its own move`);
            }
            position = result.position;
        }
        return position;
    }

    function replayOracle(stones: readonly Stone[]): ReturnType<typeof hexo.newGame> {
        const game = hexo.newGame();
        for (const stone of stones) {
            const message = hexo.apply(
                game,
                hexo.playerToMove(game),
                { x: stone.x, y: stone.y },
            );
            if (message !== null) {
                throw new Error(`oracle rejected a replay move: ${message}`);
            }
        }
        return game;
    }

    function randomCoord(rng: Rng): Coord {
        return { x: rng.int(41) - 20, y: rng.int(41) - 20 };
    }

    function cellIds(cells: readonly Stone[]): string[] {
        return cells
            .map(
                (cell) =>
                    `${String(cell.x)},${String(cell.y)}:${String(cell.player)}`,
            )
            .sort();
    }
});
