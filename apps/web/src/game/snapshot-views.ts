import type { FinishReason, GameSnapshot, Side } from '@hexarena/contract';
import { winner, type Position, type Rejection, type Stone } from '@hexarena/rules';
import type { BoardStone } from '../board/Board';
import type { AxialCoord } from '@hexarena/contract';

export interface FeedLine {
    label: string;
    text: string;
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
 * carries stones only. Returns nothing when the finish left no line.
 */
export function winLineOf(snapshot: GameSnapshot): AxialCoord[] | null {
    if (snapshot.status !== `finished` || snapshot.winner === null) return null;
    const win = winner(positionOf(snapshot));
    return win === null ? null : [...win.cells];
}

const reasonWords: Record<FinishReason, string> = {
    'six-in-a-row': `six in a row`,
    timeout: `clock`,
    disconnect: `disconnect`,
    surrender: `surrender`,
    terminated: `terminated`,
    aborted: `aborted`,
};

/** The reason in plain words, per the closed enum. */
export function reasonText(reason: FinishReason): string {
    return reasonWords[reason];
}

export function resultSentence(snapshot: GameSnapshot): string {
    if (snapshot.status !== `finished`) return ``;
    if (snapshot.winner === null) {
        return `nobody won, ${reasonText(snapshot.reason)}`;
    }
    return `${nameOf(snapshot, snapshot.winner)} won, ${reasonText(snapshot.reason)}`;
}

/** The seated human reads their own side as "you". */
export function nameOf(snapshot: GameSnapshot, side: Side): string {
    return side === snapshot.you ? `you` : snapshot.opponent.name;
}

/**
 * The move feed: one opening line for the server-placed stones, then one
 * numbered line per turn.
 */
export function feedOf(snapshot: GameSnapshot): FeedLine[] {
    const cells = snapshot.board.cells;
    if (cells.length === 0) return [];
    const lines: FeedLine[] = [];
    const origin = cells[0];
    if (origin === undefined) return [];
    let opening = `x: ${coord(origin)}`;
    let index = 1;
    for (let turn = 0; turn < snapshot.openingTurns; turn += 1) {
        const second = cells[index];
        const third = cells[index + 1];
        if (second === undefined || third === undefined) break;
        opening += ` ${sideAt(index)}: ${coord(second)} ${coord(third)}`;
        index += 2;
    }
    lines.push({ label: `op`, text: opening });
    let turn = 1;
    while (index < cells.length) {
        const current = cells[index];
        const next = cells[index + 1];
        if (current === undefined) break;
        const side = sideAt(index);
        const first = coord(current);
        const second = next === undefined ? null : coord(next);
        lines.push({
            label: String(turn),
            text: `${side}: ${first}${second === null ? `` : ` ${second}`}`,
        });
        index += 2;
        turn += 1;
    }
    return lines;
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
            return `the game is over`;
        case `cell-occupied`:
            return `that cell is taken`;
        case `first-stone-off-origin`:
            return `the first stone belongs at the origin`;
        case `outside-placement-radius`:
            return `too far from every stone`;
    }
}
