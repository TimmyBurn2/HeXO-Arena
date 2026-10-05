import { useCallback, useMemo, useState } from 'react';
import type { GameSnapshot } from '@hexo-arena/contract';
import { useAnalysisSettings } from '../analysis/analysis-settings';
import type { GameLine, GameReading } from '../analysis/game-readings';
import type { BoardStone } from '../board/Board';
import { boardReading, feedFolds, feedNotes, type BoardReading, type FeedFold, type FeedNote } from './drawer-reading';
import type { AnalysesState, AnalysisHeadState, ReadingChoice } from './game-analyses';
import { shownAtTurn, turnOf, type Replay } from './replay';
import { useStoredGameReading } from './use-stored-game-reading';

// A finished game's readings as the game screen shows them, on the board, in the drawer, and in a phone's peek.
interface GameReadingView {
    // The game's main line; null while it runs, when nothing is read.
    readonly line: GameLine | null;
    readonly state: AnalysesState;
    readonly head: AnalysisHeadState | null;
    readonly active: ReadingChoice | null;
    readonly view: GameReading | null;
    // The turn on the board, which the graph's cursor marks.
    readonly turn: number;
    readonly board: BoardReading | null;
    readonly notes: readonly (FeedNote | null)[] | null;
    readonly folds: readonly FeedFold[];
    readonly choose: (id: string) => void;
    readonly point: (index: number | null) => void;
    readonly goToTurn: (turn: number) => void;
    readonly goToLine: (index: number) => void;
    readonly request: (analyzer: string | null) => void;
    readonly retry: () => void;
}

/**
 * The readings of a finished game, read from what is stored, never asked of an analyzer:
 * the one picked, first by default, laid on the turn the replay shows, and on the feed's lines.
 * The board shows the turn's line A, and every line while the feed line shown is pointed at.
 */
export function useGameReading({ snapshot, replay, shownStones, feedLines, currentLine }: {
    snapshot: GameSnapshot;
    replay: Replay;
    shownStones: readonly BoardStone[];
    feedLines: number;
    currentLine: number;
}): GameReadingView {
    const [chosen, setChosen] = useState<string | null>(null);
    const { line, state, head, active, view, request, retry } = useStoredGameReading(snapshot, (choice) => choice.id === chosen);
    const [pointed, setPointed] = useState<number | null>(null);
    const [settings] = useAnalysisSettings();
    const { range, shown, go } = replay;
    const turn = turnOf(shown);
    const occupied = useMemo(() => new Set(shownStones.map((stone) => `${String(stone.x)},${String(stone.y)}`)), [shownStones]);
    // Marks belong to a whole turn on the board, never to its first stone alone.
    const wholeTurn = shown % 2 === 1 || shown >= range.total;
    const all = pointed === currentLine;
    const board = useMemo(
        () => (line !== null && view !== null && wholeTurn && turn >= line.firstTurn ? boardReading(line, view, turn, occupied, all, settings.boardLines) : null),
        [line, view, wholeTurn, turn, occupied, all, settings.boardLines],
    );
    const notes = useMemo(
        () => (line === null || view === null ? null : feedNotes(line, view, feedLines, active?.kind === `community` ? active.name : null)),
        [line, view, feedLines, active],
    );
    const folds = useMemo(() => (line === null || view === null ? [] : feedFolds(line, view, active?.kind === `community` ? active.name : null)), [line, view, active]);
    const goToTurn = useCallback(
        (to: number) => {
            go(to <= turnOf(range.opening) ? range.opening : shownAtTurn(to, range));
        },
        [go, range],
    );
    const goToLine = useCallback(
        (index: number) => {
            if (line !== null) goToTurn(index === 0 ? 0 : line.firstTurn + index - 1);
        },
        [goToTurn, line],
    );
    return {
        line,
        state,
        head,
        active,
        view,
        turn,
        board,
        notes,
        folds,
        choose: setChosen,
        point: setPointed,
        goToTurn,
        goToLine,
        request,
        retry,
    };
}
