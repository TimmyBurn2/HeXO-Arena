import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Side } from '@hexo-arena/contract';
import type { TurnCells } from '@hexo-arena/rules';
import { text } from '../text';
import { cellText } from './notation';
import { deletable, floorOf } from './state';
import { isMainLine, mainLine, nodeAt, openingTurns, rootId, type MoveTree as Tree, type NodeId } from './tree';

/** What a row's menu does to the line through its turn. */
export interface RowActions {
    readonly promote: (id: NodeId) => void;
    readonly remove: (id: NodeId) => void;
    readonly copy: (id: NodeId) => void;
}

// A press held this long on a touch screen opens a row's menu, as a right click does.
const longPressMs = 500;

/**
 * The move tree as rows, one a turn: the main line down the list, each
 * variation indented under the turn it leaves, a stored game's drawn opening
 * as one row.
 * A row's menu, from its "more" button, a right click, or a long press,
 * promotes, deletes, or copies the line through it.
 */
export function MoveTree({ tree, gameTurns, at, onGo, actions }: {
    tree: Tree;
    // A stored game's own turns, which stay in the tree; none for any other root.
    gameTurns: readonly TurnCells[];
    at: NodeId;
    onGo: (id: NodeId) => void;
    actions: RowActions;
}) {
    const [menu, setMenu] = useState<NodeId | null>(null);
    const listRef = useRef<HTMLOListElement>(null);
    const floor = floorOf(tree);
    const line = mainLine(tree);
    const opening = openingTurns(tree.root) > 0 ? line.slice(1, line.indexOf(floor) + 1) : [];
    const start = nodeAt(tree, opening.length > 0 ? floor : rootId)?.children[0];

    // A menu belongs to its turn; a turn removed takes its menu along, and
    // a new tree, whose handles start again, closes it.
    const menuShown = menu !== null && tree.nodes.has(menu) ? menu : null;
    useEffect(() => {
        setMenu(null);
    }, [tree.root]);

    // The current row stays in view inside the tree's own scroll, never
    // scrolling the page, where the tree flows on a phone.
    useEffect(() => {
        const list = listRef.current;
        const host = list?.parentElement;
        const row = list?.querySelector<HTMLElement>(`[aria-current="step"]`);
        if (host === null || host === undefined || row === null || row === undefined || host.scrollHeight <= host.clientHeight) return;
        const top = row.getBoundingClientRect().top - host.getBoundingClientRect().top;
        if (top < 0) host.scrollTop += top;
        else if (top + row.offsetHeight > host.clientHeight) host.scrollTop += top + row.offsetHeight - host.clientHeight;
    }, [at, tree]);

    const rowsOf = (first: NodeId | undefined): ReactNode[] => {
        const rows: ReactNode[] = [];
        for (let id = first; id !== undefined; ) {
            const node = nodeAt(tree, id);
            if (node?.kind !== `turn`) break;
            const nodeId = id;
            rows.push(
                <Row
                    key={nodeId}
                    id={nodeId}
                    turn={node.turn}
                    move={moveText(node.side, node.cells)}
                    current={nodeId === at}
                    menuOpen={menuShown === nodeId}
                    onGo={onGo}
                    onMenu={setMenu}
                />,
            );
            if (menuShown === nodeId) {
                rows.push(
                    <RowMenu
                        key={`menu-${String(nodeId)}`}
                        turn={node.turn}
                        promote={isMainLine(tree, nodeId) ? null : () => {
                            setMenu(null);
                            actions.promote(nodeId);
                        }}
                        remove={deletable(tree, gameTurns, nodeId) ? () => {
                            setMenu(null);
                            actions.remove(nodeId);
                        } : null}
                        copy={() => {
                            setMenu(null);
                            actions.copy(nodeId);
                        }}
                        onClose={() => {
                            setMenu(null);
                            listRef.current?.querySelector<HTMLElement>(`[data-node="${String(nodeId)}"] .an-row-go`)?.focus();
                        }}
                    />,
                );
            }
            const siblings = nodeAt(tree, node.parent)?.children ?? [];
            if (siblings[0] === nodeId && siblings.length > 1) {
                rows.push(
                    <li key={`var-${String(nodeId)}`} className="an-var">
                        {siblings.slice(1).map((variation) => (
                            <ol key={variation} className="an-line">
                                {rowsOf(variation)}
                            </ol>
                        ))}
                    </li>,
                );
            }
            id = node.children[0];
        }
        return rows;
    };

    return (
        <ol className="an-tree" ref={listRef} aria-label={text.analysis.tree.label}>
            {opening.length > 0 ? (
                <OpeningRow tree={tree} ids={opening} current={at === floor} onGo={onGo} floor={floor} />
            ) : null}
            {rowsOf(start)}
        </ol>
    );
}

