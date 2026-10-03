import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { BoardToggles } from '../board/BoardToggles';
import { SiteLinks } from '../components/SiteLinks';
import { useLegalLinks } from '../legal/links';
import { Link } from '../router/Link';
import { siteLinks } from '../site-links';
import { text } from '../text';
import { JudgmentChip } from '../analysis/Judgment';
import type { Drawer, DrawerTab } from './use-drawer';
import type { FeedFold, FeedNote } from './drawer-reading';
import type { FeedLine } from './snapshot-views';
import type { Sent } from './use-game';
import { useWait, WaitText } from '../components/wait';

const tabs: readonly { id: DrawerTab; label: string }[] = [
    { id: `moves`, label: text.drawer.moves },
    { id: `game`, label: text.drawer.game },
];

/**
 * Everything secondary to the board: the move feed with its two reading
 * aids, the game's facts and actions, and the site's standing links; the
 * look itself lives behind the settings gear, outside any game.
 * A right-hand drawer on wide screens, a bottom sheet on phones whose peek
 * keeps the player's own chip in reach.
 */
export function GameDrawer({ drawer, feed, current, notes, folds, onLine, onPoint, head, facts, meetings, rundown, tournament, analysis, running, timed, onResign, peek }: {
    drawer: Drawer;
    feed: readonly FeedLine[];
    // The feed line the board shows; a replay may stand before the newest.
    current: number;
    // A finished game's reading of each feed line, null where it has none, or null for no reading.
    notes: readonly (FeedNote | null)[] | null;
    // A reading's runs of marked turns, each folded after its first line.
    folds: readonly FeedFold[];
    // Shows the board at a feed line's turn; null while the game runs.
    onLine: ((index: number) => void) | null;
    // The feed line pointed at, or the line shown while focused; null once none is.
    onPoint: (index: number | null) => void;
    // A finished game's analysis head, which takes the board switches' place; null while it runs.
    head: ReactNode;
    facts: readonly (readonly [string, string])[];
    // The two players' record against each other, leading to their games; null before it is known or when they have none.
    meetings: ReactNode;
    // The pre-game rundown, kept on the Game tab while the game runs; null otherwise.
    rundown: ReactNode;
    // The tournament game's place, leading to its tournament; null for any other game.
    tournament: ReactNode;
    // Where a finished game opens on the analysis board, at the turn on screen; null while it runs.
    analysis: string | null;
    running: boolean;
    // Whether a clock runs down while nobody moves, as unlimited games have none.
    timed: boolean;
    // Null for a watcher, whose Game tab carries no play keys and no resign.
    onResign: (() => Promise<Sent>) | null;
    peek: ReactNode;
}) {
    const legalLinks = useLegalLinks();
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
            aria-label={text.drawer.panel}
            onKeyDown={handleKey}
        >
            {/* the whole peek answers a tap; the handle is its labelled button */}
            <div className="sheet-peek" onClick={drawer.toggle}>
                <button
                    type="button"
                    className="sheet-handle"
                    aria-expanded={drawer.visible}
                    aria-controls="drawer-body"
                    aria-label={drawer.visible ? text.drawer.close : text.drawer.open}
                    onClick={(event) => {
                        event.stopPropagation();
                        drawer.toggle();
                    }}
                />
                {peek}
            </div>
            <div className="drawer-body" id="drawer-body" ref={bodyRef} hidden={!drawer.visible}>
                <div className="drawer-head">
                    <div className="drawer-tabs" role="tablist" aria-label={text.drawer.panel}>
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
                            {drawer.pinned ? text.drawer.unpin : text.drawer.pin}
                        </button>
                    ) : null}
                    {drawer.pinned ? null : (
                        <button type="button" className="drawer-close" aria-label={text.drawer.close} onClick={drawer.hide}>
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M6 6l12 12M18 6L6 18" />
                            </svg>
                        </button>
                    )}
                </div>
                {/* keyed by its tab, so each tab opens at its own top */}
                <div
                    key={drawer.tab}
                    className="drawer-panel"
                    role="tabpanel"
                    tabIndex={0}
                    id={`drawer-panel-${drawer.tab}`}
                    aria-labelledby={`drawer-tab-${drawer.tab}`}
                    data-tab={drawer.tab}
                >
                    {drawer.tab === `moves` ? (
                        <>
                            {/* the aids read the record, so they head it and
                                stay in view as the feed scrolls under them */}
                            <div className={head === null ? `moves-head` : `moves-head dr-head`}>{head ?? <BoardToggles />}</div>
                            <MoveFeed feed={feed} current={current} visible={drawer.visible} notes={notes} folds={folds} onLine={onLine} onPoint={onPoint} />
                        </>
                    ) : null}
                    {drawer.tab === `game` ? (
                        <>
                            {rundown}
                            <GameFacts facts={facts} meetings={meetings} tournament={tournament} analysis={analysis} running={running} timed={timed} onResign={onResign} />
                        </>
                    ) : null}
                </div>
                {/* under either tab, so a standing link is the drawer and one
                    press away from the board */}
                <div className="drawer-foot">
                    <SiteLinks links={siteLinks} open="new-tab" />
                    <SiteLinks links={legalLinks} open="new-tab" className="legal-links" />
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
            <span className="sr-only">{text.drawer.spokenLabel(line.spoken)}</span>
        </>
    );
}

