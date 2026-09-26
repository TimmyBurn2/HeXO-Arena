import type { FinishReason, GameSnapshot, Side } from '@hexarena/contract';
import { winner, type Position, type Rejection, type Stone } from '@hexarena/rules';
import type { BoardStone } from '../board/Board';
import type { AxialCoord } from '@hexarena/contract';

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

const reasonWords: Record<FinishReason, string> = {
    'six-in-a-row': `six in a row`,
    timeout: `on time`,
    disconnect: `disconnect`,
    surrender: `resignation`,
    terminated: `terminated`,
    aborted: `aborted`,
};

/** The reason in plain words, per the closed enum. */
export function reasonText(reason: FinishReason): string {
    return reasonWords[reason];
}

/**
 * The result as one sentence: who won and how, naming the side that
 * resigned or dropped rather than leaving the reason bare.
 */
export function resultSentence(snapshot: GameSnapshot): string {
    if (snapshot.status !== `finished`) return ``;
    const winnerSide = snapshot.winner;
    const won = winnerSide === null ? `nobody won` : `${nameOf(snapshot, winnerSide)} won`;
    const loser = winnerSide === null ? null : nameOf(snapshot, winnerSide === `x` ? `o` : `x`);
    switch (snapshot.reason) {
        case `six-in-a-row`:
            return `${won} with six in a row`;
        case `timeout`:
            return `${won} on time`;
        case `surrender`:
            return loser === null ? `${won}, a side resigned` : `${won}, ${loser} resigned`;
        case `disconnect`:
            return loser === null ? `${won}, a side disconnected` : `${won}, ${loser} disconnected`;
        case `terminated`:
        case `aborted`:
            return `${won}, the game was ${reasonText(snapshot.reason)}`;
        default: {
            const unknown: never = snapshot.reason;
            return unknown;
        }
    }
}

/**
 * The result as the screen shows it: capitalized, except when it starts
 * with a player's name, which keeps its own case.
 * Titles and embeds keep the lowercase sentence.
 */
export function resultLine(snapshot: GameSnapshot): string {
    const sentence = resultSentence(snapshot);
    return /^(?:you|nobody) /.test(sentence) ? sentence.charAt(0).toUpperCase() + sentence.slice(1) : sentence;
}

/** The seated human reads their own side as "you". */
export function nameOf(snapshot: GameSnapshot, side: Side): string {
    return side === snapshot.you ? `you` : snapshot.opponent.name;
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
    if (lastTurn === 0) return { label: `op 0`, spoken: `opening, turn 0` };
    return { label: `op 0-${String(lastTurn)}`, spoken: `opening, turns 0 to ${String(lastTurn)}` };
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
            return `The game is over`;
        case `cell-occupied`:
            return `That cell is taken`;
        case `first-stone-off-origin`:
            return `The first stone belongs at the origin`;
        case `outside-placement-radius`:
            return `Too far from every stone`;
    }
}
