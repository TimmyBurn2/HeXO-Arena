import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
    analysisCoordLimit,
    analysisMeta,
    analysisPagePath,
    analysisStoneCap,
    pagePath,
    resultSentence,
    sideOf,
    turnsOnBoard,
    undeclaredValues,
    type AxialCoord,
    type GameSnapshot,
    type Side,
} from '@hexo-arena/contract';
import type { Setup, TurnCells } from '@hexo-arena/rules';
import { ApiError, fetchGameSnapshot, limitedFor } from '../api/client';
import { AnalysisBoard } from '../analysis/AnalysisBoard';
import { AnalyzerWindow, CourseGraph, GameRequest } from '../analysis/AnalyzerWindow';
import { effectiveSeconds, useAnalysisSettings } from '../analysis/analysis-settings';
import { ExportDialog, ImportDialog, type ExportView } from '../analysis/dialogs';
import { draftOf, draftSetup, type SetupDraft, clickCell } from '../analysis/draft';
import { explain, explainRun, turnReading, type ExplainedTurn, type Explanation, type PreferredLine } from '../analysis/explain';
import type { Imported } from '../analysis/import-text';
import { gameLink, lineLink, readAddress, setupLink } from '../analysis/links';
import { MoveList, type ListFold, type RowActions } from '../analysis/MoveList';
import { writeGame } from '../analysis/notation';
import { communityReading, gameLineOf, ownReading, ownSourceId, storedReadings, turnCells } from '../analysis/game-readings';
import { rowFacts } from '../analysis/row-facts';
import { nextUtcDay, readings, useReadingsAt, useReadingsSnapshot, type ReadingEntry, type ReadingTarget } from '../analysis/readings';
import { AnalysisSettingsPanel, EvalBar, type AnalyzerShown, type ReadingPill, type Unreadable } from '../analysis/ReadingPanel';
import { shownLines, type ShownLine } from '../analysis/reading-view';
import { authorSourceId, botSource, botSourceId, type AnalysisPosition, type ReadingAuthor } from '../analysis/sources';
import { useAnalyzers } from '../analysis/use-analyzers';
import { SetupTools } from '../analysis/SetupTools';
import { analysisStorageKey } from '../analysis/storage-key';
import {
    back,
    blankBoard,
    deleteFrom,
    floorOf,
    forward,
    gameLine,
    gameTree,
    goTo,
    holdsOwnTurns,
    mainLineAt,
    markCell,
    playCells,
    promoteLine,
    readStoredBoard,
    restoreBoard,
    rootOfStored,
    standOn,
    storeBoard,
    switchLine,
    toEnd,
    toStart,
    turnsOfGame,
    unmark,
    type AnalysisState,
    type StoredBoard,
} from '../analysis/state';
import { isMainLine, lineEnd, lineTo, mainLine, newTree, nodeAt, openingTurns, pathTo, positionAt, rootId, type MoveTree as Tree, type NodeId } from '../analysis/tree';
import { notationErrorText, positionWords, refusalText } from '../analysis/words';
import type { BoardStone } from '../board/Board';
import { BotBadge, PlayerName, seatName, Swatch } from '../components/player';
import { Marks, type Asker } from '../game/DrawerAnalysis';
import { headOf, involvedNote, useGameAnalyses, type ReadingChoice } from '../game/game-analyses';
import { useWait, WaitText } from '../components/wait';
import { meStore, useMe } from '../me';
import { Link } from '../router/Link';
import { navigate, useHash, useRoute, useSearch } from '../router/use-route';
import { text } from '../text';
import { useDocumentMeta } from '../use-document-meta';
import '../game/hud.css';
import './AnalysisScreen.css';

// A stored game the board opened, with the turns its main line plays.
interface OpenedGame {
    readonly snapshot: GameSnapshot;
    readonly turns: readonly TurnCells[];
}

type Opened =
    | { readonly kind: `ready`; readonly board: AnalysisState; readonly game: OpenedGame | null }
    | { readonly kind: `loading`; readonly gameId: string }
    | { readonly kind: `missing`; readonly gameId: string }
    | { readonly kind: `live`; readonly gameId: string }
    | { readonly kind: `failed`; readonly gameId: string; readonly wait: number | null };

// A board with no stored game has no turns of one.
const noTurns: readonly TurnCells[] = [];

type Dialog = { readonly kind: `import`; readonly text: string } | { readonly kind: `export` } | null;

function readSession(): string | null {
    try {
        return window.sessionStorage.getItem(analysisStorageKey);
    } catch {
        return null;
    }
}

function writeSession(value: string): void {
    try {
        window.sessionStorage.setItem(analysisStorageKey, value);
    } catch {
        // The board still works for this page's life.
    }
}

// The board a link or the stored board opens, short of a stored game, which loads first.
function boardOf(stored: StoredBoard | null): AnalysisState {
    if (stored === null || stored.root.kind === `game`) return blankBoard();
    return restoreBoard(stored, rootOfStored(stored.root, 1));
}

function lineBoard(start: Setup | null, turns: readonly TurnCells[], pending: AxialCoord | null): AnalysisState {
    let board = standOn(newTree(start === null ? { kind: `origin` } : { kind: `setup`, start }));
    for (const turn of turns) {
        const played = playCells(board, turn);
        if (played.refusal !== null) break;
        board = played.state;
    }
    return pending === null ? board : markCell(board, pending).state;
}

// Each stone numbered in the order it was played; a set-up board's own stones were placed, not played, so carry none.
function numberedStones(tree: Tree, at: NodeId): BoardStone[] {
    const setupStones = tree.root.kind === `setup` ? tree.root.start.stones.length : 0;
    return positionAt(tree, at).stones.map((stone, index) => ({
        x: stone.x,
        y: stone.y,
        side: sideOf(stone.player),
        number: index < setupStones ? null : index - setupStones + 1,
    }));
}

