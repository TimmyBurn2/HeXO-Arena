import { useCallback, useEffect, useMemo, useState } from 'react';
import { sideOf, type AxialCoord, type GameSnapshot, type JudgmentSeverity } from '@hexo-arena/contract';
import type { Setup, TurnCells } from '@hexo-arena/rules';
import { askerOf, type Asker } from '../game/DrawerAnalysis';
import { useStoredGameReading, type StoredGameReading } from '../game/use-stored-game-reading';
import { meStore, useMe } from '../me';
import { text } from '../text';
import { effectiveSeconds, useAnalysisSettings, type AnalysisSettings } from './analysis-settings';
import type { WindowReading } from './AnalyzerWindow';
import type { Explanation } from './explain';
import { ownSourceId, storedReadings } from './game-readings';
import type { ListFold } from './MoveList';
import {
    analyzerShownOf,
    explainShown,
    involvedNotes,
    judgedMark,
    listFacts,
    listFolds,
    listingOf,
    ownPill,
    readingPills,
    rowSource,
    unreadableOf,
    type ReadingLookup,
} from './panel-reading';
import { nextUtcDay, readings, useReadingsAt, useReadingsSnapshot, type ReadingEntry, type ReadingTarget } from './readings';
import type { AnalyzerList, ReadingPill } from './ReadingPanel';
import { shownLines } from './reading-view';
import type { RowFact } from './row-facts';
import { botSource, type AnalysisPosition } from './sources';
import { gameLine, type AnalysisState } from './state';
import { nodeAt, pathTo, rootId, type NodeId } from './tree';
import { useAnalyzers } from './use-analyzers';

/** What the analysis board's panel, move list, and board read of the position shown and of a stored game. */
export interface AnalysisReading {
    // Null until the page knows who the person is.
    readonly signedIn: boolean | null;
    readonly asker: Asker;
    // Positions the person may still have read today; null signed out.
    readonly positionsLeft: number | null;
    readonly settings: AnalysisSettings;
    readonly updateSettings: (changes: Partial<AnalysisSettings>) => void;
    readonly analyzers: AnalyzerList;
    readonly reloadAnalyzers: () => void;
    readonly analyzing: boolean;
    // Turning Analyze on asks at once, without the dwell.
    readonly turnAnalyzing: (on: boolean) => void;
    readonly askNow: () => void;
    readonly shown: WindowReading;
    readonly pills: readonly ReadingPill[];
    readonly activePill: string | null;
    readonly choosePill: (pill: ReadingPill) => void;
    readonly explanation: Explanation | null;
    readonly involved: { readonly head: string | null; readonly explanation: string | null };
    readonly stored: StoredGameReading;
    readonly facts: ReadonlyMap<NodeId, RowFact>;
    readonly folds: readonly ListFold[];
    // The stored game's turn the graph's cursor stands at.
    readonly cursor: number;
    readonly judgment: { readonly cell: AxialCoord; readonly severity: JudgmentSeverity } | null;
    // The node of a stored game's turn, the root for none.
    readonly nodeOfTurn: (turn: number) => NodeId | undefined;
}

const noEntry: ReadingEntry = { read: null, state: { kind: `idle` } };

/**
 * The readings of the analysis board: the position shown asked of the analyzer the settings name,
 * after a dwell while Analyze is on or at once on `askNow`, and never while setting up;
 * a stored game's readings filed by position, and read whole over its own turns;
 * and what the panel, the move list, and the board make of them.
 */
