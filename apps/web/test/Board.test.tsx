// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Board, type BoardStone } from '../src/board/Board';
import { defaultBoardSettings } from '../src/board/board-settings';
import { previewStones } from '../src/board/preview-position';

const stones: readonly BoardStone[] = previewStones;

afterEach(() => {
    cleanup();
});

function frameOf(ui: React.ReactElement): HTMLElement {
    return render(ui).container.querySelector(`.board-frame`) as HTMLElement;
}

describe('Board', () => {
    it('renders a cell for every visible coordinate', () => {
        const frame = frameOf(<Board stones={stones} settings={defaultBoardSettings} label="test board" />);
        expect(frame.querySelectorAll(`polygon.cell`).length).toBeGreaterThan(stones.length);
    });

    it('render every stone with its side and placement number', () => {
        const frame = frameOf(<Board stones={stones} settings={defaultBoardSettings} label="test board" />);
        expect(frame.querySelectorAll(`g.stone.s-x`).length).toBe(
            stones.filter((stone) => stone.side === `x`).length,
        );
        expect(frame.querySelector(`g.stone .number`)?.textContent).toBe(`1`);
    });

    it('carry the palette and stone style on the board root', () => {
        const frame = frameOf(
            <Board
                stones={stones}
                settings={{ ...defaultBoardSettings, palette: `walnut`, stones: `glyph` }}
                label="test board"
            />,
        );
        expect(frame.getAttribute(`data-board`)).toBe(`walnut`);
        expect(frame.getAttribute(`data-stones`)).toBe(`glyph`);
        expect(frame.hasAttribute(`data-numbers`)).toBe(false);
        expect(frame.hasAttribute(`data-coords`)).toBe(false);
    });

    it('set the overlay attributes only when the overlays are on', () => {
        const frame = frameOf(
            <Board stones={stones} settings={{ ...defaultBoardSettings, numbers: true, coords: true }} label="test board" />,
        );
        expect(frame.hasAttribute(`data-numbers`)).toBe(true);
        expect(frame.hasAttribute(`data-coords`)).toBe(true);
        expect(frame.querySelectorAll(`text.coord`).length).toBe(4);
    });

    it('draw the pending, focus, and last-move rings where asked', () => {
        const frame = frameOf(
            <Board
                stones={stones}
                settings={defaultBoardSettings}
                label="test board"
                overlays={{
                    pending: { x: 1, y: 2 },
                    focus: { x: 0, y: -2 },
                    lastMove: [{ x: 2, y: 1 }, { x: -4, y: 2 }],
                }}
            />,
        );
        expect(frame.querySelectorAll(`polygon.ring-pending`)).toHaveLength(1);
        expect(frame.querySelectorAll(`polygon.ring-focus`)).toHaveLength(1);
        expect(frame.querySelectorAll(`polygon.last-ring`)).toHaveLength(2);
    });

    it('draw the win line through the given cells', () => {
        const frame = frameOf(
            <Board
                stones={stones}
                settings={defaultBoardSettings}
                label="test board"
                overlays={{ winLine: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] }}
            />,
        );
        const line = frame.querySelector(`polyline.win-line`);
        expect((line?.getAttribute(`points`) ?? ``).split(` `)).toHaveLength(3);
    });

    it('report clicked cells by coordinate', () => {
        const clicked: { x: number; y: number }[] = [];
        const frame = frameOf(
            <Board
                stones={stones}
                settings={defaultBoardSettings}
                label="test board"
                onCellClick={(cell) => clicked.push(cell)}
            />,
        );
        const cell = frame.querySelector(`polygon.cell[data-x="3"][data-y="0"]`) as SVGElement;
        fireEvent.click(cell);
        expect(clicked).toEqual([{ x: 3, y: 0 }]);
    });

    it('expose the label to assistive technology', () => {
        render(<Board stones={stones} settings={defaultBoardSettings} label="the preview board" />);
        expect(screen.getByRole(`img`, { name: `the preview board` })).toBeTruthy();
    });
});
