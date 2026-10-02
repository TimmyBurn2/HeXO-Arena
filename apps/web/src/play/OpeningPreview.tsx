import { useId, useMemo } from 'react';
import type { OpeningPlies } from '@hexo-arena/contract';
import { drawOpening, openingRadius, openingRegion } from '@hexo-arena/rules';
import { ShineDefs, StoneArt } from '../board/Board';
import { cellPoints, cellSize, hexCenter } from '../board/geometry';
import { text } from '../text';

// The whole region a draw may use: the origin and every cell within the opening radius,
// so the example shows where each game's stones can land.
const disk = [{ x: 0, y: 0 }, ...openingRegion];

const halfWidth = (Math.sqrt(3) / 2) * cellSize;
const extentX = Math.sqrt(3) * cellSize * openingRadius + halfWidth + cellSize * 0.3;
const extentY = 1.5 * cellSize * openingRadius + cellSize * 1.3;
const viewBox = [-extentX, -extentY, 2 * extentX, 2 * extentY].map((value) => value.toFixed(2)).join(` `);

/** A uniform integer below `bound`, as the rules package's draw asks for one. */
export type IndexSource = (bound: number) => number;

const browserRandom: IndexSource = (bound) => Math.floor(Math.random() * bound);

/**
 * An example opening of `plies` stones, drawn as the server draws one, so
 * every example is one a game could deal; `draw` changes to ask for a new
 * example of the same count.
 */
export function OpeningPreview({ plies, draw, random = browserRandom }: { plies: OpeningPlies; draw: number; random?: IndexSource }) {
    const shine = `opening${useId().replace(/:/g, ``)}`;
    // `draw` only asks for a new example, so it keys the memo without being read.
    const stones = useMemo(() => drawOpening(plies, random).stones, [plies, random, draw]);
    return (
        <svg className="opening-preview board-svg" viewBox={viewBox} role="img" aria-label={text.play.openingExample(plies)}>
            <ShineDefs id={shine} />
            {disk.map((cell) => {
                const { cx, cy } = hexCenter(cell);
                return <polygon key={`${String(cell.x)},${String(cell.y)}`} className="cell" points={cellPoints()} transform={`translate(${cx.toFixed(2)} ${cy.toFixed(2)})`} />;
            })}
            {stones.map((stone) => {
                const { cx, cy } = hexCenter(stone);
                return (
                    <g key={`${String(stone.x)},${String(stone.y)}`} transform={`translate(${cx.toFixed(2)} ${cy.toFixed(2)})`}>
                        <StoneArt side={stone.player === 0 ? `x` : `o`} shine={shine} />
                    </g>
                );
            })}
        </svg>
    );
}
