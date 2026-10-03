import { useId } from 'react';
import type { GameCell } from '@hexo-arena/contract';
import { openingRadius, openingRegion } from '@hexo-arena/rules';
import { ShineDefs, StoneArt } from '../board/Board';
import { cellPoints, cellSize, hexCenter } from '../board/geometry';

// The whole region a draw may use, so the opening sits where every game's could.
const disk = [{ x: 0, y: 0 }, ...openingRegion];

const halfWidth = (Math.sqrt(3) / 2) * cellSize;
const extentX = Math.sqrt(3) * cellSize * openingRadius + halfWidth + cellSize * 0.3;
const extentY = 1.5 * cellSize * openingRadius + cellSize * 1.3;
const viewBox = [-extentX, -extentY, 2 * extentX, 2 * extentY].map((value) => value.toFixed(2)).join(` `);

/** An opening a duel's pair drew, its stones on the region every opening is drawn in. */
export function OpeningStones({ cells, label }: { cells: readonly GameCell[]; label: string }) {
    const shine = `stones${useId().replace(/:/g, ``)}`;
    return (
        <svg className="opening-preview board-svg" viewBox={viewBox} role="img" aria-label={label}>
            <ShineDefs id={shine} />
            {disk.map((cell) => {
                const { cx, cy } = hexCenter(cell);
                return <polygon key={`${String(cell.x)},${String(cell.y)}`} className="cell" points={cellPoints()} transform={`translate(${cx.toFixed(2)} ${cy.toFixed(2)})`} />;
            })}
            {cells.map((stone) => {
                const { cx, cy } = hexCenter(stone);
                return (
                    <g key={`${String(stone.x)},${String(stone.y)}`} transform={`translate(${cx.toFixed(2)} ${cy.toFixed(2)})`}>
                        <StoneArt side={stone.side} shine={shine} />
                    </g>
                );
            })}
        </svg>
    );
}