// Why an analyzer cannot read a position, if it cannot.
function unreadableOf(position: Setup, won: boolean): Unreadable | null {
    if (won) return { kind: `won` };
    if (position.stones.length > analysisStoneCap) return { kind: `too-many`, stones: position.stones.length };
    if (position.stones.some((stone) => Math.abs(stone.x) > analysisCoordLimit || Math.abs(stone.y) > analysisCoordLimit)) return { kind: `too-far` };
    return null;
}

const noEntry: ReadingEntry = { read: null, state: { kind: `idle` } };

// The pill of the bots' own views, which no analyzer setting names.
const ownPill = `own`;

// The panel's line for a reading in hand, by whose opinion it is.
function authorShown(by: ReadingAuthor, seconds: number): AnalyzerShown {
    switch (by.kind) {
        case `bot`:
            return { kind: `named`, name: by.name, version: by.version, ownerName: by.ownerName, seconds };
        case `own`:
            return { kind: `own`, name: by.name, side: by.side };
        case `worker`:
            return { kind: `engine`, name: by.engine, version: by.version, seconds };
    }
}

// The name a reading goes by in an explanation: the analyzer's, the bot's for its own view, the engine's.
function authorName(by: ReadingAuthor): string {
    switch (by.kind) {
        case `bot`:
        case `own`:
            return by.name;
        case `worker`:
            return by.engine;
    }
}

// The wait a refusal names, or the rest of the UTC day for one that names none.
function waitWords(seconds: number | null): string {
    const now = Date.now();
    return text.analysis.reading.wait(seconds ?? Math.ceil((nextUtcDay(now) - now) / 1000));
}

// A switch takes no arrows or letters, so the board's keys still work from
// the Analyze switch a click has just turned on.
function typingInto(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target instanceof HTMLInputElement) return target.type !== `checkbox`;
    return target.isContentEditable || [`TEXTAREA`, `SELECT`].includes(target.tagName);
}

/**
 * The analysis board: play turns for both sides from the origin, a set-up
 * position, or a finished game of this site, keep the variations in a move
 * tree, and read or write HTTTX and boat notation.
 * Nothing reaches the server but the read of a stored game; the tree stays
 * in this tab's storage, a stored game's own turns by place alone.
 */
export function AnalysisScreen() {
    const route = useRoute();
    const search = useSearch();
    const hash = useHash();
    const [opened, setOpened] = useState<Opened | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        const address = readAddress(search, hash);
        const stored = readStoredBoard(readSession());
        let wanted: { gameId: string; turn: number | null } | null = null;
        if (!address.ok) {
            setNotice(notationErrorText(address.error));
        } else if (address.value.kind === `game`) {
            wanted = { gameId: address.value.gameId, turn: address.value.turn };
        } else if (address.value.kind === `line`) {
            setOpened({ kind: `ready`, board: lineBoard(null, address.value.line.turns, null), game: null });
            return;
        } else if (address.value.kind === `setup`) {
            setOpened({ kind: `ready`, board: lineBoard(address.value.start, address.value.line.turns, null), game: null });
            return;
        }
        if (wanted === null && stored?.root.kind === `game`) wanted = { gameId: stored.root.gameId, turn: null };
        if (wanted === null) {
            setOpened((current) => (current?.kind === `ready` && current.game === null ? current : { kind: `ready`, board: boardOf(stored), game: null }));
            return;
        }
        const { gameId, turn } = wanted;
        let cancelled = false;
        setOpened((current) => {
            // The board already open on this game only moves to the turn a link names.
            if (current?.kind === `ready` && current.game?.snapshot.gameId === gameId) {
                return turn === null ? current : { ...current, board: goTo(current.board, mainLineAt(current.board.tree, turn)) };
            }
            return { kind: `loading`, gameId };
        });
        fetchGameSnapshot(gameId).then(
            (snapshot) => {
                if (cancelled) return;
                setOpened((current) => {
                    if (current?.kind === `ready` && current.game?.snapshot.gameId === gameId) return current;
                    if (snapshot.status !== `finished`) return { kind: `live`, gameId };
                    const turns = turnsOfGame(snapshot.board.cells);
                    const kept =
                        stored?.root.kind === `game` && stored.root.gameId === gameId
                            ? restoreBoard(stored, rootOfStored(stored.root, snapshot.openingPlies), turns)
                            : standOn(gameTree(gameId, snapshot.openingPlies, turns));
                    const board =
                        turn !== null
                            ? goTo(kept, mainLineAt(kept.tree, turn))
                            : kept.at === rootId
                              ? goTo(kept, mainLineAt(kept.tree, turns.length))
                              : kept;
                    return { kind: `ready`, board, game: { snapshot, turns } };
                });
            },
            (cause: unknown) => {
                if (cancelled) return;
                if (cause instanceof ApiError && cause.status === 404) setOpened({ kind: `missing`, gameId });
                else setOpened({ kind: `failed`, gameId, wait: limitedFor(cause) });
            },
        );
        return () => {
            cancelled = true;
        };
    }, [search, hash, attempt]);

    const retry = useCallback(() => {
        setAttempt((current) => current + 1);
    }, []);

    const onBoard = useCallback((next: (board: AnalysisState) => AnalysisState) => {
        setNotice(null);
        setOpened((current) => (current?.kind === `ready` ? { ...current, board: next(current.board) } : current));
    }, []);

    const onReplace = useCallback((board: AnalysisState) => {
        setNotice(null);
        setOpened({ kind: `ready`, board, game: null });
    }, []);

    const newBoard = useCallback(() => {
        setNotice(null);
        setOpened({ kind: `ready`, board: blankBoard(), game: null });
        if (window.location.search !== `` || window.location.hash !== ``) navigate(analysisPagePath);
    }, []);

    const finished = opened?.kind === `ready` ? opened.game?.snapshot : undefined;
    const meta =
        finished?.status === `finished`
            ? analysisMeta({
                  status: `finished`,
                  names: { x: finished.players.x.name, o: finished.players.o.name },
                  winner: finished.winner,
                  reason: finished.reason,
                  turns: turnsOnBoard(finished.board.cells.length),
              })
            : analysisMeta();
    useDocumentMeta(route, meta.title, meta.description);

    if (opened === null || opened.kind === `loading`) {
        return (
            <div className="an-message" aria-busy="true">
                <h1 className="sr-only">{text.analysis.title}</h1>
                <p className="note">{text.analysis.states.loading}</p>
            </div>
        );
    }
    if (opened.kind !== `ready`) return <OpenedMessage opened={opened} retry={retry} newBoard={newBoard} />;
    return (
        <Workspace
            board={opened.board}
            game={opened.game}
            notice={notice}
            onBoard={onBoard}
            onReplace={onReplace}
            onNewBoard={newBoard}
        />
    );
}

