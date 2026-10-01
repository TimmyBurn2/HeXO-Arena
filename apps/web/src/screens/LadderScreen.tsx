import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { nameKeyOf, nameMaxLength, type BotListing, type LeaderboardEntry, type UserMe } from '@hexo-arena/contract';
import { fetchBots, fetchLeaderboard, type LeaderboardActive, type LeaderboardKind } from '../api/client';
import { useAsync } from '../api/use-async';
import { BotBadge, PlayerName, PresenceDot, Rating } from '../components/player';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { LadderHead } from '../ladder/LadderHead';
import { Podium, PodiumSkeleton } from '../ladder/Podium';
import { useMe } from '../me';
import { Link } from '../router/Link';
import { navigate, useSearch } from '../router/use-route';
import { text } from '../text';
import './LadderScreen.css';

const kinds: readonly { value: LeaderboardKind; label: string }[] = [
    { value: `all`, label: text.ladder.kinds.all },
    { value: `bots`, label: text.ladder.kinds.bots },
    { value: `humans`, label: text.ladder.kinds.humans },
];

const windows: readonly LeaderboardActive[] = [`30d`, `all`];

interface LadderView {
    readonly kind: LeaderboardKind;
    readonly active: LeaderboardActive;
}

// The board an address names; a value the board does not take reads as its default.
function viewOf(search: string): LadderView {
    const params = new URLSearchParams(search);
    const kind = kinds.find((entry) => entry.value === params.get(`kind`))?.value ?? `all`;
    const active = windows.find((value) => value === params.get(`active`)) ?? `30d`;
    return { kind, active };
}

function pathOf(view: LadderView): string {
    const params = new URLSearchParams();
    if (view.kind !== `all`) params.set(`kind`, view.kind);
    if (view.active !== `30d`) params.set(`active`, view.active);
    return params.size === 0 ? `/ladder` : `/ladder?${params.toString()}`;
}

