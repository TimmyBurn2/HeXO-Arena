import { originSetup, playTurn, type Coord, type TurnCells } from '@hexo-arena/rules';

// A four-turn game whose first turn is a three-ply opening, in engine x,y.
export const workedTurns: TurnCells[] = [
    [
        { x: 1, y: 0 },
        { x: -1, y: 2 },
    ],
    [
        { x: 0, y: -1 },
        { x: 2, y: -2 },
    ],
    [
        { x: -2, y: 1 },
        { x: 3, y: -1 },
    ],
    [
        { x: 1, y: -1 },
        { x: -1, y: 0 },
    ],
];
export const workedText = `version[1];\n1. [1,0][1,-2];\n2. [-1,1][0,2];\n3. [-1,-1][2,1];\n4. [0,1][-1,0];\n`;

// A legal line of the given length with no six: pairs of cells walked row
// by row, skipping any pair the rules refuse or that would complete six.
export function drawLine(length: number): TurnCells[] {
    const width = 42;
    const cells: Coord[] = [];
    for (let index = 1; cells.length < 4 * length; index += 1) cells.push({ x: index % width, y: Math.floor(index / width) });
    const turns: TurnCells[] = [];
    let setup = originSetup;
    for (let at = 0; turns.length < length && at + 1 < cells.length; at += 2) {
        const [first, second] = [cells[at], cells[at + 1]];
        if (first === undefined || second === undefined) break;
        const played = playTurn(setup, [first, second]);
        if (!played.ok || played.win !== null) continue;
        turns.push([first, second]);
        setup = played.setup;
    }
    if (turns.length < length) throw new Error(`the row walk ran out of cells`);
    return turns;
}
