import type { AxialCoord, JudgmentSeverity } from '@hexo-arena/contract';
import type { BoardLines } from '../board/Board';
import { setupBefore, turnCells, type GameLine, type GameReading, type TurnRead } from '../analysis/game-readings';
import { shownLinesOf, type ShownLine } from '../analysis/reading-view';
import { text } from '../text';

/** What a feed line adds from a reading: the turn's mark, its value after, and, on a judged turn, what the analyzer preferred. */
export interface FeedNote {
    readonly severity: JudgmentSeverity | null;
    readonly value: string | null;
    readonly note: string | null;
    /** Whether the reading holds lines past the first, which the board shows while the line is pointed at. */
    readonly more: boolean;
}

/** The lines of a turn's reading as the board and the note name them, A first. */
export function turnLines(line: GameLine, read: TurnRead): ShownLine[] {
    return shownLinesOf(read.options, setupBefore(line, read.turn), read.side, read.options.length);
}

/**
 * The feed's notes, one a feed line: none for the opening's line, then one a turn,
 * the judged ones naming what `analyzer` preferred in its place.
 */
export function feedNotes(line: GameLine, view: GameReading, lines: number, analyzer: string | null): (FeedNote | null)[] {
    return Array.from({ length: lines }, (_, index) => {
        if (index === 0) return null;
        const read = view.turns.get(line.firstTurn + index - 1);
        if (read === undefined) return null;
        return { severity: read.judgment?.severity ?? null, value: read.value, note: analyzer === null ? null : noteOf(line, read, analyzer), more: read.options.length > 1 };
    });
}

// "Allowed a forced win; kestrel preferred x: [-7,6] [-8,6], o 0.12"
function noteOf(line: GameLine, read: TurnRead, analyzer: string): string | null {
    const judgment = read.judgment;
    const best = turnLines(line, read)[0];
    if (judgment === null || best === undefined) return null;
    const words = text.analysis.judged;
    const reason = judgment.reason === `value-drop` ? words.severity(judgment.severity) : words.reason(judgment.reason);
    return text.drawer.reading.note(reason, analyzer, text.analysis.reading.cells(read.side, [best.cellsText]), best.value);
}

/** The board's marks for the turn shown: the mover's lines on the cells still empty, and the turn's judgment. */
export interface BoardReading {
    readonly lines: BoardLines | undefined;
    readonly judgment: { readonly cell: AxialCoord; readonly severity: JudgmentSeverity } | undefined;
}

/**
 * What the board shows of a reading at a whole turn: line A, or every line while `all`,
 * each on the cells the board leaves empty, since a played cell already holds its stone;
 * and the turn's mark beside its last stone.
 * `linesOn` is the Lines on the board switch, which leaves the mark.
 */
export function boardReading(line: GameLine, view: GameReading, turn: number, occupied: ReadonlySet<string>, all: boolean, linesOn: boolean): BoardReading {
    const read = view.turns.get(turn);
    if (read === undefined) return { lines: undefined, judgment: undefined };
    const last = turnCells(line, turn).at(-1);
    const judgment = read.judgment === null || last === undefined ? undefined : { cell: last, severity: read.judgment.severity };
    if (!linesOn) return { lines: undefined, judgment };
    // A line left with no empty cell keeps its place, so the next one is never drawn as the best.
    const shown = turnLines(line, read)
        .slice(0, all ? undefined : 1)
        .map((each) => ({ letter: each.letter, cells: each.cells.filter((cell) => !occupied.has(`${String(cell.x)},${String(cell.y)}`)) }));
    return { lines: shown.some((each) => each.cells.length > 0) ? { side: read.side, lines: shown } : undefined, judgment };
}