function OpenedMessage({ opened, retry, newBoard }: {
    opened: Exclude<Opened, { kind: `ready` } | { kind: `loading` }>;
    retry: () => void;
    newBoard: () => void;
}) {
    const limited = useWait();
    const { start } = limited;
    const wait = opened.kind === `failed` ? opened.wait : null;
    useEffect(() => {
        if (wait !== null) start(wait);
    }, [wait, start]);
    const holding = limited.wait !== null;
    const words = text.analysis.states;
    return (
        <div className="an-message">
            <div className="empty">
                <h1>{opened.kind === `missing` ? words.missing : opened.kind === `live` ? words.live : words.failed}</h1>
                {opened.kind === `missing` ? <p>{words.missingSentence((games) => <Link to="/games">{games}</Link>)}</p> : null}
                {opened.kind === `live` ? <p>{words.liveSentence}</p> : null}
                <div role="status">{limited.wait === null ? null : <p className="note"><WaitText wait={limited.wait} line={text.states.tooMany} /></p>}</div>
                <div className="actions">
                    {opened.kind === `live` ? (
                        <Link to={pagePath(`game`, { gameId: opened.gameId })} className="btn btn-primary">
                            {words.watch}
                        </Link>
                    ) : null}
                    {opened.kind === `failed` ? (
                        <button
                            type="button"
                            className="btn btn-primary"
                            aria-disabled={holding ? `true` : undefined}
                            onClick={() => {
                                if (!holding) retry();
                            }}
                        >
                            {text.states.tryAgain}
                        </button>
                    ) : null}
                    <button type="button" className="btn btn-ghost" onClick={newBoard}>
                        {words.newBoard}
                    </button>
                </div>
            </div>
        </div>
    );
}

