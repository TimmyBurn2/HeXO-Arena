// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { nameKeyOf, sigilCells } from '@hexo-arena/contract';
import { afterEach, describe, expect, it } from 'vitest';
import { Sigil } from '../src/components/Sigil';

afterEach(() => {
    cleanup();
});

// The number of cells a path draws: one move per hexagon.
function cellsIn(path: Element | null): number {
    return (path?.getAttribute(`d`) ?? ``).split(`M`).length - 1;
}

describe('Sigil', () => {
    it('draw the lit cells of the name and trace the others, hidden from assistive technology', () => {
        const { container } = render(<Sigil nameKey="devowner-c" />);
        const svg = container.querySelector(`svg.sigil`);
        expect(svg?.getAttribute(`aria-hidden`)).toBe(`true`);
        const lit = sigilCells(`devowner-c`).filter(Boolean).length;
        expect(cellsIn(container.querySelector(`.sigil-on`))).toBe(lit);
        expect(cellsIn(container.querySelector(`.sigil-off`))).toBe(7 - lit);
    });

    it('light the center first, then the ring from the right', () => {
        const { container } = render(<Sigil nameKey="quinn" />);
        // quinn lights the center and the right and left cells alone.
        const centers = (container.querySelector(`.sigil-on`)?.getAttribute(`d`) ?? ``)
            .split(`M`)
            .slice(1)
            .map((cell) => cell.split(`L`)[0]);
        expect(centers).toEqual([`50.00,37.40`, `75.11,37.40`, `24.89,37.40`]);
    });

    it('tell three owners of one stem apart', () => {
        const drawn = [`devowner-a`, `devowner-b`, `devowner-c`].map((name) => {
            const { container, unmount } = render(<Sigil nameKey={nameKeyOf(name)} />);
            const path = container.querySelector(`.sigil-on`)?.getAttribute(`d`);
            unmount();
            return path;
        });
        expect(new Set(drawn).size).toBe(3);
    });

    it('draw a guest as the empty rosette', () => {
        const { container } = render(<Sigil nameKey={null} />);
        expect(container.querySelector(`svg.sigil-guest`)).toBeTruthy();
        expect(container.querySelector(`.sigil-on`)).toBe(null);
        expect(cellsIn(container.querySelector(`.sigil-off`))).toBe(7);
    });
});