function moveText(side: Side, cells: TurnCells): string {
    return `${side}: ${cells.map(cellText).join(` `)}`;
}

// The drawn opening reads as one row, the origin and each drawn turn, as the game's own feed shows it.
function OpeningRow({ tree, ids, floor, current, onGo }: { tree: Tree; ids: readonly NodeId[]; floor: NodeId; current: boolean; onGo: (id: NodeId) => void }) {
    const last = ids.length;
    const groups = [`x: ${cellText({ x: 0, y: 0 })}`, ...ids.flatMap((id) => {
        const node = nodeAt(tree, id);
        return node?.kind === `turn` ? [moveText(node.side, node.cells)] : [];
    })];
    return (
        <li className={`an-row an-opening${current ? ` current` : ``}`} aria-current={current ? `step` : undefined}>
            <button
                type="button"
                className="an-row-go"
                onClick={() => {
                    onGo(floor);
                }}
            >
                <span className="feed-n">
                    <span aria-hidden="true">{text.analysis.tree.opening(last)}</span>
                    <span className="sr-only">{`${text.analysis.tree.openingSpoken(last)},`}</span>
                </span>
                <span className="an-move">
                    {groups.map((group) => (
                        <span key={group} className="feed-group">
                            {group}
                        </span>
                    ))}
                </span>
            </button>
        </li>
    );
}

const Row = memo(function Row({ id, turn, move, current, menuOpen, onGo, onMenu }: {
    id: NodeId;
    turn: number;
    move: string;
    current: boolean;
    menuOpen: boolean;
    onGo: (id: NodeId) => void;
    onMenu: (id: NodeId | null) => void;
}) {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const held = useRef(false);

    function release() {
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = null;
    }

    return (
        <li
            className={`an-row${current ? ` current` : ``}`}
            aria-current={current ? `step` : undefined}
            data-node={id}
            onContextMenu={(event) => {
                event.preventDefault();
                onMenu(id);
            }}
        >
            <button
                type="button"
                className="an-row-go"
                onPointerDown={(event) => {
                    held.current = false;
                    if (event.pointerType !== `touch`) return;
                    timer.current = setTimeout(() => {
                        held.current = true;
                        onMenu(id);
                    }, longPressMs);
                }}
                onPointerUp={release}
                onPointerLeave={release}
                onPointerCancel={release}
                onClick={() => {
                    // A long press opened the menu; its release goes nowhere.
                    if (held.current) {
                        held.current = false;
                        return;
                    }
                    onGo(id);
                }}
            >
                <span className="feed-n">{String(turn)}</span>
                <span className="an-move">{move}</span>
            </button>
            {current || menuOpen ? (
                <button
                    type="button"
                    className="an-row-more"
                    aria-label={text.analysis.tree.more(turn)}
                    aria-expanded={menuOpen}
                    onClick={() => {
                        onMenu(menuOpen ? null : id);
                    }}
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M6 12h.01M12 12h.01M18 12h.01" />
                    </svg>
                </button>
            ) : null}
        </li>
    );
});

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
    // The list item stays a plain item of the list; the group inside it holds the actions.
    return (
        <li>
            <div
                className="an-row-menu"
                ref={ref}
                role="group"
                aria-label={text.analysis.tree.menu(turn)}
                onKeyDown={(event) => {
                    if (event.key !== `Escape`) return;
                    event.preventDefault();
                    event.stopPropagation();
                    onClose();
                }}
            >
                {promote === null ? null : (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={promote}>
                        {text.analysis.tree.promote}
                    </button>
                )}
                {remove === null ? null : (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={remove}>
                        {text.analysis.tree.remove}
                    </button>
                )}
                <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
                    {text.analysis.tree.copy}
                </button>
            </div>
        </li>
    );
}