// The record, newest at the bottom; lines added after first render rise in.
// The line the board shows is marked, and in a replay the lines after it
// dim, since they have not happened on the board.
// The panel around the list is what scrolls, and a hidden panel has no
// height, so it follows the newest line, or the line shown in a replay,
// on every turn, every step, and every open.
// With a reading each line adds its mark and its value after the turn; a
// press on a line shows its turn, and the line shown, while pointed at or
// focused, shows the analyzer's other lines on the board.
function MoveFeed({ feed, current, visible, notes, folds, onLine, onPoint }: {
    feed: readonly FeedLine[];
    current: number;
    visible: boolean;
    notes: readonly (FeedNote | null)[] | null;
    folds: readonly FeedFold[];
    onLine: ((index: number) => void) | null;
    onPoint: (index: number | null) => void;
}) {
    const listRef = useRef<HTMLOListElement>(null);
    const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
    // A fold stays open while the line shown lies inside it.
    const foldAt = new Map(folds.map((fold) => [fold.first, { fold, open: opened.has(fold.first) || (current > fold.first && current <= fold.last) }]));
    const shut = (index: number) => folds.some((fold) => index > fold.first && index <= fold.last && foldAt.get(fold.first)?.open !== true);
    const settled = useRef(feed.length);
    const newest = current >= feed.length - 1;
    // A reading lands after the feed, growing the head and adding the note.
    const annotated = notes !== null;
    const noted = notes?.[current]?.note ?? null;

    useEffect(() => {
        const panel = listRef.current?.closest(`.drawer-panel`);
        if (!visible || !(panel instanceof HTMLElement)) return;
        const note = listRef.current?.querySelector(`.feed-note`) ?? null;
        if (newest && note === null) {
            panel.scrollTop = panel.scrollHeight;
            return;
        }
        const shown = listRef.current?.querySelector(`[aria-current="step"]`) ?? null;
        if (shown !== null) reveal(panel, shown, note ?? shown);
    }, [feed.length, visible, current, newest, annotated, noted]);

    return (
        <ol className="feed" ref={listRef} data-notes={notes === null ? undefined : ``}>
            {feed.map((line, index) => {
                if (shut(index)) return null;
                const note = notes?.[index] ?? null;
                const shown = index === current;
                const folded = foldAt.get(index);
                // Only the line shown has more to show, so only it takes the keyboard.
                const focusable = shown && note?.more === true;
                return (
                    <Fragment key={`${line.label}-${line.groups.join(` `)}`}>
                        <li
                            className={`feed-line${index === 0 ? ` feed-opening` : ``}${shown ? ` latest` : ``}${index > current ? ` ahead` : ``}${index >= settled.current ? ` fresh` : ``}`}
                            aria-current={shown ? `step` : undefined}
                            tabIndex={focusable ? 0 : undefined}
                            onClick={
                                onLine === null
                                    ? undefined
                                    : () => {
                                          onLine(index);
                                      }
                            }
                            onPointerEnter={
                                notes === null
                                    ? undefined
                                    : () => {
                                          onPoint(index);
                                      }
                            }
                            onPointerLeave={
                                notes === null
                                    ? undefined
                                    : () => {
                                          onPoint(null);
                                      }
                            }
                            onFocus={
                                focusable
                                    ? () => {
                                          onPoint(index);
                                      }
                                    : undefined
                            }
                            onBlur={
                                focusable
                                    ? () => {
                                          onPoint(null);
                                      }
                                    : undefined
                            }
                        >
                            <span className="feed-n">
                                <FeedLabel line={line} />
                            </span>
                            <span className="feed-groups">
                                {line.groups.map((group, index) => (
                                    <Fragment key={group}>
                                        {index > 0 ? ` ` : null}
                                        <span className="feed-group">{group}</span>
                                    </Fragment>
                                ))}
                            </span>
                            {/* The opening is never read or judged, so its stones take the mark's and the value's room. */}
                            {notes === null || index === 0 ? null : (
                                <>
                                    <span className="feed-mark">{note === null || note.severity === null ? null : <JudgmentChip severity={note.severity} />}</span>
                                    <span className="feed-value">{note === null || note.value === null ? null : text.drawer.reading.value(note.value)}</span>
                                </>
                            )}
                        </li>
                        {shown && note !== null && note.note !== null ? (
                            <li className="feed-note">
                                <span className="feed-note-text">{note.note}</span>
                            </li>
                        ) : null}
                        {folded === undefined ? null : (
                            <li className="feed-fold">
                                <button
                                    type="button"
                                    className="feed-fold-go"
                                    aria-expanded={folded.open}
                                    onClick={() => {
                                        setOpened((was) => {
                                            const next = new Set(was);
                                            if (next.has(index)) next.delete(index);
                                            else next.add(index);
                                            return next;
                                        });
                                    }}
                                >
                                    <span className="feed-fold-title">{folded.fold.title}</span>
                                    <span className="feed-fold-text">{folded.fold.text}</span>
                                </button>
                            </li>
                        )}
                    </Fragment>
                );
            })}
        </ol>
    );
}

