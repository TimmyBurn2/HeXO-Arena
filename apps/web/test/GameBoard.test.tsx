// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
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
                idleLabel="game finished"
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
        const notes: (string | null)[] = [];
        render(
            <GameBoard
                stones={cells.map((cell, index) => ({ ...cell, number: index + 1 }))}
                position={{ stones: cells.map((cell) => ({ ...cell, player: cell.side === `x` ? 0 : 1 })) }}
                you="x"
                lastMove={[]}
                winLine={[]}
                yourMove
                idleLabel="game finished"
                onCommit={async (pair) => {
                    commits.push(pair);
                    await Promise.resolve();
                    return true;
                }}
                onStatus={(status) => {
                    notes.push(status.note);
                }}
            />,
        );
        fireEvent.click(document.querySelector(`polygon.cell[data-x="0"][data-y="0"]`) as SVGElement);
        expect(notes.at(-1)).toBe(`That cell is taken`);
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
                idleLabel="game finished"
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
                idleLabel="game finished"
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

    it('draw only the frontier and take no keys when it is not your move', () => {
        render(
            <GameBoard
                stones={cells.map((cell, index) => ({ ...cell, number: index + 1 }))}
                position={{ stones: cells.map((cell) => ({ ...cell, player: cell.side === `x` ? 0 : 1 })) }}
                you="x"
                lastMove={[]}
                winLine={[]}
                yourMove={false}
                idleLabel="waiting for hextide"
                onCommit={async () => {
            await Promise.resolve();
            return true;
        }}
            />,
        );
        const control = document.querySelector(`.board-control`) as HTMLElement;
        // Still focusable, so the arrows scroll the camera, but no longer an application.
        expect(control.getAttribute(`tabindex`)).toBe(`0`);
        expect(control.getAttribute(`role`)).toBe(`group`);
        fireEvent.keyDown(control, { key: `Enter` });
        expect(document.querySelector(`polygon.ring-pending`)).toBe(null);
        expect(document.querySelector(`svg[data-marks]`)).toBe(null);
        expect(document.querySelector(`polygon.cell[data-x="10"][data-y="0"]`)).toBe(null);
        expect(control.getAttribute(`aria-label`)).toBe(`board, waiting for hextide`);
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
                idleLabel="game finished"
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
