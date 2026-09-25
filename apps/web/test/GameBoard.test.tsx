// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameBoard } from '../src/game/GameBoard';

const cells = [
    { x: 0, y: 0, side: `x` as const },
    { x: 1, y: -1, side: `o` as const },
    { x: 0, y: 1, side: `o` as const },
];

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('GameBoard', () => {
    it('marks a pending stone and commits the pair on the second mark', async () => {
        const commits: unknown[] = [];
        render(
            <GameBoard
                stones={cells.map((cell, index) => ({ ...cell, number: index + 1 }))}
                position={{ stones: cells.map((cell) => ({ ...cell, player: cell.side === `x` ? 0 : 1 })) }}
                you="x"
                lastMove={[]}
                winLine={[]}
                yourMove
                opponentMoving={false}
                opponentName="hextide"
                onCommit={async (pair) => {
                    commits.push(pair);
                    await Promise.resolve();
                    return true;
                }}
            />,
        );
        const control = document.querySelector(`.board-control`) as HTMLElement;
        const cellAt = (x: number, y: number) =>
            document.querySelector(`polygon.cell[data-x="${String(x)}"][data-y="${String(y)}"]`) as SVGElement;
        fireEvent.click(cellAt(1, 1));
        expect(document.querySelector(`polygon.ring-pending`)).toBeTruthy();
        fireEvent.click(cellAt(-1, 2));
        await waitFor(() => {
            expect(commits).toEqual([
                [
                    { x: 1, y: 1 },
                    { x: -1, y: 2 },
                ],
            ]);
        });
        expect(document.querySelector(`polygon.ring-pending`)).toBe(null);
        expect(control.getAttribute(`tabindex`)).toBe(`0`);
    });

    it('refuse an occupied cell with the note and no commit', () => {
        const commits: unknown[] = [];
        render(
            <GameBoard
                stones={cells.map((cell, index) => ({ ...cell, number: index + 1 }))}
                position={{ stones: cells.map((cell) => ({ ...cell, player: cell.side === `x` ? 0 : 1 })) }}
                you="x"
                lastMove={[]}
                winLine={[]}
                yourMove
                opponentMoving={false}
                opponentName="hextide"
                onCommit={async (pair) => {
                    commits.push(pair);
                    await Promise.resolve();
                    return true;
                }}
            />,
        );
        fireEvent.click(document.querySelector(`polygon.cell[data-x="0"][data-y="0"]`) as SVGElement);
        expect(screen.getByText(`that cell is taken`)).toBeTruthy();
        expect(document.querySelector(`polygon.ring-pending`)).toBe(null);
        expect(commits).toEqual([]);
    });

    it('move the focus with all six keys and mark with enter', async () => {
        const commits: unknown[] = [];
        render(
            <GameBoard
                stones={cells.map((cell, index) => ({ ...cell, number: index + 1 }))}
                position={{ stones: cells.map((cell) => ({ ...cell, player: cell.side === `x` ? 0 : 1 })) }}
                you="x"
                lastMove={[]}
                winLine={[]}
                yourMove
                opponentMoving={false}
                opponentName="hextide"
                onCommit={async (pair) => {
                    commits.push(pair);
                    await Promise.resolve();
                    return true;
                }}
            />,
        );
        const control = document.querySelector(`.board-control`) as HTMLElement;
        control.focus();
        for (const key of [`ArrowRight`, `ArrowDown`, `q`]) {
            fireEvent.keyDown(control, { key });
        }
        fireEvent.keyDown(control, { key: `Enter` });
        expect(document.querySelector(`polygon.ring-pending`)).toBeTruthy();
        fireEvent.keyDown(control, { key: `e` });
        fireEvent.keyDown(control, { key: ` ` });
        await waitFor(() => {
            expect(commits).toHaveLength(1);
        });
    });

    it('clear the pending stone with escape', () => {
        render(
            <GameBoard
                stones={cells.map((cell, index) => ({ ...cell, number: index + 1 }))}
                position={{ stones: cells.map((cell) => ({ ...cell, player: cell.side === `x` ? 0 : 1 })) }}
                you="x"
                lastMove={[]}
                winLine={[]}
                yourMove
                opponentMoving={false}
                opponentName="hextide"
                onCommit={async () => {
            await Promise.resolve();
            return true;
        }}
            />,
        );
        const control = document.querySelector(`.board-control`) as HTMLElement;
        fireEvent.click(document.querySelector(`polygon.cell[data-x="1"][data-y="1"]`) as SVGElement);
        expect(document.querySelector(`polygon.ring-pending`)).toBeTruthy();
        fireEvent.keyDown(control, { key: `Escape` });
        expect(document.querySelector(`polygon.ring-pending`)).toBe(null);
    });

    it('grow the board around the focus and ignore keys when it is not your move', () => {
        render(
            <GameBoard
                stones={cells.map((cell, index) => ({ ...cell, number: index + 1 }))}
                position={{ stones: cells.map((cell) => ({ ...cell, player: cell.side === `x` ? 0 : 1 })) }}
                you="x"
                lastMove={[]}
                winLine={[]}
                yourMove={false}
                opponentMoving
                opponentName="hextide"
                onCommit={async () => {
            await Promise.resolve();
            return true;
        }}
            />,
        );
        const control = document.querySelector(`.board-control`) as HTMLElement;
        expect(control.hasAttribute(`tabindex`)).toBe(false);
        expect(document.querySelector(`polygon.cell[data-x="10"][data-y="0"]`)).toBe(null);
        expect(document.querySelector(`.board-control-wrap kbd`)).toBe(null);
        expect(screen.getByText(`waiting for hextide to move`)).toBeTruthy();
    });

    it('stop the keyboard focus at the frontier edge', () => {
        render(
            <GameBoard
                stones={[{ x: 0, y: 0, side: `x`, number: 1 }]}
                position={{ stones: [{ x: 0, y: 0, player: 0 }] }}
                you="o"
                lastMove={[]}
                winLine={[]}
                yourMove
                opponentMoving={false}
                opponentName="hextide"
                onCommit={() => Promise.resolve(true)}
            />,
        );
        const control = document.querySelector(`.board-control`) as HTMLElement;
        for (let step = 0; step < 12; step += 1) fireEvent.keyDown(control, { key: `ArrowRight` });
        const focus = document.querySelector(`polygon.ring-focus`)?.getAttribute(`transform`);
        const edge = document.querySelector(`polygon.cell[data-x="8"][data-y="0"]`)?.getAttribute(`transform`);
        expect(focus).toBe(edge);
    });
});
