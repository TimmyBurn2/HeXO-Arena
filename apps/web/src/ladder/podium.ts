import { cellSize } from '../board/geometry';

/** A place on the podium: first in the middle, second to its left, third to its right. */
export type Place = 1 | 2 | 3;

// Every place in the order the eye reads the podium, left to right.
const placesLeftToRight: readonly Place[] = [2, 1, 3];

// The stones each place's tower stands, the first's six a won line.
const towerStones: Readonly<Record<Place, number>> = { 1: 6, 2: 5, 3: 4 };

// The podium is a strip of flat-top board, so a column of cells is one of
// the three line axes: across the flats a column steps 1.5 cell sizes, and
// down a column each cell steps the flats' width.
const columnStep = 1.5 * cellSize;
const rowStep = Math.sqrt(3) * cellSize;

// The floor is two rows of empty cells, the towers stand on its top row,
// and half a row of board shows above the tallest.
const floorRows = 2;
const roomAbove = 0.5;

/** A cell center in the podium's svg units. */
export interface Point {
    readonly x: number;
    readonly y: number;
}

export interface Tower {
    readonly place: Place;
    readonly stones: readonly Point[];
    /** How far below the strip's top edge the tower's top cell begins, as a share of the strip's width. */
    readonly drop: number;
}

export interface PodiumLayout {
    readonly viewBox: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
    readonly floor: readonly Point[];
    readonly towers: readonly Tower[];
}

/**
 * The podium's geometry for towers `spread` columns apart, each at the
 * middle of its third of the strip, so plates laid in three equal columns
 * stand over them; only the places given get a tower.
 * The towers' columns are even, so their stones share rows.
 */
export function podiumLayout(spread: number, places: readonly Place[]): PodiumLayout {
    const w = 3 * spread * columnStep;
    const top = -(towerStones[1] - 1 + 0.5 + roomAbove) * rowStep;
    const bottom = (floorRows + 0.5) * rowStep;
    const reach = Math.ceil((w / 2 + cellSize) / columnStep);
    const floor: Point[] = [];
    for (let column = -reach; column <= reach; column += 1) {
        const shift = Math.abs(column) % 2 === 1 ? 0.5 : 0;
        for (let row = 1; row <= floorRows; row += 1) floor.push({ x: column * columnStep, y: (row + shift) * rowStep });
    }
    const towerX: Readonly<Record<Place, number>> = { 1: 0, 2: -spread * columnStep, 3: spread * columnStep };
    const towers = placesLeftToRight
        .filter((place) => places.includes(place))
        .map((place): Tower => {
            const count = towerStones[place];
            const stones = Array.from({ length: count }, (_, index) => ({ x: towerX[place], y: -index * rowStep }));
            const cellTop = -(count - 0.5) * rowStep;
            return { place, stones, drop: (cellTop - top) / w };
        });
    return { viewBox: { x: -w / 2, y: top, w, h: bottom - top }, floor, towers };
}
