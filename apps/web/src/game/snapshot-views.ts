import { resultSentence, turnsOnBoard, type GameSnapshot, type Side } from '@hexo-arena/contract';
import { winner, type Position, type Rejection, type Stone } from '@hexo-arena/rules';
import type { BoardStone } from '../board/Board';
import type { AxialCoord } from '@hexo-arena/contract';
import { text } from '../text';

/**
 * One feed line: its turn label, the label as assistive tech reads it, and
 * the side-and-stones groups it holds; a group is one turn's stones and
 * never wraps apart.
 */
export interface FeedLine {
    label: string;
    spoken: string;
    groups: readonly string[];
}

/**
 * The stones in placement order with their feed numbers; the snapshot's
 * cells array is that order.
 */
export function stonesOf(snapshot: GameSnapshot): BoardStone[] {
    return snapshot.board.cells.map((cell, index) => ({
        x: cell.x,
        y: cell.y,
        side: cell.side,
        number: index + 1,
    }));
}

/**
 * The rules view of the position for legality checks and win detection;
 * x is player 0 by the fixed turn-order mapping.
 */
export function positionOf(snapshot: GameSnapshot): Position {
    const stones: Stone[] = snapshot.board.cells.map((cell) => ({
        x: cell.x,
        y: cell.y,
        player: cell.side === `x` ? 0 : 1,
    }));
    return { stones };
}

/** The last pair placed, which the last-move ring marks on both stones. */
export function lastMoveOf(snapshot: GameSnapshot): AxialCoord[] {
    const cells = snapshot.board.cells;
    const last = cells.at(-1);
    const before = cells.at(-2);
    const pair = last === undefined ? [] : before === undefined ? [last] : [before, last];
    return pair.map((cell) => ({ x: cell.x, y: cell.y }));
}

/**
 * The winning six for the frozen board, computed client-side; the snapshot
 * carries stones only.
 * Returns nothing when the finish left no line.
 */
export function winLineOf(snapshot: GameSnapshot): AxialCoord[] | null {
    if (snapshot.status !== `finished` || snapshot.winner === null) return null;
    const win = winner(positionOf(snapshot));
    return win === null ? null : [...win.cells];
}

/**
 * The result as the screen shows it, in the contract's sentence, with the
 * seated reader's own side read as you.
 */
export function resultLine(snapshot: GameSnapshot): string {
    if (snapshot.status !== `finished`) return ``;
    return resultSentence(
        { ...snapshot, turns: turnsOnBoard(snapshot.board.cells.length) },
        { x: snapshot.players.x.name, o: snapshot.players.o.name },
        snapshot.you,
    );
}

/** Both seats by name, x first. */
export function matchName(snapshot: GameSnapshot): string {
    return text.game.vs(snapshot.players.x.name, snapshot.players.o.name);
}

/** The side across the board. */
export function otherSide(side: Side): Side {
    return side === `x` ? `o` : `x`;
}

/**
 * The move feed: one opening line for the server-placed stones, labeled
 * with the turns it spans, then one line per player turn, labeled with its
 * turn number.
 * The first openingPlies cells are the opening: the origin, then pairs.
 */
export function feedOf(snapshot: GameSnapshot): FeedLine[] {
    const cells = snapshot.board.cells;
    const origin = cells[0];
    if (origin === undefined) return [];
    const opening = [`x: ${coord(origin)}`];
    let index = 1;
    while (index < snapshot.openingPlies) {
        const second = cells[index];
        const third = cells[index + 1];
        if (second === undefined || third === undefined) break;
        opening.push(`${sideAt(index)}: ${coord(second)} ${coord(third)}`);
        index += 2;
    }
    // Ply 2t-1 opens turn t, so the first player turn after the opening is
    // turn (openingPlies + 1) / 2.
    let turn = (index + 1) / 2;
    const lines: FeedLine[] = [{ ...openingLabel(turn - 1), groups: opening }];
    while (index < cells.length) {
        const current = cells[index];
        if (current === undefined) break;
        const next = cells[index + 1];
        const stones = next === undefined ? coord(current) : `${coord(current)} ${coord(next)}`;
        lines.push({ label: String(turn), spoken: String(turn), groups: [`${sideAt(index)}: ${stones}`] });
        index += 2;
        turn += 1;
    }
    return lines;
}

// The short label would read as a word, so the spoken form spells it out.
function openingLabel(lastTurn: number): Pick<FeedLine, `label` | `spoken`> {
    if (lastTurn === 0) return { label: text.drawer.openingLabel, spoken: text.drawer.openingSpoken };
    return { label: text.drawer.openingRangeLabel(lastTurn), spoken: text.drawer.openingRangeSpoken(lastTurn) };
}

function sideAt(index: number): Side {
    if (index === 0) return `x`;
    return Math.floor((index - 1) / 2) % 2 === 0 ? `o` : `x`;
}

function coord(cell: AxialCoord): string {
    return `(${String(cell.x)},${String(cell.y)})`;
}

/** The local rejection as one plain sentence for the note under the board. */
export function rejectionNote(rejection: Rejection): string {
    switch (rejection.kind) {
        case `game-finished`:
            return text.drawer.gameOver;
        case `cell-occupied`:
            return text.drawer.cellTaken;
        case `first-stone-off-origin`:
            return text.drawer.firstAtOrigin;
        case `outside-placement-radius`:
            return text.drawer.tooFar;
    }
}
