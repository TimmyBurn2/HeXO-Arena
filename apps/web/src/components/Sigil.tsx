import { sigilCells, type SigilCells } from '@hexo-arena/contract';
import './Sigil.css';

// Pointy-top cells a little apart: the center, then the ring from the right,
// clockwise, in the order sigilCells gives them.
const spacing = 14.5;
const cellRadius = 12.6;
const centers: readonly (readonly [number, number])[] = [
    [50, 50],
    ...[0, 1, 2, 3, 4, 5].map((step) => {
        const angle = (step * Math.PI) / 3;
        return [50 + Math.sqrt(3) * spacing * Math.cos(angle), 50 + Math.sqrt(3) * spacing * Math.sin(angle)] as const;
    }),
];

function cellPath([cx, cy]: readonly [number, number]): string {
    const corners = [0, 1, 2, 3, 4, 5].map((corner) => {
        const angle = ((corner * 60 - 90) * Math.PI) / 180;
        return `${(cx + cellRadius * Math.cos(angle)).toFixed(2)},${(cy + cellRadius * Math.sin(angle)).toFixed(2)}`;
    });
    return `M${corners.join(`L`)}Z`;
}

const unlit: SigilCells = [false, false, false, false, false, false, false];

/**
 * A person's hexagon pattern, drawn from the fold of their name, or the
 * empty rosette of a guest; it is decoration beside the name, which says
 * who it is.
 */
export function Sigil({ nameKey }: { nameKey: string | null }) {
    const cells = nameKey === null ? unlit : sigilCells(nameKey);
    const paths = (lit: boolean) =>
        centers
            .filter((_center, index) => cells[index] === lit)
            .map(cellPath)
            .join(``);
    const on = paths(true);
    const off = paths(false);
    return (
        <svg className={`sigil${nameKey === null ? ` sigil-guest` : ``}`} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
            {off === `` ? null : <path className="sigil-off" d={off} />}
            {on === `` ? null : <path className="sigil-on" d={on} />}
        </svg>
    );
}
