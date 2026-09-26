import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { LookControls } from '../board/LookControls';
import { Link } from '../router/Link';
import type { Drawer, DrawerTab } from './use-drawer';
import type { FeedLine } from './snapshot-views';

const tabs: readonly { id: DrawerTab; label: string }[] = [
    { id: `moves`, label: `Moves` },
    { id: `board`, label: `Board` },
    { id: `game`, label: `Game` },
];

/**
 * Everything secondary to the board: the move feed, the look, and the
 * game's facts and actions.
 * A right-hand drawer on wide screens, a bottom sheet on phones whose peek
 * keeps the player's own chip in reach.
 */
export function GameDrawer({ drawer, feed, facts, running, onResign, peek }: {
    drawer: Drawer;
    feed: readonly FeedLine[];
    facts: readonly (readonly [string, string])[];
    running: boolean;
    // Null for a watcher, whose Game tab carries no play keys and no resign.
    onResign: (() => Promise<boolean>) | null;
    peek: ReactNode;
}) {
    const bodyRef = useRef<HTMLDivElement>(null);
    const wasVisible = useRef(drawer.visible);

    // Opening by hand moves focus into the drawer; the pin and the hover
    // edge leave it where it was.
    // Closing hands focus back to the toggle, or the board when the toggle
    // is hidden, rather than to nowhere.
    useEffect(() => {
        if (drawer.visible && !wasVisible.current && !drawer.pinned && drawer.openedBy === `hand`) {
            bodyRef.current?.querySelector<HTMLElement>(`[role="tab"][aria-selected="true"]`)?.focus();
        }
        if (!drawer.visible && wasVisible.current && bodyRef.current?.parentElement?.contains(document.activeElement)) {
            const toggle = document.getElementById(`drawer-toggle`);
            const target = toggle !== null && toggle.offsetParent !== null ? toggle : document.querySelector<HTMLElement>(`.board-control`);
            target?.focus({ preventScroll: true });
        }
        wasVisible.current = drawer.visible;
    }, [drawer.visible, drawer.pinned, drawer.openedBy]);

    function handleKey(event: React.KeyboardEvent<HTMLElement>) {
        if (event.key === `Escape` && !drawer.pinned) {
            event.stopPropagation();
            drawer.hide();
            return;
        }
        if ((event.key === `ArrowRight` || event.key === `ArrowLeft`) && event.target instanceof HTMLElement && event.target.getAttribute(`role`) === `tab`) {
            const index = tabs.findIndex((tab) => tab.id === drawer.tab);
            const next = tabs[(index + (event.key === `ArrowRight` ? 1 : tabs.length - 1)) % tabs.length];
            if (next === undefined) return;
            drawer.choose(next.id);
            bodyRef.current?.querySelector<HTMLElement>(`#drawer-tab-${next.id}`)?.focus();
        }
    }

    return (
        <aside
            id="game-drawer"
            className="drawer"
            data-visible={drawer.visible ? `` : undefined}
            aria-label="Game panel"
            onKeyDown={handleKey}
        >
            {/* the whole peek answers a tap; the handle is its labelled button */}
            <div className="sheet-peek" onClick={drawer.toggle}>
                <button
                    type="button"
                    className="sheet-handle"
                    aria-expanded={drawer.visible}
                    aria-controls="drawer-body"
                    aria-label={drawer.visible ? `Close the game panel` : `Open the game panel`}
                    onClick={(event) => {
                        event.stopPropagation();
                        drawer.toggle();
                    }}
                />
                {peek}
            </div>
            <div className="drawer-body" id="drawer-body" ref={bodyRef} hidden={!drawer.visible}>
                <div className="drawer-head">
                    <div className="drawer-tabs" role="tablist" aria-label="Game panel">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                id={`drawer-tab-${tab.id}`}
                                type="button"
                                role="tab"
                                className="drawer-tab"
                                aria-selected={drawer.tab === tab.id}
                                aria-controls={drawer.tab === tab.id ? `drawer-panel-${tab.id}` : undefined}
                                tabIndex={drawer.tab === tab.id ? 0 : -1}
                                onClick={() => {
                                    drawer.choose(tab.id);
                                }}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                    {drawer.pinnable ? (
                        <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            aria-pressed={drawer.pinned}
                            onClick={() => {
                                drawer.pin(!drawer.pinned);
                            }}
                        >
                            {drawer.pinned ? `Unpin` : `Pin`}
                        </button>
                    ) : null}
                    {drawer.pinned ? null : (
                        <button type="button" className="drawer-close" aria-label="Close the game panel" onClick={drawer.hide}>
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M6 6l12 12M18 6L6 18" />
                            </svg>
                        </button>
                    )}
                </div>
                <div
                    className="drawer-panel"
                    role="tabpanel"
                    tabIndex={0}
                    id={`drawer-panel-${drawer.tab}`}
                    aria-labelledby={`drawer-tab-${drawer.tab}`}
                >
                    {drawer.tab === `moves` ? <MoveFeed feed={feed} visible={drawer.visible} /> : null}
                    {drawer.tab === `board` ? <LookControls /> : null}
                    {drawer.tab === `game` ? <GameFacts facts={facts} running={running} onResign={onResign} /> : null}
                </div>
            </div>
        </aside>
    );
}

