import { analysisStoneCap } from '@hexo-arena/contract';
import { setupProblem, type Player, type Setup, type Stone } from '@hexo-arena/rules';
import type { NotationRead } from './notation';

/**
 * Read boat text, the position format of explore.htttx.io:
 * rows of `x`, `o`, and `.` joined by `/`, each row starting one step down-right of the last.
 * `X`, `O`, and `#`, that site's highlights, read as `x`, `o`, and an empty cell.
 * Boat carries no placement, so the first character of the first row is the origin.
 */
export function readBoat(text: string): NotationRead<readonly Stone[]> {
    const stones: Stone[] = [];
    let x = 0;
    let y = 0;
    let index = -1;
    for (const character of text) {
        index += 1;
        if (character === `/`) {
            x = 0;
            y += 1;
            continue;
        }
        const player = boatOwners.get(character);
        if (player === undefined) return { ok: false, error: { kind: `boat-character`, index, character } };
        if (player !== null) stones.push({ x, y, player });
        x += 1;
    }
    return { ok: true, value: stones };
}

const boatOwners: ReadonlyMap<string, Player | null> = new Map([
    [`x`, 0],
    [`X`, 0],
    [`o`, 1],
    [`O`, 1],
    [`.`, null],
    [`#`, null],
]);

/** The player to move when a boat position names none: o when x has more stones, else x. */
export function boatToMove(stones: readonly Stone[]): Player {
    const crosses = stones.filter((stone) => stone.player === 0).length;
    return crosses > stones.length - crosses ? 1 : 0;
}

/**
 * Read boat text as a board to play from, with `toMove` to move or else the default,
 * refusing a board that cannot be played from or analyzed.
 */
export function readBoatSetup(text: string, toMove: Player | null): NotationRead<Setup> {
    const read = readBoat(text);
    if (!read.ok) return read;
    const setup: Setup = { stones: read.value, toMove: toMove ?? boatToMove(read.value) };
    const problem = setupProblem(setup, analysisStoneCap);
    return problem === null ? { ok: true, value: setup } : { ok: false, error: { kind: `setup`, problem } };
}

/**
 * Boat text of a board, as explore.htttx.io writes it:
 * rows from the topmost stone down, each from the leftmost stone's column,
 * empty cells before a stone as `.`, empty cells after a row's last stone dropped.
 */
export function writeBoat(stones: readonly Stone[]): string {
    if (stones.length === 0) return ``;
    const left = Math.min(...stones.map((stone) => stone.x));
    const top = Math.min(...stones.map((stone) => stone.y));
    const bottom = Math.max(...stones.map((stone) => stone.y));
    const rows: (string | undefined)[][] = Array.from({ length: bottom - top + 1 }, () => []);
    for (const stone of stones) {
        const row = rows[stone.y - top];
        if (row === undefined) continue;
        row[stone.x - left] = stone.player === 0 ? `x` : `o`;
    }
    return rows.map((row) => Array.from(row, (cell) => cell ?? `.`).join(``)).join(`/`);
}