// Brings a run of lines into the part of the panel its sticky head leaves
// clear, the first line winning where the run is taller than that part.
function reveal(panel: HTMLElement, first: Element, last: Element): void {
    const head = panel.querySelector(`.moves-head`);
    const area = panel.getBoundingClientRect();
    const top = head !== null && getComputedStyle(head).position === `sticky` ? head.getBoundingClientRect().bottom : area.top;
    const below = last.getBoundingClientRect().bottom - area.bottom;
    if (below > 0) panel.scrollTop += below;
    const above = top - first.getBoundingClientRect().top;
    if (above > 0) panel.scrollTop -= above;
}

function key(name: string) {
    return <kbd>{name}</kbd>;
}

function GameFacts({ facts, meetings, tournament, analysis, running, timed, onResign }: {
    facts: readonly (readonly [string, string])[];
    meetings: ReactNode;
    tournament: ReactNode;
    analysis: string | null;
    running: boolean;
    timed: boolean;
    onResign: (() => Promise<Sent>) | null;
}) {
    const [armed, setArmed] = useState(false);
    const [resigning, setResigning] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const limited = useWait();
    const waiting = limited.wait !== null;
    const failureRef = useRef<HTMLParagraphElement>(null);
    // On a phone the panel ends above the line, so the line is brought into view.
    useEffect(() => {
        if (failure !== null || waiting) failureRef.current?.scrollIntoView({ block: `nearest` });
    }, [failure, waiting]);

    const playing = running && onResign !== null;

    async function resign() {
        if (onResign === null) return;
        if (!armed) {
            setArmed(true);
            return;
        }
        setResigning(true);
        const sent = await onResign();
        setFailure(sent.kind === `failed` ? text.drawer.resignFailed : null);
        if (sent.kind === `limited`) limited.start(sent.seconds);
        setResigning(false);
        setArmed(false);
    }

    return (
        <div className="game-facts">
            <dl className="facts">
                {tournament === null ? null : (
                    <div className="facts-row">
                        <dt>{text.drawer.tournament}</dt>
                        <dd>{tournament}</dd>
                    </div>
                )}
                {facts.map(([term, value]) => (
                    <div key={term} className="facts-row">
                        <dt>{term}</dt>
                        <dd>{value}</dd>
                    </div>
                ))}
                {meetings === null ? null : (
                    <div className="facts-row">
                        <dt>{text.drawer.headToHead}</dt>
                        <dd>{meetings}</dd>
                    </div>
                )}
            </dl>
            {playing ? <p className="note">{text.drawer.keys(key)}</p> : null}
            {onResign === null ? <p className="note">{text.drawer.watchKeys(key)}</p> : null}
            <div className="card-actions">
                <Link to="/" className="btn btn-ghost">
                    {text.drawer.leave}
                </Link>
                {analysis === null ? null : (
                    <Link to={analysis} className="btn btn-ghost">
                        {text.game.openInAnalysis}
                    </Link>
                )}
                {playing ? (
                    // Held, not disabled, through the request and the wait, so focus stays on it.
                    <button
                        type="button"
                        className="btn btn-danger"
                        aria-disabled={resigning || waiting ? `true` : undefined}
                        onClick={() => {
                            if (!resigning && !waiting) void resign();
                        }}
                    >
                        {armed ? text.drawer.confirmResign : text.drawer.resign}
                    </button>
                ) : null}
            </div>
            {playing && (failure !== null || limited.wait !== null) ? (
                <p ref={failureRef} className="hud-note" role="alert">
                    {limited.wait === null ? failure : <WaitText wait={limited.wait} line={text.states.tooMany} />}
                </p>
            ) : null}
            {/* the exit is where a seated player worries about the game */}
            {playing && timed ? <p className="note">{text.drawer.leaveNote}</p> : null}
        </div>
    );
}