function Workspace({ board, game, notice, onBoard, onReplace, onNewBoard }: {
    board: AnalysisState;
    game: OpenedGame | null;
    // Why the address's line or position did not load, if it did not.
    notice: string | null;
    onBoard: (next: (board: AnalysisState) => AnalysisState) => void;
    onReplace: (board: AnalysisState) => void;
    onNewBoard: () => void;
}) {
    const { tree, at, mark } = board;
    const [editing, setEditing] = useState<SetupDraft | null>(null);
    const [dialog, setDialog] = useState<Dialog>(null);
    const [refusal, setRefusal] = useState<string | null>(null);
    const [status, setStatus] = useState<string | null>(null);
    const [armed, setArmed] = useState(false);
    // Off on every visit: positions are read on their own only once the person turns it on here.
    const [analyzing, setAnalyzing] = useState(false);
    const [preview, setPreview] = useState<ShownLine | null>(null);
    // The line an explanation names, previewed on the board the turn was played from.
    const [preferred, setPreferred] = useState<PreferredLine | null>(null);
    const setupButton = useRef<HTMLButtonElement>(null);
    const wasEditing = useRef(false);
    const gameTurns = game?.turns ?? noTurns;
    const gameId = tree.root.kind === `game` ? tree.root.gameId : null;

    // The board as the browser keeps it, after every change.
    useEffect(() => {
        writeSession(JSON.stringify(storeBoard(board, gameTurns)));
    }, [board, gameTurns]);

    // The address names the stored game the board opens, and nothing else:
    // a link's line or position has been read into the tree.
    useEffect(() => {
        const wanted = gameId === null ? `` : `?game=${encodeURIComponent(gameId)}`;
        if (window.location.search === wanted && window.location.hash === ``) return;
        window.history.replaceState(window.history.state, ``, `${analysisPagePath}${wanted}`);
    }, [gameId]);

    const step = useCallback(
        (move: (board: AnalysisState) => AnalysisState) => {
            setRefusal(null);
            setStatus(null);
            setArmed(false);
            setPreview(null);
            setPreferred(null);
            onBoard(move);
        },
        [onBoard],
    );

    const node = nodeAt(tree, at);
    const position = useMemo(() => positionAt(tree, at), [tree, at]);
    const end = lineEnd(tree, at);
    const frame = useMemo(() => positionAt(tree, end).stones, [tree, end]);
    const stones = useMemo(() => numberedStones(tree, at), [tree, at]);
    const toMove = sideOf(position.toMove);
    const won = node?.kind === `turn` && node.win !== null ? sideOf(node.win.player) : null;
    const floor = floorOf(tree);
    const mainLineEnd = nodeAt(tree, mainLine(tree).at(-1) ?? rootId)?.turn ?? 0;

    const me = useMe();
    const user = me.status === `ready` && me.me?.kind === `user` ? me.me : null;
    const signedIn = user !== null;
    const [settings, updateSettings] = useAnalysisSettings();
    const { analyzers, reload: reloadAnalyzers } = useAnalyzers(signedIn);
    const listing = settings.analyzer === null || analyzers.kind !== `ready` ? undefined : analyzers.bots.find((bot) => bot.name === settings.analyzer);
    const cap = listing?.analyzer?.maxSeconds ?? null;
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
    const unreadable = useMemo(() => unreadableOf(position, won !== null), [position, won]);
    const atKey = node?.key ?? ``;
    const target: ReadingTarget | null = useMemo(() => {
        if (!signedIn || unreadable !== null || editing !== null) return null;
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
    const asker: Asker = me.status === `loading` ? { kind: `unknown` } : user === null ? { kind: `signed-out` } : { kind: `user`, left: user.analysisLeft.games };
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

    // A stored game's readings, filed by position so a transposition finds them too.
    const finished = game?.snapshot.status === `finished` ? game.snapshot : null;
    const record = useMemo(() => (finished === null ? null : gameLineOf(finished.board.cells, finished.openingPlies)), [finished]);
    const analyses = useGameAnalyses(finished?.gameId ?? ``, finished !== null);
    const list = analyses.state.load.kind === `ready` ? analyses.state.load.list : null;
    useEffect(() => {
        if (list !== null && record !== null && gameId !== null) readings.keep(storedReadings(list, gameId, record));
    }, [list, record, gameId]);
    const head = useMemo(() => (list === null || record === null ? null : headOf(list, record)), [list, record]);
    const ownChoice = head?.choices.find((choice) => choice.kind === `own`) ?? null;
    const storedNames = head?.choices.flatMap((choice) => (choice.kind === `community` ? [choice.name] : [])) ?? [];
    const gameNodes = useMemo(() => gameLine(tree, gameTurns), [tree, gameTurns]);
    const lineDepth = useMemo(() => new Map(gameNodes.map((node) => [node.id, node.turn])), [gameNodes]);

    const entries = useReadingsAt(readings, atKey);
    const entry = entries.get(analyzerSource.id) ?? noEntry;
    const ownEntry = gameId === null ? undefined : entries.get(ownSourceId(gameId, toMove));
    const shown = ownView ? (ownEntry ?? noEntry) : entry;
    const read = shown.read;
    const lines = useMemo(() => (read === null ? [] : shownLines(read.reading, position, toMove, settings.lines)), [read, position, toMove, settings.lines]);
    const shownPreview = preview !== null && lines.includes(preview) ? preview : null;
    // A reading on its way, asked or about to be, keeps the lines' rows and the bar in place.
    const waiting = !ownView && read === null && (entry.state.kind === `thinking` || entry.state.kind === `queued` || (entry.state.kind === `idle` && analyzing));
    const anyId = botSourceId(null);
    const analyzerPill = analyzerSource.id === anyId ? (entry.read === null ? null : authorSourceId(entry.read.reading)) : analyzerSource.id;
    const activePill = ownView ? ownPill : analyzerPill;
    const pills: ReadingPill[] = [];
    const addPill = (pill: ReadingPill) => {
        if (!pills.some((each) => each.id === pill.id)) pills.push(pill);
    };
    for (const [id, held] of entries) {
        const by = held.read?.reading.by;
        if (id !== anyId && by?.kind === `bot`) addPill({ id, name: by.name });
    }
    // A stored game's readers keep their pills on every turn, so the row holds still as the board steps.
    for (const name of storedNames) addPill({ id: botSourceId(name), name });
    if (analyzerPill !== null && settings.analyzer !== null) addPill({ id: analyzerPill, name: settings.analyzer });
    // By name, so a pill stays put as readings arrive; the own views last.
    pills.sort((a, b) => a.name.localeCompare(b.name));
    if (ownChoice !== null) pills.push({ id: ownPill, name: text.analysis.reading.ownView });
    const ownSeat = game?.snapshot.players[toMove];
    const analyzerShown: AnalyzerShown =
        read !== null
            ? authorShown(read.reading.by, read.reading.seconds)
            : ownView
              ? { kind: `own`, name: ownSeat?.kind === `bot` ? ownSeat.name : null, side: toMove }
              : settings.analyzer === null
                ? { kind: `any`, seconds: ask.seconds }
                : analyzers.kind === `ready` && listing?.analyzer?.ready !== true
                  ? { kind: `offline`, name: settings.analyzer }
                  : { kind: `named`, name: settings.analyzer, version: listing?.version ?? null, ownerName: listing?.ownerName ?? null, seconds: ask.seconds };

    // The game's reading the graph, the marks, and its rows come from, as the drawer shows it:
    // the own views while their pill is picked, else the pill's analyzer's reading of the whole game, else the first.
    const shownAnalyzer = ownView ? null : read?.reading.by.kind === `bot` ? read.reading.by.name : settings.analyzer;
    const active: ReadingChoice | null =
        head === null
            ? null
            : ownView && ownChoice !== null
              ? ownChoice
              : (head.choices.find((choice) => choice.kind === `community` && choice.name === shownAnalyzer) ?? head.choices[0] ?? null);
    const view = useMemo(() => {
        if (active === null || record === null) return null;
        return active.kind === `community` ? communityReading(record, active.analysis.turns, active.analysis.status === `done`, active.analysis.analyzer?.values ?? undeclaredValues) : ownReading(record, active.views);
    }, [active, record]);
    const snapshot = useReadingsSnapshot(readings);
    // Rows away from the game's own turns read what the source of the game's reading holds, or the analyzer the panel asks.
    const analyzerId = analyzerSource.id;
    const sourceFor = useCallback(
        (side: Side) => (active === null || gameId === null ? analyzerId : active.kind === `community` ? botSourceId(active.name) : ownSourceId(gameId, side)),
        [active, gameId, analyzerId],
    );
    const facts = useMemo(() => {
        const all = rowFacts(tree, (key, id) => snapshot.get(key)?.get(id)?.read?.reading ?? null, sourceFor);
        if (view === null) return all;
        for (const node of gameNodes) {
            const turn = view.turns.get(node.turn);
            if (turn === undefined || (turn.value === null && turn.judgment === null)) all.delete(node.id);
            else all.set(node.id, { judgment: turn.judgment, value: turn.value });
        }
        return all;
    }, [tree, snapshot, sourceFor, view, gameNodes]);

    // A community reading's runs of marked turns fold in the list after their first turn.
    const folds = useMemo((): ListFold[] => {
        if (view === null || active?.kind !== `community`) return [];
        const idOf = new Map(gameNodes.map((node) => [node.turn, node.id]));
        return view.runs.flatMap((run) => {
            const first = idOf.get(run.from);
            if (first === undefined) return [];
            const hidden = Array.from({ length: run.to - run.from }, (_, index) => idOf.get(run.from + 1 + index)).filter((id) => id !== undefined);
            return [{ first, hidden, ...explainRun(run, active.name) }];
        });
    }, [view, active, gameNodes]);

    // The turn shown explained from the reading its row's value comes from:
    // a game's own turn from the game's reading picked, any other from what the same source read around it;
    // and whether the game's community reading is the one that says it.
    const explained = useMemo((): { readonly explanation: Explanation; readonly community: boolean } | null => {
        const plainly = (explanation: Explanation) => ({ explanation, community: false });
        if (game !== null && at === floor && openingTurns(tree.root) > 0) return plainly(explain({ kind: `opening` }, { kind: `none` }));
        if (node?.kind !== `turn`) return null;
        const onGame = lineDepth.has(node.id);
        // A game no reading may judge whole, opted out or out of an analyzer's reach, waits for none.
        const judgeable = head?.card?.kind !== `opted-out` && head?.card?.kind !== `unreadable`;
        const place = gameId === null ? `board` : !onGame ? `variation` : judgeable ? `game` : `board`;
        const player = onGame && game !== null ? seatName(game.snapshot.players[node.side]) : null;
        const turn: ExplainedTurn = { kind: `turn`, turn: node.turn, side: node.side, cells: node.cells, completesSix: node.win !== null, place, player };
        if (onGame && view !== null && active !== null && record !== null) {
            const read = view.turns.get(node.turn);
            if (active.kind === `own`) return plainly(explain(turn, { kind: `own`, name: player ?? ``, after: read?.value ?? null }));
            if (read === undefined) return plainly(explain(turn, { kind: `none` }));
            // A six speaks for itself, whoever read the game.
            return { explanation: explain(turn, turnReading(record, read, active.name, active.analysis.status === `done`)), community: !turn.completesSix };
        }
        const parent = nodeAt(tree, node.parent);
        const readAt = (key: string, side: Side) => snapshot.get(key)?.get(sourceFor(side))?.read?.reading ?? null;
        const before = parent === undefined ? null : readAt(parent.key, node.side);
        const after = facts.get(node.id)?.value ?? null;
        const by = before?.by ?? readAt(node.key, node.side === `x` ? `o` : `x`)?.by ?? null;
        if (by === null || (before === null && after === null)) return plainly(explain(turn, { kind: `none` }));
        if (by.kind === `own`) return plainly(explain(turn, { kind: `own`, name: by.name, after }));
        const best = before === null ? null : (shownLines(before, positionAt(tree, node.parent), node.side, 1)[0] ?? null);
        return plainly(explain(turn, { kind: `analyzer`, name: authorName(by), best, after, judgment: null, whole: false, forced: null, drop: null }));
    }, [game, at, floor, tree, node, lineDepth, gameId, head, view, active, record, snapshot, sourceFor, facts]);
    const explanation = explained?.explanation ?? null;

    // A game's community reading by an analyzer whose owner played says so in the head while the head names its analyzer,
    // and under the explanation while the explanation is the reading's.
    const involvedWords = active?.kind === `community` && game !== null ? involvedNote(active.analysis, game.snapshot.players) : null;
    const headName = analyzerShown.kind === `named` || analyzerShown.kind === `offline` ? analyzerShown.name : null;
    const headNamesActive = !ownView && active?.kind === `community` && headName === active.name;
    const involved = { head: headNamesActive ? involvedWords : null, explanation: explained?.community === true ? involvedWords : null };

    const openSetup = useCallback(() => {
        setRefusal(null);
        setDialog(null);
        setEditing(draftOf(positionAt(tree, at)));
    }, [tree, at]);

    // Leaving Set up hands the keyboard back to the button that opened it,
    // which the tools covered.
    useEffect(() => {
        if (editing === null && wasEditing.current) setupButton.current?.focus({ preventScroll: true });
        wasEditing.current = editing !== null;
    }, [editing]);

    // Esc leaves Set up as Cancel does.
    useEffect(() => {
        if (editing === null) return;
        function onKey(event: KeyboardEvent) {
            if (event.key !== `Escape` || event.defaultPrevented || typingInto(event.target)) return;
            if (event.target instanceof Element && event.target.closest(`dialog`) !== null) return;
            event.preventDefault();
            setEditing(null);
        }
        window.addEventListener(`keydown`, onKey);
        return () => {
            window.removeEventListener(`keydown`, onKey);
        };
    }, [editing]);

    useEffect(() => {
        if (editing !== null || dialog !== null) return;
        function onKey(event: KeyboardEvent) {
            if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || typingInto(event.target)) return;
            if (event.target instanceof Element && event.target.closest(`dialog`) !== null) return;
            const moves: Record<string, ((board: AnalysisState) => AnalysisState) | undefined> = {
                ArrowLeft: back,
                ArrowRight: forward,
                ArrowUp: (current) => switchLine(current, -1),
                ArrowDown: (current) => switchLine(current, 1),
                Home: toStart,
                End: toEnd,
                Escape: unmark,
            };
            const move = moves[event.key];
            if (move !== undefined) {
                event.preventDefault();
                step(move);
                return;
            }
            if (event.key === `s`) {
                event.preventDefault();
                openSetup();
            }
            if (event.key === `a`) {
                event.preventDefault();
                askNow();
            }
        }
        window.addEventListener(`keydown`, onKey);
        return () => {
            window.removeEventListener(`keydown`, onKey);
        };
    }, [editing, dialog, step, openSetup, askNow]);

    const actions: RowActions = useMemo(
        () => ({
            promote: (id) => {
                step((current) => promoteLine(current, id));
            },
            remove: (id) => {
                step((current) => deleteFrom(current, gameTurns, id));
            },
            copy: (id) => {
                const turns = lineTo(tree, id);
                const asLink = tree.root.kind === `setup`;
                const copied = tree.root.kind === `setup` ? `${window.location.origin}${setupLink(tree.root.start, turns)}` : writeGame(turns);
                navigator.clipboard.writeText(copied).then(
                    () => {
                        setStatus(asLink ? text.analysis.tree.copiedLink : text.analysis.tree.copiedText);
                    },
                    () => {
                        setStatus(text.analysis.tree.copyFailed);
                    },
                );
            },
        }),
        [tree, gameTurns, step],
    );

    const goToNode = useCallback(
        (id: NodeId) => {
            step((current) => goTo(current, id));
        },
        [step],
    );

    // The graph's cursor stands at the game's turn on the board, or for a variation at the turn it leaves from.
    const graphCursor = useMemo(() => {
        for (const id of pathTo(tree, at).reverse()) {
            const turn = lineDepth.get(id);
            if (turn !== undefined) return turn;
        }
        return 0;
    }, [tree, at, lineDepth]);
    const goToTurn = useCallback(
        (turn: number) => {
            const id = turn <= 0 ? rootId : gameNodes[turn - 1]?.id;
            if (id !== undefined) goToNode(id);
        },
        [gameNodes, goToNode],
    );
    // A judged turn of the game wears its mark on the board beside its last stone.
    const judged = node?.kind === `turn` && lineDepth.has(node.id) ? view?.turns.get(node.turn)?.judgment : undefined;
    const judgedCell = judged === undefined || judged === null || record === null || node?.kind !== `turn` ? undefined : turnCells(record, node.turn).at(-1);

    function onCell(cell: AxialCoord) {
        if (editing !== null) {
            setEditing(clickCell(editing, cell));
            return;
        }
        setArmed(false);
        setStatus(null);
        const marked = markCell(board, cell);
        setRefusal(marked.refusal === null ? null : refusalText(marked.refusal));
        if (marked.state !== board) onBoard(() => marked.state);
    }

    function playLine(line: ShownLine) {
        setArmed(false);
        setStatus(null);
        setPreview(null);
        const played = playCells(board, line.cells);
        setRefusal(played.refusal === null ? null : refusalText(played.refusal));
        if (played.state !== board) onBoard(() => played.state);
    }

    // A line an explanation names plays as a variation from the position its turn was played from.
    function playPreferred(line: PreferredLine) {
        if (node?.kind !== `turn`) return;
        setArmed(false);
        setStatus(null);
        setPreferred(null);
        const played = playCells({ tree, at: node.parent, mark: null }, line.cells);
        setRefusal(played.refusal === null ? null : refusalText(played.refusal));
        if (played.refusal === null) onBoard(() => played.state);
    }

    function load(imported: Imported) {
        setDialog(null);
        switch (imported.kind) {
            case `line`:
                onReplace(lineBoard(null, imported.line.turns, imported.pending));
                return;
            case `setup`:
                onReplace(lineBoard(imported.start, imported.line.turns, null));
                return;
            case `game`:
                navigate(gameLink(imported.gameId, imported.turn));
                return;
            case `elsewhere`:
                return;
        }
    }

    const exportView = (): ExportView => {
        const turns = lineTo(tree, at);
        const origin = window.location.origin;
        const onGame = gameId !== null && isMainLine(tree, at);
        return {
            line: tree.root.kind === `setup` ? null : { text: writeGame(turns), turns: turns.length },
            position,
            link: {
                url: `${origin}${onGame ? gameLink(gameId, node?.turn ?? 0) : tree.root.kind === `setup` ? setupLink(tree.root.start, turns) : lineLink(turns)}`,
                game: onGame,
            },
        };
    };

    const turnWords =
        editing !== null
            ? text.analysis.nav.setup
            : at === floor && openingTurns(tree.root) > 0 && game !== null
              ? game.snapshot.openingPlies === 1
                  ? text.replay.origin
                  : text.replay.opening(game.snapshot.openingPlies)
              : !isMainLine(tree, at)
                ? text.analysis.nav.variation(node?.turn ?? 0)
                : game !== null
                  ? text.analysis.nav.turnOf(node?.turn ?? 0, mainLineEnd)
                  : text.analysis.nav.turn(node?.turn ?? 0);
    const editingSide = editing === null ? toMove : sideOf(editing.toMove);
    const stateWords = editing !== null ? text.analysis.nav.toMove(editingSide) : positionWords(toMove, mark !== null, won);
    const atStart = at === floor;
    const atEnd = end === at;
    const source = <SourceLines tree={tree} game={game} editing={editing !== null} at={at} />;
    // A new board from the origin introduces itself, and its source says no more.
    const fresh = tree.nodes.size === 1 && tree.root.kind === `origin`;

    const steps = (compact: boolean) => (
        <span className="scrubber">
            {stepButton(text.analysis.nav.start, `M7 5v14M18 6l-7 6 7 6`, atStart, () => {
                step(toStart);
            })}
            {stepButton(text.analysis.nav.back, `M15 5l-7 7 7 7`, atStart, () => {
                step(back);
            })}
            {compact ? null : <span className="scrub-words">{turnWords}</span>}
            {stepButton(text.analysis.nav.forward, `M9 5l7 7-7 7`, atEnd, () => {
                step(forward);
            })}
            {stepButton(text.analysis.nav.end, `M17 5v14M6 6l7 6-7 6`, atEnd, () => {
                step(toEnd);
            })}
        </span>
    );
    const line = (
        <span className="an-nav-line">
            {refusal !== null && editing === null ? (
                <span className="hud-note" role="alert">
                    {refusal}
                </span>
            ) : (
                <span role="status">
                    {won === null || editing !== null ? <Swatch side={editingSide} /> : null}
                    {stateWords}
                </span>
            )}
        </span>
    );

    const replaces = gameId !== null && game !== null ? text.analysis.setup.gameTree(game.snapshot.players.x.name, game.snapshot.players.o.name) : text.analysis.setup.thisTree;
    const draftStones = editing === null ? null : editing.stones.map((stone) => ({ x: stone.x, y: stone.y, side: sideOf(stone.player), number: null }));
    // A preferred line shows on the board its turn was played from, in that turn's place.
    const preferredFrom = preferred !== null && explanation?.line === preferred && node?.kind === `turn` ? node.parent : null;
    const preferredStones = useMemo(() => (preferredFrom === null ? null : numberedStones(tree, preferredFrom)), [tree, preferredFrom]);
    const draftField = editing === null ? undefined : [{ x: 0, y: 0 }, ...editing.stones];

    return (
        <div className="an-screen" data-editing={editing === null ? undefined : ``}>
            <h1 className="sr-only">{text.analysis.title}</h1>
            <section className="an-stage" aria-label={text.analysis.workspace}>
                <AnalysisBoard
                    stones={draftStones ?? preferredStones ?? stones}
                    frame={draftField ?? frame}
                    field={draftField}
                    mark={editing === null && preferredStones === null ? mark : null}
                    toMove={toMove}
                    lastMove={editing === null && preferredStones === null && node?.kind === `turn` && node.win === null ? node.cells : []}
                    winLine={editing === null && preferredStones === null && node?.kind === `turn` && node.win !== null ? node.win.cells : []}
                    label={text.analysis.board(stateWords)}
                    lines={settings.boardLines && editing === null && preferredStones === null && lines.length > 0 ? { side: toMove, lines } : undefined}
                    preview={
                        editing !== null
                            ? undefined
                            : preferredStones !== null && preferred !== null
                              ? { side: preferred.side, cells: preferred.cells }
                              : shownPreview === null
                                ? undefined
                                : { side: toMove, cells: shownPreview.cells }
                    }
                    judgment={
                        editing !== null || preferredStones !== null || judgedCell === undefined || judged === undefined || judged === null ? undefined : { cell: judgedCell, severity: judged.severity }
                    }
                    onCell={onCell}
                    onPaste={(pasted) => {
                        if (editing === null) setDialog({ kind: `import`, text: pasted });
                    }}
                />
                {editing === null && unreadable === null ? <EvalBar line={lines[0] ?? null} held={waiting} /> : null}
                <div className="hud-lift an-chip-source">
                    <div className="hud-chip">{source}</div>
                </div>
                <div className="hud-lift an-chip-nav">
                    <div className="hud-chip">
                        {editing === null ? steps(false) : <span className="scrub-words">{turnWords}</span>}
                        {line}
                    </div>
                </div>
            </section>
            <div className="an-phone-nav">
                {editing === null ? steps(true) : null}
                <span className="an-phone-words">
                    <span className="scrub-words">{turnWords}</span>
                    {line}
                </span>
            </div>
            <aside className="an-panel" aria-label={text.analysis.panel}>
                {editing !== null ? (
                    <div className="an-panel-scroll">
                        <SetupTools
                            draft={editing}
                            replaces={replaces}
                            onChange={setEditing}
                            onCancel={() => {
                                setEditing(null);
                            }}
                            onDone={() => {
                                const start = draftSetup(editing);
                                setEditing(null);
                                onReplace(standOn(newTree({ kind: `setup`, start })));
                            }}
                        />
                    </div>
                ) : (
                    <>
                        {fresh ? null : <div className="an-phone-source">{source}</div>}
                        <AnalyzerWindow
                            signedIn={me.status === `loading` ? null : signedIn}
                            analyzing={analyzing}
                            onAnalyzing={(on) => {
                                setAnalyzing(on);
                                if (on) askNow();
                            }}
                            settings={
                                <AnalysisSettingsPanel
                                    signedIn={signedIn}
                                    settings={settings}
                                    onSettings={updateSettings}
                                    analyzers={analyzers}
                                    onOpen={reloadAnalyzers}
                                    left={positionsLeft}
                                />
                            }
                            shown={{ analyzer: analyzerShown, entry: shown, lines, held: waiting, toMove, unreadable }}
                            involved={involved}
                            pills={pills}
                            activePill={activePill}
                            onPill={(pill) => {
                                if (pill.id === ownPill) {
                                    setOwnFor(gameId);
                                    return;
                                }
                                setOwnFor(null);
                                updateSettings({ analyzer: pill.name });
                            }}
                            graph={game !== null && record !== null && view !== null && active !== null ? <CourseGraph view={view} choice={active} line={record} cursor={graphCursor} onTurn={goToTurn} /> : null}
                            card={
                                analyses.state.load.kind === `failed` ? (
                                    <p className="dr-failed">
                                        <span className="field-error">{text.drawer.reading.loadFailed}</span>
                                        <button type="button" className="btn btn-ghost btn-sm" onClick={analyses.retry}>
                                            {text.states.tryAgain}
                                        </button>
                                    </p>
                                ) : head?.card === undefined || head.card === null ? null : (
                                    <GameRequest card={head.card} state={analyses.state} asker={asker} analyzer={settings.analyzer} onRequest={analyses.request} />
                                )
                            }
                            counts={game !== null && view !== null && active?.kind === `community` && active.analysis.status === `done` ? <Marks view={view} players={game.snapshot.players} grid /> : null}
                            explanation={explanation}
                            onPreview={setPreview}
                            onPlay={playLine}
                            onPreferred={setPreferred}
                            onPlayPreferred={playPreferred}
                            onAsk={askNow}
                            wait={waitWords}
                        />
                        <div className="an-panel-scroll">
                            {notice === null ? null : (
                                <div className="an-notice" role="alert">
                                    <p className="an-error">{text.analysis.linkFailed}</p>
                                    <p className="note">{notice}</p>
                                </div>
                            )}
                            {fresh ? (
                                <div className="an-intro">
                                    <h2 className="card-title">{text.analysis.intro.title}</h2>
                                    <p className="note">{text.analysis.intro.body((games) => <Link to="/games">{games}</Link>)}</p>
                                </div>
                            ) : null}
                            {/* The keys scroll with the tree, which keeps the panel's room for its rows. */}
                            <div className="an-tree-host">
                                <MoveList tree={tree} gameTurns={gameTurns} at={at} onGo={goToNode} actions={actions} facts={facts} folds={folds} />
                                <p className="note an-keys">{text.analysis.keys(key)}</p>
                            </div>
                            <p className="note an-status" role="status">
                                {status}
                            </p>
                        </div>
                        <div className="an-foot">
                            <button type="button" className="btn btn-ghost btn-sm" ref={setupButton} onClick={openSetup}>
                                {text.analysis.foot.setup}
                            </button>
                            <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => {
                                    setDialog({ kind: `import`, text: `` });
                                }}
                            >
                                {text.analysis.foot.import}
                            </button>
                            <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => {
                                    setDialog({ kind: `export` });
                                }}
                            >
                                {text.analysis.foot.export}
                            </button>
                            <button
                                type="button"
                                className={armed ? `btn btn-danger btn-sm` : `btn btn-ghost btn-sm`}
                                onClick={() => {
                                    if (!armed && holdsOwnTurns(tree, gameTurns)) {
                                        setArmed(true);
                                        return;
                                    }
                                    setArmed(false);
                                    onNewBoard();
                                }}
                            >
                                {armed ? text.analysis.foot.newBoardArmed : text.analysis.foot.newBoard}
                            </button>
                        </div>
                    </>
                )}
            </aside>
            {dialog?.kind === `import` ? (
                <ImportDialog
                    initial={dialog.text}
                    onClose={() => {
                        setDialog(null);
                    }}
                    onLoad={load}
                />
            ) : null}
            {dialog?.kind === `export` ? (
                <ExportDialog
                    view={exportView()}
                    onClose={() => {
                        setDialog(null);
                    }}
                />
            ) : null}
        </div>
    );
}

