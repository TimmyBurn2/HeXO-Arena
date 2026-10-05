import { useMemo } from 'react';
import { undeclaredValues, type GameSnapshot } from '@hexo-arena/contract';
import { communityReading, gameLineOf, ownReading, type GameLine, type GameReading } from '../analysis/game-readings';
import { headOf, useGameAnalyses, type AnalysesState, type AnalysisHeadState, type ReadingChoice } from './game-analyses';

/** A finished game's stored readings: its main line, where the list stands, the head it makes, and the reading picked, read whole. */
export interface StoredGameReading {
    // Null for a game still running, or no game, when nothing is read.
    readonly line: GameLine | null;
    readonly state: AnalysesState;
    readonly head: AnalysisHeadState | null;
    readonly active: ReadingChoice | null;
    readonly view: GameReading | null;
    readonly request: (analyzer: string | null) => void;
    readonly retry: () => void;
}

/**
 * The readings stored with a finished game, never asked of an analyzer,
 * as the game screen and the analysis board both show them:
 * the first choice `pick` takes, else the first, read over the game's main line.
 */
export function useStoredGameReading(snapshot: GameSnapshot | null, pick: (choice: ReadingChoice) => boolean): StoredGameReading {
    const cells = snapshot?.status === `finished` ? snapshot.board.cells : null;
    const opening = snapshot?.openingPlies ?? 0;
    const line = useMemo(() => (cells === null ? null : gameLineOf(cells, opening)), [cells, opening]);
    const analyses = useGameAnalyses(snapshot?.gameId ?? ``, cells !== null);
    const { load } = analyses.state;
    const list = load.kind === `ready` ? load.list : null;
    const head = useMemo(() => (line === null || list === null ? null : headOf(list, line)), [line, list]);
    const active = head === null ? null : (head.choices.find(pick) ?? head.choices[0] ?? null);
    const view = useMemo(() => {
        if (active === null || line === null) return null;
        return active.kind === `community` ? communityReading(line, active.analysis.turns, active.analysis.status === `done`, active.analysis.analyzer?.values ?? undeclaredValues) : ownReading(line, active.views);
    }, [active, line]);
    return { line, state: analyses.state, head, active, view, request: analyses.request, retry: analyses.retry };
}
