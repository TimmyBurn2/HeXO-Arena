import { useId } from 'react';
import type { Side } from '@hexo-arena/contract';
import type { ThemeId } from '../theme/themes';
import { ShineDefs, StoneArt } from './Board';
import { cellPoints, cellSize, hexCenter } from './geometry';
import './Board.css';

// A row of four cells, the middle two holding one stone each: the ground,
// the field a board mostly shows, and both sides, which is what a look
// changes on the board.
const cells: readonly { x: number; y: number; side: Side | null }[] = [
    { x: -1, y: 0, side: null },
    { x: 0, y: 0, side: `x` },
    { x: 1, y: 0, side: `o` },
    { x: 2, y: 0, side: null },
];

// Ground shows on every side, so the swatch reads as a board, not a chip.
const pad = cellSize * 0.3;
const halfWidth = (Math.sqrt(3) / 2) * cellSize;
const left = hexCenter({ x: -1, y: 0 }).cx - halfWidth - pad;
const right = hexCenter({ x: 2, y: 0 }).cx + halfWidth + pad;
const viewBox = [left, -cellSize - pad, right - left, 2 * (cellSize + pad)]
    .map((value) => value.toFixed(2))
    .join(` `);

/**
 * A look in miniature, drawn in its own theme whatever the page wears:
 * the board ground, a row of cells, and an x and an o stone with the
 * theme's own rim, mark, and shine.
 */
export function ThemeSwatch({ theme }: { theme: ThemeId }) {
    const shine = `swatch${useId().replace(/:/g, ``)}`;
    return (
        <svg className="theme-swatch" data-theme-preview={theme} viewBox={viewBox} aria-hidden="true">
            <ShineDefs id={shine} />
            {cells.map((cell) => {
                const { cx, cy } = hexCenter(cell);
                return (
                    <g key={cell.x} transform={`translate(${cx.toFixed(2)} ${cy.toFixed(2)})`}>
                        <polygon className="cell" points={cellPoints()} />
                        {cell.side === null ? null : <StoneArt side={cell.side} shine={shine} />}
                    </g>
                );
            })}
        </svg>
    );
}
