import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
    analysisMeta,
    analysisPagePath,
    resultSentence,
    sideOf,
    turnsOnBoard,
    type AxialCoord,
    type GameSnapshot,
    type Side,
} from '@hexo-arena/contract';
import type { Setup, TurnCells } from '@hexo-arena/rules';
import { ApiError, fetchGameSnapshot, limitedFor } from '../api/client';
import { AnalysisBoard } from '../analysis/AnalysisBoard';
import { ExportDialog, ImportDialog, type ExportView } from '../analysis/dialogs';
import { draftOf, draftSetup, type SetupDraft, clickCell } from '../analysis/draft';
import type { Imported } from '../analysis/import-text';
import { gameLink, lineLink, readAddress, setupLink } from '../analysis/links';
import { MoveTree, type RowActions } from '../analysis/MoveTree';
import { writeGame } from '../analysis/notation';
import { SetupTools } from '../analysis/SetupTools';
import { analysisStorageKey } from '../analysis/storage-key';
import {
    back,
    blankBoard,
    deleteFrom,
    floorOf,
    forward,
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
import { isMainLine, lineEnd, lineTo, mainLine, newTree, nodeAt, openingTurns, positionAt, rootId, type MoveTree as Tree, type NodeId } from '../analysis/tree';
import { notationErrorText, positionWords, refusalText } from '../analysis/words';
import type { BoardStone } from '../board/Board';
import { BoardToggles } from '../board/BoardToggles';
import { BotBadge, PlayerName, Swatch } from '../components/player';
import { useWait, WaitText } from '../components/wait';
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

function typingInto(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.isContentEditable || [`INPUT`, `TEXTAREA`, `SELECT`].includes(target.tagName));
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
                        <Link to={`/game/${encodeURIComponent(opened.gameId)}`} className="btn btn-primary">
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
        }
        window.addEventListener(`keydown`, onKey);
        return () => {
            window.removeEventListener(`keydown`, onKey);
        };
    }, [editing, dialog, step, openSetup]);

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
    const draftField = editing === null ? undefined : [{ x: 0, y: 0 }, ...editing.stones];

    return (
        <div className="an-screen" data-editing={editing === null ? undefined : ``}>
            <h1 className="sr-only">{text.analysis.title}</h1>
            <section className="an-stage" aria-label={text.analysis.workspace}>
                <AnalysisBoard
                    stones={draftStones ?? stones}
                    frame={draftField ?? frame}
                    field={draftField}
                    mark={editing === null ? mark : null}
                    toMove={toMove}
                    lastMove={editing === null && node?.kind === `turn` && node.win === null ? node.cells : []}
                    winLine={editing === null && node?.kind === `turn` && node.win !== null ? node.win.cells : []}
                    label={text.analysis.board(stateWords)}
                    onCell={onCell}
                    onPaste={(pasted) => {
                        if (editing === null) setDialog({ kind: `import`, text: pasted });
                    }}
                />
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
                        <div className="an-panel-scroll">
                            {fresh ? null : <div className="an-phone-source">{source}</div>}
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
                            <div className="an-head">
                                <BoardToggles />
                            </div>
                            <div className="an-tree-host">
                                <MoveTree tree={tree} gameTurns={gameTurns} at={at} onGo={goToNode} actions={actions} />
                            </div>
                            <p className="note an-keys">{text.analysis.keys(key)}</p>
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
        const gamePath = `/game/${encodeURIComponent(game.snapshot.gameId)}${turn === null ? `` : `?turn=${String(turn)}`}`;
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