/**
 * A feed line's label: where the short form would read as a word, the eye
 * gets the short form and assistive tech the spoken one, with a pause
 * before the stones.
 */
export function FeedLabel({ line }: { line: FeedLine }) {
    if (line.spoken === line.label) return line.label;
    return (
        <>
            <span aria-hidden="true">{line.label}</span>
            <span className="sr-only">{`${line.spoken},`}</span>
        </>
    );
}

// The record, newest at the bottom; lines added after first render rise in.
// The panel around the list is what scrolls, and a hidden panel has no
// height, so it follows the newest line on every turn and on every open.
function MoveFeed({ feed, visible }: { feed: readonly FeedLine[]; visible: boolean }) {
    const listRef = useRef<HTMLOListElement>(null);
    const settled = useRef(feed.length);

    useEffect(() => {
        const panel = listRef.current?.closest(`.drawer-panel`);
        if (visible && panel instanceof HTMLElement) panel.scrollTop = panel.scrollHeight;
    }, [feed.length, visible]);

    return (
        <ol className="feed" ref={listRef}>
            {feed.map((line, index) => (
                <li
                    key={`${line.label}-${line.groups.join(` `)}`}
                    className={`feed-line${index === feed.length - 1 ? ` latest` : ``}${index >= settled.current ? ` fresh` : ``}`}
                >
                    <span className="feed-n">
                        <FeedLabel line={line} />
                    </span>
                    <span>
                        {line.groups.map((group, index) => (
                            <Fragment key={group}>
                                {index > 0 ? ` ` : null}
                                <span className="feed-group">{group}</span>
                            </Fragment>
                        ))}
                    </span>
                </li>
            ))}
        </ol>
    );
}

function GameFacts({ facts, running, onResign }: {
    facts: readonly (readonly [string, string])[];
    running: boolean;
    onResign: (() => Promise<boolean>) | null;
}) {
    const [armed, setArmed] = useState(false);
    const [resigning, setResigning] = useState(false);
    const [failed, setFailed] = useState(false);

    const playing = running && onResign !== null;

    async function resign() {
        if (onResign === null) return;
        if (!armed) {
            setArmed(true);
            return;
        }
        setResigning(true);
        setFailed(!(await onResign()));
        setResigning(false);
        setArmed(false);
    }

    return (
        <div className="game-facts">
            <dl className="facts">
                {facts.map(([term, value]) => (
                    <div key={term} className="facts-row">
                        <dt>{term}</dt>
                        <dd>{value}</dd>
                    </div>
                ))}
            </dl>
            {playing ? (
                <p className="note">
                    <kbd>arrows</kbd> <kbd>q</kbd> <kbd>e</kbd> walk the board, <kbd>enter</kbd> marks a
                    stone and the second mark plays the turn, <kbd>esc</kbd> clears it, <kbd>m</kbd> opens
                    this panel.
                </p>
            ) : null}
            {onResign === null ? (
                <p className="note">
                    With the board focused, <kbd>arrows</kbd> scroll it; <kbd>m</kbd> opens this panel.
                </p>
            ) : null}
            <div className="card-actions">
                <Link to="/" className="btn btn-ghost">
                    Leave to the arena
                </Link>
                {playing ? (
                    <button type="button" className="btn btn-danger" disabled={resigning} onClick={() => void resign()}>
                        {armed ? `Confirm resign` : `Resign`}
                    </button>
                ) : null}
            </div>
            {playing && failed ? (
                <p className="hud-note" role="alert">
                    The resign did not land; try again
                </p>
            ) : null}
        </div>
    );
}