function key(name: string) {
    return <kbd>{name}</kbd>;
}

function stepButton(label: string, glyph: string, disabled: boolean, go: () => void): ReactNode {
    return (
        <button
            type="button"
            className="scrub-step"
            aria-label={label}
            aria-disabled={disabled ? `true` : undefined}
            onClick={() => {
                if (!disabled) go();
            }}
        >
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={glyph} />
            </svg>
        </button>
    );
}

// The board's source in two lines: what it starts from, then how to read it.
function SourceLines({ tree, game, editing, at }: { tree: Tree; game: OpenedGame | null; editing: boolean; at: NodeId }) {
    const words = text.analysis.source;
    if (editing) return <SourceText title={words.editing} note={words.editingNote} />;
    if (game !== null && game.snapshot.status === `finished`) {
        const { x, o } = game.snapshot.players;
        const turn = isMainLine(tree, at) ? (nodeAt(tree, at)?.turn ?? null) : null;
        const gamePath = `${pagePath(`game`, { gameId: game.snapshot.gameId })}${turn === null ? `` : `?turn=${String(turn)}`}`;
        const seat = (side: Side, player: typeof x) => (
            <span className="an-seat">
                <Swatch side={side} />
                <PlayerName name={player.name} kind={player.kind === `bot` ? `bot` : `human`} deleted={player.deleted === true} />
                {player.kind === `bot` ? <BotBadge /> : null}
            </span>
        );
        return (
            <SourceText
                title={words.game(seat(`x`, x), seat(`o`, o))}
                note={words.gameNote(
                    resultSentence({ ...game.snapshot, turns: turnsOnBoard(game.snapshot.board.cells.length) }, { x: x.name, o: o.name }),
                    (open) => <Link to={gamePath}>{open}</Link>,
                )}
            />
        );
    }
    if (tree.root.kind === `setup`) return <SourceText title={words.setup} note={words.setupNote} />;
    return <SourceText title={words.origin} note={words.originNote} />;
}

function SourceText({ title, note }: { title: ReactNode; note: ReactNode }) {
    return (
        <span className="an-source">
            <span className="an-source-title">{title}</span>
            <span className="an-source-note">{note}</span>
        </span>
    );
}