export function useAnalysisReading({ board, position, snapshot, gameTurns, editing }: {
    board: AnalysisState;
    position: Setup;
    // The stored game the board opened; null for any other board.
    snapshot: GameSnapshot | null;
    gameTurns: readonly TurnCells[];
    editing: boolean;
}): AnalysisReading {
    const { tree, at } = board;
    const node = nodeAt(tree, at);
    const toMove = sideOf(position.toMove);
    const won = node?.kind === `turn` && node.win !== null;
    const gameId = tree.root.kind === `game` ? tree.root.gameId : null;

    const me = useMe();
    const user = me.status === `ready` && me.me?.kind === `user` ? me.me : null;
    const signedIn = user !== null;
    const [settings, updateSettings] = useAnalysisSettings();
    const { analyzers, reload: reloadAnalyzers } = useAnalyzers(signedIn);
    const cap = listingOf(analyzers, settings.analyzer)?.analyzer?.maxSeconds ?? null;
    const ask = useMemo(() => ({ lines: settings.lines, seconds: effectiveSeconds(settings.seconds, cap) }), [settings.lines, settings.seconds, cap]);
    const analyzerSource = useMemo(
        () =>
            botSource({
                analyzer: settings.analyzer,
                label: settings.analyzer ?? text.analysis.reading.any,
                onLeft: (left) => {
                    meStore.positionsLeft(left);
                },
            }),
        [settings.analyzer],
    );
    const unreadable = useMemo(() => unreadableOf(position, won), [position, won]);
    const atKey = node?.key ?? ``;
    // Off on every visit: positions are read on their own only once the person turns it on here.
    const [analyzing, setAnalyzing] = useState(false);
    const target: ReadingTarget | null = useMemo(() => {
        if (!signedIn || unreadable !== null || editing) return null;
        const asked: AnalysisPosition = { cells: position.stones.map((stone) => ({ x: stone.x, y: stone.y, side: sideOf(stone.player) })), toMove };
        return { source: analyzerSource, position: asked, key: atKey, ask };
    }, [signedIn, unreadable, editing, position, toMove, analyzerSource, atKey, ask]);

    useEffect(() => {
        if (target === null) readings.leave();
        else readings.visit([target], analyzing);
    }, [target, analyzing]);
    useEffect(
        () => () => {
            readings.leave();
        },
        [],
    );
    const positionsLeft = user?.analysisLeft.positions ?? null;
    useEffect(() => {
        if (positionsLeft !== null) readings.spend(positionsLeft === 0 ? nextUtcDay(Date.now()) : null);
    }, [positionsLeft]);

    // The bots' own views show while their pill is picked, for the game they belong to.
    const [ownFor, setOwnFor] = useState<string | null>(null);
    const ownView = ownFor !== null && ownFor === gameId;

    const askNow = useCallback(() => {
        setOwnFor(null);
        if (target !== null) readings.ask(target);
    }, [target]);

    const entries = useReadingsAt(readings, atKey);
    const entry = entries.get(analyzerSource.id) ?? noEntry;
    const ownEntry = gameId === null ? undefined : entries.get(ownSourceId(gameId, toMove));
    const shown = ownView ? (ownEntry ?? noEntry) : entry;
    const read = shown.read;
    const lines = useMemo(() => (read === null ? [] : shownLines(read.reading, position, toMove, settings.lines)), [read, position, toMove, settings.lines]);
    // A reading on its way, asked or about to be, keeps the lines' rows and the bar in place.
    const waiting = !ownView && read === null && (entry.state.kind === `thinking` || entry.state.kind === `queued` || (entry.state.kind === `idle` && analyzing));

    // The game's reading the graph, the marks, and its rows come from, as the drawer shows it:
    // the own views while their pill is picked, else the pill's analyzer's reading of the whole game, else the first.
    const shownAnalyzer = ownView ? null : read?.reading.by.kind === `bot` ? read.reading.by.name : settings.analyzer;
    const stored = useStoredGameReading(snapshot, (choice) => (ownView ? choice.kind === `own` : choice.kind === `community` && choice.name === shownAnalyzer));
    const { line: record, head, active, view } = stored;
    const list = stored.state.load.kind === `ready` ? stored.state.load.list : null;
    // A stored game's readings, filed by position so a transposition finds them too.
    useEffect(() => {
        if (list !== null && record !== null && gameId !== null) readings.keep(storedReadings(list, gameId, record));
    }, [list, record, gameId]);
    const gameNodes = useMemo(() => gameLine(tree, gameTurns), [tree, gameTurns]);
    const lineDepth = useMemo(() => new Map(gameNodes.map((each) => [each.id, each.turn])), [gameNodes]);

    const { pills, active: activePill } = readingPills({
        entries,
        analyzerId: analyzerSource.id,
        analyzer: settings.analyzer,
        stored: head?.choices.flatMap((choice) => (choice.kind === `community` ? [choice.name] : [])) ?? [],
        ownViews: head?.choices.some((choice) => choice.kind === `own`) === true,
        ownView,
    });
    const ownSeat = snapshot?.players[toMove];
    const analyzer = analyzerShownOf({
        read: read?.reading ?? null,
        ownView,
        ownBot: ownSeat?.kind === `bot` ? ownSeat.name : null,
        toMove,
        analyzer: settings.analyzer,
        analyzers,
        seconds: ask.seconds,
    });

    const held = useReadingsSnapshot(readings);
    const lookup: ReadingLookup = useCallback((key: string, id: string) => held.get(key)?.get(id)?.read?.reading ?? null, [held]);
    // Rows away from the game's own turns read what the source of the game's reading holds, or the analyzer the panel asks.
    const analyzerId = analyzerSource.id;
    const sourceFor = useMemo(() => rowSource(active, gameId, analyzerId), [active, gameId, analyzerId]);
    const facts = useMemo(() => listFacts({ tree, read: lookup, sourceFor, view, gameNodes }), [tree, lookup, sourceFor, view, gameNodes]);
    const folds = useMemo(() => listFolds(view, active, gameNodes), [view, active, gameNodes]);
    const players = snapshot?.players ?? null;
    const card = head?.card ?? null;
    const explained = useMemo(
        () => explainShown({ tree, at, players, gameId, onGame: lineDepth, card, view, active, line: record, read: lookup, sourceFor, facts }),
        [tree, at, players, gameId, lineDepth, card, view, active, record, lookup, sourceFor, facts],
    );

    // The graph's cursor stands at the game's turn on the board, or for a variation at the turn it leaves from.
    const cursor = useMemo(() => {
        for (const id of pathTo(tree, at).reverse()) {
            const turn = lineDepth.get(id);
            if (turn !== undefined) return turn;
        }
        return 0;
    }, [tree, at, lineDepth]);
    const nodeOfTurn = useCallback((turn: number) => (turn <= 0 ? rootId : gameNodes[turn - 1]?.id), [gameNodes]);

    const turnAnalyzing = useCallback(
        (on: boolean) => {
            setAnalyzing(on);
            if (on) askNow();
        },
        [askNow],
    );
    const choosePill = useCallback(
        (pill: ReadingPill) => {
            if (pill.id === ownPill) {
                setOwnFor(gameId);
                return;
            }
            setOwnFor(null);
            updateSettings({ analyzer: pill.name });
        },
        [gameId, updateSettings],
    );

    return {
        signedIn: me.status === `loading` ? null : signedIn,
        asker: askerOf(me),
        positionsLeft,
        settings,
        updateSettings,
        analyzers,
        reloadAnalyzers,
        analyzing,
        turnAnalyzing,
        askNow,
        shown: { analyzer, entry: shown, lines, held: waiting, toMove, unreadable },
        pills,
        activePill,
        choosePill,
        explanation: explained?.explanation ?? null,
        involved: involvedNotes({ active, players, analyzer, ownView, explained }),
        stored,
        facts,
        folds,
        cursor,
        judgment: judgedMark({ node, onGame: lineDepth, view, line: record }),
        nodeOfTurn,
    };
}
