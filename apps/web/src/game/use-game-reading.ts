import { useCallback, useMemo, useState } from 'react';
import { undeclaredValues, type GameSnapshot } from '@hexo-arena/contract';
import { useAnalysisSettings } from '../analysis/analysis-settings';
import { communityReading, gameLineOf, ownReading, type GameLine, type GameReading } from '../analysis/game-readings';
import type { BoardStone } from '../board/Board';
import { boardReading, feedNotes, type BoardReading, type FeedNote } from './drawer-reading';
import { headOf, useGameAnalyses, type AnalysesState, type AnalysisHeadState, type ReadingChoice } from './game-analyses';
import { shownAtTurn, turnOf, type Replay } from './replay';

/** A finished game's readings as the game screen shows them, on the board, in the drawer, and in a phone's peek. */
export interface GameReadingView {
    /** The game's main line; null while it runs, when nothing is read. */
    readonly line: GameLine | null;
    readonly state: AnalysesState;
    readonly head: AnalysisHeadState | null;
    readonly active: ReadingChoice | null;
    readonly view: GameReading | null;
    /** The turn on the board, which the graph's cursor marks. */
    readonly turn: number;
    readonly board: BoardReading | null;
    readonly notes: readonly (FeedNote | null)[] | null;
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
    const finished = snapshot.status === `finished`;
    const cells = snapshot.board.cells;
    const opening = snapshot.openingPlies;
    const line = useMemo(() => (finished ? gameLineOf(cells, opening) : null), [finished, cells, opening]);
    const analyses = useGameAnalyses(snapshot.gameId, finished);
    const load = analyses.state.load;
    const head = useMemo(() => (line !== null && load.kind === `ready` ? headOf(load.list, line) : null), [line, load]);
    const [chosen, setChosen] = useState<string | null>(null);
    const active = head === null ? null : (head.choices.find((choice) => choice.id === chosen) ?? head.choices[0] ?? null);
    const view = useMemo(() => {
        if (active === null || line === null) return null;
        return active.kind === `community` ? communityReading(line, active.analysis.turns, active.analysis.status === `done`, active.analysis.analyzer?.values ?? undeclaredValues) : ownReading(line, active.views);
    }, [active, line]);
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
        state: analyses.state,
        head,
        active,
        view,
        turn,
        board,
        notes,
        choose: setChosen,
        point: setPointed,
        goToTurn,
        goToLine,
        request: analyses.request,
        retry: analyses.retry,
    };
}