/** The ladder: its filters in the address, the podium, the reader's own place, and the whole board. */
export function LadderScreen() {
    const search = useSearch();
    const view = useMemo(() => viewOf(search), [search]);
    const [find, setFind] = useState(``);
    return (
        <>
            <LadderHead view="ladder" title={text.ladder.title}>
                <p className="note">{text.ladder.lead}</p>
            </LadderHead>
            <div className="ladder-filters">
                <div className="pills" role="group" aria-label={text.ladder.kindFilter}>
                    {kinds.map((entry) => (
                        <button
                            key={entry.value}
                            type="button"
                            className={`pill${view.kind === entry.value ? ` active` : ``}`}
                            aria-pressed={view.kind === entry.value}
                            onClick={() => {
                                navigate(pathOf({ ...view, kind: entry.value }));
                            }}
                        >
                            {entry.label}
                        </button>
                    ))}
                </div>
                <div className="ladder-field">
                    <label htmlFor="ladder-played">{text.ladder.played}</label>
                    <select
                        id="ladder-played"
                        value={view.active}
                        onChange={(event) => {
                            navigate(pathOf({ ...view, active: windows.find((value) => value === event.target.value) ?? `30d` }));
                        }}
                    >
                        {windows.map((value) => (
                            <option key={value} value={value}>
                                {text.ladder.playedWithin[value]}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="ladder-field ladder-find">
                    <label htmlFor="ladder-find">{text.ladder.find}</label>
                    <input
                        id="ladder-find"
                        type="text"
                        value={find}
                        maxLength={nameMaxLength}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(event) => {
                            setFind(event.target.value);
                        }}
                    />
                </div>
            </div>
            <Standings
                key={`${view.kind} ${view.active}`}
                view={view}
                find={find}
                onClearFind={() => {
                    setFind(``);
                }}
            />
        </>
    );
}

function Standings({ view, find, onClearFind }: { view: LadderView; find: string; onClearFind: () => void }) {
    const load = useCallback(async () => fetchLeaderboard(view.kind, view.active), [view]);
    const { data, error, limited, loading, reload } = useAsync(load);
    const me = useMe();
    const loadBots = useCallback(async () => fetchBots(false), []);
    const roster = useAsync(loadBots).data;
    const [showing, setShowing] = useState(false);

    // Show my row clears the search first, so the row is there to reach.
    useLayoutEffect(() => {
        if (!showing || find !== ``) return;
        setShowing(false);
        const row = document.getElementById(`ladder-you`);
        row?.scrollIntoView({ block: `center` });
        row?.focus({ preventScroll: true });
    }, [showing, find]);

    if (loading && data === null) return <LadderSkeleton kind={view.kind} />;
    if (error && data === null) return <ErrorFrame sentence={text.ladder.failed} onRetry={reload} wait={limited} />;
    if (data === null) return null;
    if (data.length === 0) return view.active === `30d` ? <EmptyMonth kind={view.kind} /> : <DayOneEmpty />;

    const self = me.status === `ready` && me.me?.kind === `user` ? me.me : null;
    const selfKey = self === null ? null : nameKeyOf(self.name);
    const query = find.trim().toLowerCase();
    const rows = query === `` ? data : data.filter((entry) => entry.name.toLowerCase().includes(query));
    return (
        <>
            <Pulse ranked={data.length} kind={view.kind} roster={roster} />
            <Podium entries={data} roster={roster} />
            {self === null ? null : (
                <YourPlace
                    self={self}
                    entry={data.find((entry) => nameKeyOf(entry.name) === selfKey)}
                    onShow={() => {
                        onClearFind();
                        setShowing(true);
                    }}
                />
            )}
            <h2 className="section-title">{text.ladder.full}</h2>
            <p className="sr-only" role="status">
                {query === `` ? null : text.ladder.findCount(rows.length, find.trim())}
            </p>
            <div className="table-wrap">
                <table className="ladder-table">
                    <thead>
                        <tr>
                            <th className="num rank-col" scope="col">
                                {text.ladder.rank}
                            </th>
                            <th scope="col">{text.ladder.player}</th>
                            <th className="num" scope="col">
                                {text.ladder.rating}
                            </th>
                            <th className="num ladder-games" scope="col">
                                {text.ladder.games}
                            </th>
                            <th className="ladder-when" scope="col">
                                {text.ladder.lastPlayed}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((entry) => (
                            <Row key={entry.name} entry={entry} you={nameKeyOf(entry.name) === selfKey} found={query !== `` && entry.name.toLowerCase() === query} />
                        ))}
                        {rows.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="table-note">
                                    {text.ladder.findNone(find.trim())}
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>
            {error ? <ErrorFrame sentence={text.ladder.failed} onRetry={reload} wait={limited} /> : null}
        </>
    );
}

function Row({ entry, you, found }: { entry: LeaderboardEntry; you: boolean; found: boolean }) {
    const ago = Math.max(0, Math.floor((Date.now() - Date.parse(entry.lastPlayedAt)) / 1000));
    const marks = [you ? `you` : ``, found ? `found` : ``].filter((mark) => mark !== ``).join(` `);
    return (
        <tr className={marks === `` ? undefined : marks} {...(you ? { id: `ladder-you`, tabIndex: -1 } : {})}>
            <td className="num rank-col">{String(entry.rank)}</td>
            <td>
                <span className="player-cell">
                    {entry.kind === `bot` ? <PresenceDot online={entry.online} /> : null}
                    <PlayerName name={entry.name} kind={entry.kind} />
                    {entry.kind === `bot` ? <BotBadge /> : null}
                    {entry.kind === `bot` && entry.ownerName !== null ? <span className="ladder-owner">{text.ladder.byOwner(entry.ownerName)}</span> : null}
                    {you ? <span className="you-tag">{text.ladder.you}</span> : null}
                </span>
            </td>
            <td className="num rating-cell">
                <Rating value={entry.rating} provisional={false} />
            </td>
            <td className="num ladder-games">{String(entry.games)}</td>
            <td className="ladder-when">
                <time dateTime={entry.lastPlayedAt} title={entry.lastPlayedAt.replace(`T`, ` `).replace(`Z`, ` UTC`)}>
                    {text.time.ago(ago)}
                </time>
            </td>
        </tr>
    );
}

// The signed-in reader's place: where they stand, with the way to their
// row, or that their rating is still settling.
function YourPlace({ self, entry, onShow }: { self: UserMe; entry: LeaderboardEntry | undefined; onShow: () => void }) {
    if (self.provisional) return <p className="ladder-you">{text.ladder.settling}</p>;
    if (entry === undefined) return null;
    return (
        <p className="ladder-you">
            <span>{text.ladder.yourPlace(entry.rank, entry.rating)}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onShow}>
                {text.ladder.showMine}
            </button>
        </p>
    );
}

/**
 * One sentence of live counts; the roster half drops out quietly when the
 * directory did not load, since the ladder stands on its own.
 */
function Pulse({ ranked, kind, roster }: { ranked: number; kind: LeaderboardKind; roster: BotListing[] | null }) {
    const online = roster?.filter((bot) => bot.online).length;
    const open = roster?.filter((bot) => bot.online && bot.openForChallenges).length;
    return (
        <p className="pulse">
            {text.ladder.pulse(
                ranked,
                kind,
                online === undefined || open === undefined ? null : { online, open },
                strong,
                <span className="dot" aria-hidden="true" />,
            )}
        </p>
    );
}

function strong(words: string) {
    return <strong>{words}</strong>;
}

// The ladder's own shape while it loads: the counts line, the podium, a
// signed-in reader's place, and the heading over the rows, so nothing
// above the rows moves when they land.
function LadderSkeleton({ kind }: { kind: LeaderboardKind }) {
    const me = useMe();
    const signedIn = me.status === `ready` && me.me?.kind === `user`;
    return (
        <div className="ladder-skeleton" aria-hidden="true">
            <p className="pulse">
                <span className="skeleton pulse-skeleton" />
            </p>
            <PodiumSkeleton play={kind !== `humans`} />
            {signedIn ? (
                <p className="ladder-you">
                    <span className="skeleton you-skeleton" />
                </p>
            ) : null}
            <h2 className="section-title">{text.ladder.full}</h2>
            <SkeletonRows />
        </div>
    );
}

function DayOneEmpty() {
    return (
        <div className="empty">
            <h2>{text.ladder.empty.heading}</h2>
            <p>{text.ladder.empty.body}</p>
            <div className="actions">
                <Link to="/connect" className="btn btn-primary">
                    {text.ladder.empty.build}
                </Link>
                <Link to="/bots" className="btn btn-ghost">
                    {text.ladder.empty.browse}
                </Link>
            </div>
        </div>
    );
}

// A month without a ranked game is day one only if the all-time ladder is empty too.
function EmptyMonth({ kind }: { kind: LeaderboardKind }) {
    const load = useCallback(async () => fetchLeaderboard(kind, `all`), [kind]);
    const { data, error, limited, reload } = useAsync(load);
    if (data === null && !error) return <LadderSkeleton kind={kind} />;
    if (data === null) return <ErrorFrame sentence={text.ladder.failed} onRetry={reload} wait={limited} />;
    return data.length === 0 ? <DayOneEmpty /> : <QuietEmpty kind={kind} />;
}

function QuietEmpty({ kind }: { kind: LeaderboardKind }) {
    return (
        <div className="empty">
            <h2>{text.ladder.quiet.heading}</h2>
            <p>{text.ladder.quiet.body}</p>
            <div className="actions">
                <Link to={pathOf({ kind, active: `all` })} className="btn btn-primary">
                    {text.ladder.quiet.all}
                </Link>
            </div>
        </div>
    );
}
