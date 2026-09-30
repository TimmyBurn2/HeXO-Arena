// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Board, type BoardStone } from '../src/board/Board';
import { defaultBoardSettings } from '../src/board/board-settings';
import { hexCenter, stonesFrame } from '../src/board/geometry';
import { midGameStones } from './mid-game';

const stones: readonly BoardStone[] = midGameStones;

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
        expect(frame.querySelector(`.numbers .number`)?.textContent).toBe(`1`);
    });

    it('render every stone as a hexagon matching its cell', () => {
        const frame = frameOf(<Board stones={stones} settings={defaultBoardSettings} label="test board" />);
        expect(frame.querySelectorAll(`g.stone polygon.body`).length).toBe(stones.length);
        expect(frame.querySelectorAll(`g.stone circle`).length).toBe(0);
    });

    it('leave the numbers attribute off by default', () => {
        const frame = frameOf(<Board stones={stones} settings={defaultBoardSettings} label="test board" />);
        expect(frame.hasAttribute(`data-numbers`)).toBe(false);
    });

    it('set the numbers attribute only when numbers are on, and draw no edge labels', () => {
        const frame = frameOf(<Board stones={stones} settings={{ ...defaultBoardSettings, numbers: true }} label="test board" />);
        expect(frame.hasAttribute(`data-numbers`)).toBe(true);
        expect(frame.querySelectorAll(`text:not(.number)`).length).toBe(0);
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

    it('lay the win line on a casing along the same path', () => {
        const frame = frameOf(
            <Board
                stones={stones}
                settings={defaultBoardSettings}
                label="test board"
                overlays={{ winLine: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] }}
            />,
        );
        const [casing, line] = frame.querySelectorAll(`polyline`);
        expect(casing?.getAttribute(`class`)).toBe(`win-casing`);
        expect(line?.getAttribute(`class`)).toBe(`win-line`);
        expect(casing?.getAttribute(`points`)).toBe(line?.getAttribute(`points`));
    });

    it('keep stone numbers above the win line', () => {
        const frame = frameOf(
            <Board
                stones={stones}
                settings={{ ...defaultBoardSettings, numbers: true }}
                label="test board"
                overlays={{ winLine: [{ x: 1, y: 0 }, { x: 2, y: 0 }] }}
            />,
        );
        const order = [...frame.querySelectorAll(`polyline.win-line, g.numbers`)].map((node) => node.getAttribute(`class`));
        expect(order).toEqual([`win-line`, `numbers`]);
    });

    it('cut the win line around exactly the numbers it crosses, only while numbers show', () => {
        const line = stones.slice(0, 2).map(({ x, y }) => ({ x, y }));
        const numbered = frameOf(
            <Board stones={stones} settings={{ ...defaultBoardSettings, numbers: true }} label="test board" overlays={{ winLine: line }} />,
        );
        const mask = numbered.querySelector(`mask`);
        expect([...(mask?.querySelectorAll(`text.number.cut`) ?? [])].map((node) => node.textContent)).toEqual(
            stones.slice(0, 2).map((stone) => String(stone.number)),
        );
        expect(numbered.querySelector(`g.win`)?.getAttribute(`mask`)).toBe(`url(#${mask?.id ?? ``})`);
        expect(numbered.querySelectorAll(`.numbers text.number`)).toHaveLength(stones.length);
        cleanup();
        const plain = frameOf(<Board stones={stones} settings={defaultBoardSettings} label="test board" overlays={{ winLine: line }} />);
        expect(plain.querySelector(`mask`)).toBeNull();
        expect(plain.querySelector(`g.win`)?.hasAttribute(`mask`)).toBe(false);
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

    it('draw the frontier edge and nothing beyond it', () => {
        const frame = frameOf(<Board stones={stones.slice(0, 1)} settings={defaultBoardSettings} label="test board" />);
        expect(frame.querySelector(`path.frontier`)?.getAttribute(`d`)).toMatch(/^M/);
        expect(frame.querySelectorAll(`polygon.cell`)).toHaveLength(217);
    });

    it('give every stone a shine layer the theme can light', () => {
        const frame = frameOf(<Board stones={stones} settings={defaultBoardSettings} label="test board" />);
        const shine = frame.querySelector(`g.stone polygon.shine`)?.getAttribute(`fill`) ?? ``;
        const id = /^url\(#(.+)\)$/.exec(shine)?.[1] ?? ``;
        expect(frame.querySelector(`radialGradient[id="${id}"]`)).toBeTruthy();
    });

    it('give every stone a mark layer above its shine', () => {
        const frame = frameOf(<Board stones={stones} settings={defaultBoardSettings} label="test board" />);
        const stone = frame.querySelector(`g.stone.s-o`);
        const layers = [...(stone?.querySelectorAll(`polygon`) ?? [])].map((node) => node.getAttribute(`class`));
        expect(layers).toEqual([`body b-o`, `shine`, `stone-mark m-o`]);
    });

    it('animate only stones placed after the first render', () => {
        const first = stones.slice(0, 3);
        const { container, rerender } = render(
            <Board stones={first} settings={defaultBoardSettings} label="test board" overlays={{ lastMove: first.slice(1) }} />,
        );
        expect(container.querySelectorAll(`g.stone.fresh`)).toHaveLength(0);
        expect(container.querySelectorAll(`.last-ring.fresh`)).toHaveLength(0);
        const next = stones.slice(0, 5);
        rerender(<Board stones={next} settings={defaultBoardSettings} label="test board" overlays={{ lastMove: next.slice(3) }} />);
        expect(container.querySelectorAll(`g.stone.fresh`)).toHaveLength(2);
        expect(container.querySelectorAll(`.last-ring.fresh`)).toHaveLength(2);
    });

    it('preview the pending stone in the mover\'s color', () => {
        const frame = frameOf(
            <Board
                stones={stones}
                settings={defaultBoardSettings}
                label="test board"
                overlays={{ pending: { x: 4, y: 0 }, pendingSide: `o` }}
            />,
        );
        expect(frame.querySelector(`polygon.ghost`)?.getAttribute(`class`)).toContain(`b-o`);
    });

    it('show only the cells a given frame holds, under that frame', () => {
        const frame = stonesFrame(stones, 4 / 3);
        const whole = frameOf(<Board stones={stones} settings={defaultBoardSettings} label="whole board" />);
        const all = whole.querySelectorAll(`polygon.cell`).length;
        cleanup();
        const framed = frameOf(<Board stones={stones} settings={defaultBoardSettings} label="framed board" frame={frame} />);
        const svg = framed.querySelector(`svg`);
        expect(svg?.getAttribute(`viewBox`)).toBe(`${frame.x.toFixed(2)} ${frame.y.toFixed(2)} ${frame.w.toFixed(2)} ${frame.h.toFixed(2)}`);
        const cells = [...framed.querySelectorAll(`polygon.cell`)];
        expect(cells.length).toBeLessThan(all);
        for (const cell of cells) {
            const { cx, cy } = hexCenter({ x: Number(cell.getAttribute(`data-x`)), y: Number(cell.getAttribute(`data-y`)) });
            expect(cx).toBeGreaterThan(frame.x - 28);
            expect(cx).toBeLessThan(frame.x + frame.w + 28);
            expect(cy).toBeGreaterThan(frame.y - 28);
            expect(cy).toBeLessThan(frame.y + frame.h + 28);
        }
        expect(framed.querySelectorAll(`g.stone`).length).toBe(stones.length);
        expect(framed.querySelector(`path.frontier`)).toBe(null);
    });
});
