import { Fragment, memo, useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import type { Judgment, Side, ValueText } from '@hexo-arena/contract';
import type { TurnCells } from '@hexo-arena/rules';
import { Swatch } from '../components/player';
import { text } from '../text';
import { verdictTitle } from './explain';
import { JudgmentChip } from './Judgment';
import { bandOf, type BandToken } from './move-list';
import { cellText } from './notation';
import type { RowFact } from './row-facts';
import { SpokenText } from './SpokenText';
import { deletable, floorOf } from './state';
import { isMainLine, mainLine, nodeAt, openingTurns, pathTo, rootId, type MoveTree as Tree, type NodeId } from './tree';

/** A run of the game's turns folded under one note after its first turn: the rows it hides, and the note. */
export interface ListFold {
    readonly first: NodeId;
    readonly hidden: readonly NodeId[];
    readonly title: string;
    readonly text: string;
}

/** What a row's menu does to the line through its turn. */
export interface RowActions {
    readonly promote: (id: NodeId) => void;
    readonly remove: (id: NodeId) => void;
    readonly copy: (id: NodeId) => void;
}

// A press held this long on a touch screen opens a turn's menu, as a right click does.
const longPressMs = 500;

const words = text.analysis.tree;

/**
 * The move tree as a list: one row a turn down the main line, a stored game's drawn opening as one row,
 * and under the main-line turn they replace, its variations as one indented band,
 * each a paragraph of turns with the alternatives inside it in parentheses.
 * A row says, where a reading does, the verdict on its turn and the value after it;
 * a run of marked turns folds under one note after its first, open while the turn shown lies in it.
 * A turn's menu, from its "more" button, a right click, or a long press,
 * promotes, deletes, or copies the line through it.
 */
export function MoveList({ tree, gameTurns, at, onGo, actions, facts, folds }: {
    tree: Tree;
    // A stored game's own turns, which stay in the tree; none for any other root.
    gameTurns: readonly TurnCells[];
    at: NodeId;
    onGo: (id: NodeId) => void;
    actions: RowActions;
    facts: ReadonlyMap<NodeId, RowFact>;
    folds: readonly ListFold[];
}) {
    const [menu, setMenu] = useState<NodeId | null>(null);
    const [opened, setOpened] = useState<ReadonlySet<NodeId>>(new Set());
    const listRef = useRef<HTMLOListElement>(null);
    const floor = floorOf(tree);
    const line = mainLine(tree);
    const opening = openingTurns(tree.root) > 0 ? line.slice(1, line.indexOf(floor) + 1) : [];
    const start = nodeAt(tree, opening.length > 0 ? floor : rootId)?.children[0];
    const rows = line.slice(line.indexOf(start ?? rootId)).filter((id) => id !== rootId);

    // A menu belongs to its turn; a turn removed takes its menu along, and
    // a new tree, whose handles start again, closes it.
    const menuShown = menu !== null && tree.nodes.has(menu) ? menu : null;
    useEffect(() => {
        setMenu(null);
    }, [tree.root]);

    // The current turn stays in view inside the list's own scroll, a turn's
    // room on either side so its neighbours show too, never scrolling the
    // page, where the list flows on a phone; the window above the list grows
    // and shrinks with the analyzer's words, so a resize brings it back into
    // view too.
    useEffect(() => {
        const host = listRef.current?.parentElement;
        if (host === null || host === undefined) return;
        function keepInView() {
            const shown = listRef.current?.querySelector<HTMLElement>(`[aria-current="step"]`);
            if (host === null || host === undefined || shown === null || shown === undefined || host.scrollHeight <= host.clientHeight) return;
            const top = shown.getBoundingClientRect().top - host.getBoundingClientRect().top;
            const room = shown.offsetHeight;
            if (top < room) host.scrollTop += top - room;
            else if (top + 2 * room > host.clientHeight) host.scrollTop += top + 2 * room - host.clientHeight;
        }
        keepInView();
        if (typeof ResizeObserver === `undefined`) return;
        const watcher = new ResizeObserver(keepInView);
        watcher.observe(host);
        return () => {
            watcher.disconnect();
        };
    }, [at, tree]);

    const menuFor = (id: NodeId, turn: number) => (
        <RowMenu
            key={`menu-${String(id)}`}
            turn={turn}
            promote={
                isMainLine(tree, id)
                    ? null
                    : () => {
                          setMenu(null);
                          actions.promote(id);
                      }
            }
            remove={
                deletable(tree, gameTurns, id)
                    ? () => {
                          setMenu(null);
                          actions.remove(id);
                      }
                    : null
            }
            copy={() => {
                setMenu(null);
                actions.copy(id);
            }}
            onClose={() => {
                setMenu(null);
                listRef.current?.querySelector<HTMLElement>(`[data-node="${String(id)}"]`)?.focus();
            }}
        />
    );

    // A fold stays open while the turn shown, or the variation it stands in, lies inside it.
    const path = new Set(pathTo(tree, at));
    const shut = new Set<NodeId>();
    const foldAfter = new Map<NodeId, { fold: ListFold; open: boolean }>();
    for (const fold of folds) {
        const inside = fold.hidden.some((id) => id === at || siblingsOf(tree, id).some((sibling) => path.has(sibling)));
        const open = inside || opened.has(fold.first);
        foldAfter.set(fold.first, { fold, open });
        if (!open) for (const id of fold.hidden) shut.add(id);
    }

    const items: ReactNode[] = [];
    for (const id of rows) {
        const node = nodeAt(tree, id);
        if (node?.kind !== `turn` || shut.has(id)) continue;
        const fact = facts.get(id);
        items.push(
            <Row
                key={id}
                id={id}
                turn={node.turn}
                side={node.side}
                cells={cellsOf(node.cells)}
                judgment={fact?.judgment ?? null}
                value={fact?.value ?? null}
                current={id === at}
                menuOpen={menuShown === id}
                onGo={onGo}
                onMenu={setMenu}
            />,
        );
        if (menuShown === id) items.push(<li key={`menu-${String(id)}`}>{menuFor(id, node.turn)}</li>);
        const band = bandOf(tree, id);
        if (band.length > 0) {
            items.push(
                <li key={`band-${String(id)}`} className="an-band">
                    {band.map((tokens, paragraph) => {
                        const held = tokens.find((token) => token.id === menuShown);
                        const heldNode = held === undefined ? undefined : nodeAt(tree, held.id);
                        return (
                            <Fragment key={tokens[0]?.id ?? paragraph}>
                                <p className="an-band-line">
                                    {tokens.map((token, index) => (
                                        <Fragment key={token.id}>
                                            {index > 0 ? ` ` : null}
                                            <Token tree={tree} token={token} current={token.id === at} menuOpen={menuShown === token.id} onGo={onGo} onMenu={setMenu} />
                                        </Fragment>
                                    ))}
                                </p>
                                {held === undefined || heldNode?.kind !== `turn` ? null : menuFor(held.id, heldNode.turn)}
                            </Fragment>
                        );
                    })}
                </li>,
            );
        }
        const folded = foldAfter.get(id);
        if (folded !== undefined) {
            items.push(
                <RunNote
                    key={`run-${String(id)}`}
                    fold={folded.fold}
                    open={folded.open}
                    onToggle={() => {
                        setOpened((current) => {
                            const next = new Set(current);
                            if (next.has(id)) next.delete(id);
                            else next.add(id);
                            return next;
                        });
                    }}
                />,
            );
        }
    }

    return (
        <ol className="an-tree" ref={listRef} aria-label={words.label} data-facts={facts.size === 0 ? undefined : ``} data-marks={[...facts.values()].some((fact) => fact.judgment !== null) ? `` : undefined}>
            {opening.length > 0 ? <OpeningRow tree={tree} ids={opening} current={at === floor} onGo={onGo} floor={floor} /> : null}
            {items}
        </ol>
    );
}

// The other turns played from the same position as this one: the variations a band under its row shows.
function siblingsOf(tree: Tree, id: NodeId): readonly NodeId[] {
    const node = nodeAt(tree, id);
    if (node?.kind !== `turn`) return [];
    return (nodeAt(tree, node.parent)?.children ?? []).filter((child) => child !== id);
}

// A run's note: what its turns did and who marks them, a press showing or hiding the turns it folds.
function RunNote({ fold, open, onToggle }: { fold: ListFold; open: boolean; onToggle: () => void }) {
    return (
        <li className="an-run">
            <button type="button" className="an-run-go" aria-expanded={open} onClick={onToggle}>
                <span className="an-run-words">
                    <span className="an-run-title">{fold.title}</span>
                    <span className="an-run-text">{fold.text}</span>
                </span>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 9l6 6 6-6" />
                </svg>
            </button>
        </li>
    );
}

function cellsOf(cells: TurnCells): string {
    return cells.map(cellText).join(` `);
}

// A turn's side and cells: the swatch and the cells to the eye, the side named for assistive tech.
function Move({ side, cells }: { side: Side; cells: string }) {
    return (
        <span className="an-move">
            <Swatch side={side} />
            <span className="an-turn-cells" aria-hidden="true">
                {cells}
            </span>
            <span className="sr-only">{text.analysis.reading.cells(side, [cells])}</span>
        </span>
    );
}

// The drawn opening reads as one row, the origin and each drawn turn, each side's group whole.
function OpeningRow({ tree, ids, floor, current, onGo }: { tree: Tree; ids: readonly NodeId[]; floor: NodeId; current: boolean; onGo: (id: NodeId) => void }) {
    const groups: { side: Side; cells: string }[] = [{ side: `x`, cells: cellText({ x: 0, y: 0 }) }];
    for (const id of ids) {
        const node = nodeAt(tree, id);
        if (node?.kind === `turn`) groups.push({ side: node.side, cells: cellsOf(node.cells) });
    }
    return (
        <li className={`an-row an-opening${current ? ` current` : ``}`}>
            <button
                type="button"
                className="an-row-go"
                aria-current={current ? `step` : undefined}
                onClick={() => {
                    onGo(floor);
                }}
            >
                <span className="an-row-n">
                    <span aria-hidden="true">{words.openingMark}</span>
                    <span className="sr-only">{`${words.openingSpoken(ids.length)},`}</span>
                </span>
                <span className="an-groups">
                    {groups.map((group, index) => (
                        <Fragment key={`${group.side}${group.cells}`}>
                            {index > 0 ? ` ` : null}
                            <Move side={group.side} cells={group.cells} />
                        </Fragment>
                    ))}
                </span>
            </button>
        </li>
    );
}

// A press opens the turn; a long press on a touch screen, or a right click, opens its menu instead.
function usePress(id: NodeId, onGo: (id: NodeId) => void, onMenu: (id: NodeId | null) => void) {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const held = useRef(false);
    function release() {
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = null;
    }
    return {
        onContextMenu: (event: MouseEvent) => {
            event.preventDefault();
            onMenu(id);
        },
        onPointerDown: (event: PointerEvent) => {
            held.current = false;
            if (event.pointerType !== `touch`) return;
            timer.current = setTimeout(() => {
                held.current = true;
                onMenu(id);
            }, longPressMs);
        },
        onPointerUp: release,
        onPointerLeave: release,
        onPointerCancel: release,
        onClick: () => {
            // A long press opened the menu; its release goes nowhere.
            if (held.current) {
                held.current = false;
                return;
            }
            onGo(id);
        },
    };
}

const Row = memo(function Row({ id, turn, side, cells, judgment, value, current, menuOpen, onGo, onMenu }: {
    id: NodeId;
    turn: number;
    side: Side;
    cells: string;
    judgment: Judgment | null;
    value: ValueText | null;
    current: boolean;
    menuOpen: boolean;
    onGo: (id: NodeId) => void;
    onMenu: (id: NodeId | null) => void;
}) {
    const press = usePress(id, onGo, onMenu);
    const verdict = judgment === null ? null : verdictTitle(judgment);
    return (
        <li className={`an-row${current ? ` current` : ``}`}>
            <button type="button" className="an-row-go" data-node={id} aria-current={current ? `step` : undefined} {...press}>
                <span className="an-row-n">{String(turn)}</span>
                <Move side={side} cells={cells} />
                {judgment === null ? null : (
                    <span className="an-row-mark" title={verdict ?? undefined}>
                        <JudgmentChip severity={judgment.severity} spoken={false} />
                        <span className="sr-only">{`${verdict ?? ``};`}</span>
                    </span>
                )}
                {value === null ? null : <SpokenText words={value} className="an-row-value" />}
            </button>
            {current || menuOpen ? <MoreButton turn={turn} open={menuOpen} onToggle={() => { onMenu(menuOpen ? null : id); }} /> : null}
        </li>
    );
});

// A turn of a variation: its number, side, and cells, the parentheses of the alternatives it opens or closes held to it.
function Token({ tree, token, current, menuOpen, onGo, onMenu }: {
    tree: Tree;
    token: BandToken;
    current: boolean;
    menuOpen: boolean;
    onGo: (id: NodeId) => void;
    onMenu: (id: NodeId | null) => void;
}) {
    const press = usePress(token.id, onGo, onMenu);
    const node = nodeAt(tree, token.id);
    if (node?.kind !== `turn`) return null;
    return (
        <span className="an-tok-hold">
            <button
                type="button"
                className={`an-tok${current ? ` current` : ``}${token.nested ? ` nested` : ``}`}
                data-node={token.id}
                aria-current={current ? `step` : undefined}
                {...press}
            >
                {token.open > 0 ? <span className="an-paren">{`(`.repeat(token.open)}</span> : null}
                <span className="an-tok-n">{String(node.turn)}</span>
                <Move side={node.side} cells={cellsOf(node.cells)} />
                {token.close > 0 ? <span className="an-paren">{`)`.repeat(token.close)}</span> : null}
            </button>
            {current || menuOpen ? <MoreButton turn={node.turn} open={menuOpen} onToggle={() => { onMenu(menuOpen ? null : token.id); }} /> : null}
        </span>
    );
}

function MoreButton({ turn, open, onToggle }: { turn: number; open: boolean; onToggle: () => void }) {
    return (
        <button type="button" className="an-row-more" aria-label={words.more(turn)} aria-expanded={open} onClick={onToggle}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 12h.01M12 12h.01M18 12h.01" />
            </svg>
        </button>
    );
}

function RowMenu({ turn, promote, remove, copy, onClose }: {
    turn: number;
    promote: (() => void) | null;
    remove: (() => void) | null;
    copy: () => void;
    onClose: () => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        ref.current?.querySelector<HTMLElement>(`button`)?.focus({ preventScroll: true });
    }, []);
    return (
        <div
            className="an-row-menu"
            ref={ref}
            role="group"
            aria-label={words.menu(turn)}
            onKeyDown={(event) => {
                if (event.key !== `Escape`) return;
                event.preventDefault();
                event.stopPropagation();
                onClose();
            }}
        >
            {promote === null ? null : (
                <button type="button" className="btn btn-ghost btn-sm" onClick={promote}>
                    {words.promote}
                </button>
            )}
            {remove === null ? null : (
                <button type="button" className="btn btn-ghost btn-sm" onClick={remove}>
                    {words.remove}
                </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
                {words.copy}
            </button>
        </div>
    );
}
