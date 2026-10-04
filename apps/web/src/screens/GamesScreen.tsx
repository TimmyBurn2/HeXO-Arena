import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import {
    finishReasonLabels,
    finishReasonSchema,
    finishedGamesPageCap,
    finishedGamesPageSize,
    nameKeyOf,
    nameMaxLength,
    type FinishedGameEntry,
    type FinishedGamesPage,
    type FinishedGamesRecord,
    type GamePlayer,
} from '@hexo-arena/contract';
import { ApiError, fetchFinishedGames, limitedFor } from '../api/client';
import { BotBadge, PlayerName } from '../components/player';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { TopbarPanel, usePanel } from '../components/TopbarPanel';
import { activeKeys, gamesPathOf, pagePathOf, searchOf, viewOf, withFilter, type FilterKey, type GameFilters, type GamesView } from '../games/filters';
import { useShowTests } from '../games/show-tests';
import { ShowTests } from '../games/ShowTests';
import { GameRows } from '../games/GameRows';
import { GamesHead } from '../games/GamesHead';
import { Link } from '../router/Link';
import { navigate, useSearch } from '../router/use-route';
import { text } from '../text';
import './GamesScreen.css';

const resultOptions = [`won`, `lost`, `none`] as const;
const sideOptions = [`x`, `o`] as const;
const clockOptions = [`turn`, `match`, `unlimited`] as const;
const kindOptions = [`bot-bot`, `human-bot`, `guest-bot`] as const;
const eventOptions = [`duel`, `tournament`, `none`] as const;
const openingOptions = [`1`, `3`, `5`, `7`, `9`] as const;

/** A list's page, a name no player holds, or a read that failed. */
type Load =
    | { kind: `loading` }
    | { kind: `ready`; page: FinishedGamesPage; view: GamesView; at: number }
    | { kind: `unknown`; name: string; kept: string | null }
    | { kind: `failed`; limited: number | null };

function queryOf(view: GamesView) {
    return { ...view.filters, ...(view.page === 1 ? {} : { page: String(view.page) }) };
}

// A refusal does not say which name no player holds, so with two set,
// the first is read alone to tell; when only the second is unknown, the
// first is kept.
async function unknownName(filters: GameFilters): Promise<Extract<Load, { kind: `unknown` }>> {
    const { player, vs } = filters;
    if (player === undefined || vs === undefined) return { kind: `unknown`, name: player ?? vs ?? ``, kept: null };
    try {
        await fetchFinishedGames({ player });
        return { kind: `unknown`, name: vs, kept: player };
    } catch {
        return { kind: `unknown`, name: player, kept: null };
    }
}

async function loadOf(view: GamesView, tests: boolean): Promise<Load> {
    try {
        const page = await fetchFinishedGames({ ...queryOf(view), ...(tests ? { tests: `1` as const } : {}) });
        return { kind: `ready`, page, view, at: Date.now() };
    } catch (cause) {
        if (cause instanceof ApiError && cause.status === 404) return unknownName(view.filters);
        return { kind: `failed`, limited: limitedFor(cause) };
    }
}

/** The page an address names; the last one stays on screen while the next loads. */
function useGamesPage(search: string, tests: boolean): { load: Load; busy: boolean; retry: () => void } {
    const [load, setLoad] = useState<Load>({ kind: `loading` });
    const [busy, setBusy] = useState(true);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let cancelled = false;
        setBusy(true);
        void loadOf(viewOf(search), tests).then((next) => {
            if (cancelled) return;
            setLoad(next);
            setBusy(false);
        });
        return () => {
            cancelled = true;
        };
    }, [search, tests, attempt]);
    const retry = useCallback(() => {
        setAttempt((count) => count + 1);
    }, []);
    return { load, busy, retry };
}

// Every field applies as it changes, so a form's submit goes nowhere.
const keepHere = (event: SyntheticEvent) => {
    event.preventDefault();
};

/** Every finished game, newest first, narrowed by filters the address holds. */
export function GamesScreen() {
    const search = useSearch();
    const view = useMemo(() => viewOf(search), [search]);
    const [tests, setTests] = useShowTests();
    const { load, busy, retry } = useGamesPage(search, tests);
    const panel = usePanel(`games-filters`);
    const [seekBefore, setSeekBefore] = useState(false);
    const [turned, setTurned] = useState(false);
    const { filters } = view;

    // A page turned by its links takes the keyboard to its list once it lands,
    // where the window has scrolled, so the links never leave focus below the fold or on nothing.
    useLayoutEffect(() => {
        if (!turned || busy || load.kind !== `ready`) return;
        setTurned(false);
        document.querySelector<HTMLElement>(`.games-list .game-rows`)?.focus({ preventScroll: true });
    }, [turned, busy, load]);

    // A hand-made or stale address loses what the list cannot take, in place,
    // and a page past the last the filters reach becomes that last page.
    useEffect(() => {
        const clean = searchOf(view);
        if (clean !== search) {
            navigate(`/games${clean}`, { replace: true });
            return;
        }
        if (busy || load.kind !== `ready`) return;
        const last = Math.max(1, load.page.pages);
        if (load.view.page > last) navigate(pagePathOf(load.view.filters, last), { replace: true });
    }, [view, search, busy, load]);

    // Pick a date opens the filters wherever they show at this width, then puts the keyboard in Before.
    useLayoutEffect(() => {
        if (!seekBefore) return;
        const field = document.getElementById(`games-before`);
        if (field === null) return;
        setSeekBefore(false);
        field.focus();
    });

    const set = useCallback(<K extends FilterKey>(key: K, value: GameFilters[K] | undefined) => {
        navigate(withFilter(viewOf(window.location.search).filters, key, value));
    }, []);

    function pickBefore() {
        if (panel.mode === `closed`) panel.toggle();
        setSeekBefore(true);
    }

    const fields = { filters, set };
    const counted = activeKeys(filters).filter((key) => key !== `player`).length;
    return (
        <>
            <GamesHead view="finished" />
            <div className="games-search">
                <form className="games-filters" role="search" aria-label={text.games.search} onSubmit={keepHere}>
                    <PlayerField {...fields} />
                    <button
                        ref={panel.button}
                        type="button"
                        className="btn btn-ghost games-filters-button"
                        aria-haspopup="dialog"
                        aria-expanded={panel.mode !== `closed`}
                        aria-controls={panel.mode === `closed` ? undefined : `games-filters-panel`}
                        onClick={panel.toggle}
                    >
                        {text.games.filters(counted)}
                    </button>
                </form>
                <ShowTests on={tests} onChange={setTests} />
                <TopbarPanel
                    id="games-filters-panel"
                    className="games-panel"
                    control={panel}
                    labelledBy="games-panel-title"
                    head={
                        <h2 id="games-panel-title" className="games-panel-title">
                            {text.games.filters(0)}
                        </h2>
                    }
                    closeLabel={text.games.closeSheet}
                    initialFocus="input:not(:disabled), select:not(:disabled)"
                >
                    {filters.player === undefined ? <p className="note games-panel-note">{text.games.needPlayer}</p> : null}
                    <form className="games-panel-fields" onSubmit={keepHere}>
                        <FilterFields {...fields} />
                    </form>
                    <p id="games-opening-note" className="note games-panel-note">
                        {text.games.openingNote}
                    </p>
                    <div className="games-panel-foot">
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => {
                                panel.close(true);
                            }}
                        >
                            {text.games.show}
                        </button>
                    </div>
                </TopbarPanel>
            </div>
            <Chips filters={filters} />
            <p className="note games-note">
                {text.games.note} {text.games.testsNote}
            </p>
            <div aria-busy={busy}>
                <Body
                    load={load}
                    onRetry={retry}
                    onPickBefore={pickBefore}
                    onTurn={() => {
                        setTurned(true);
                    }}
                />
            </div>
        </>
    );
}

interface FieldsProps {
    filters: GameFilters;
    set: <K extends FilterKey>(key: K, value: GameFilters[K] | undefined) => void;
}

function PlayerField({ filters, set }: FieldsProps) {
    return (
        <NameField
            id="games-player"
            label={text.games.player}
            value={filters.player}
            onCommit={(name) => {
                set(`player`, name);
            }}
        />
    );
}

// Against, Side, and a won or lost result read from a player's seat, so they wait for one;
// a game without a winner needs none.
function FilterFields({ filters, set }: FieldsProps) {
    const alone = filters.player === undefined;
    const results = alone ? ([`none`] as const) : resultOptions;
    return (
        <>
            <NameField
                id="games-vs"
                label={text.games.vs}
                value={filters.vs}
                disabled={alone}
                onCommit={(name) => {
                    set(`vs`, name);
                }}
            />
            <Choice
                id="games-result"
                label={text.games.result}
                value={filters.result}
                options={results.map((value) => [value, text.games.results[value]] as const)}
                onChange={(value) => {
                    set(`result`, value);
                }}
            />
            <Choice
                id="games-side"
                label={text.games.side}
                value={filters.side}
                options={sideOptions.map((value) => [value, value] as const)}
                disabled={alone}
                onChange={(value) => {
                    set(`side`, value);
                }}
            />
            <Choice
                id="games-reason"
                label={text.games.reason}
                value={filters.reason}
                options={finishReasonSchema.options.map((value) => [value, finishReasonLabels[value]] as const)}
                onChange={(value) => {
                    set(`reason`, value);
                }}
            />
            <Choice
                id="games-clock"
                label={text.games.clock}
                value={filters.clock}
                options={clockOptions.map((value) => [value, text.games.clocks[value]] as const)}
                onChange={(value) => {
                    set(`clock`, value);
                }}
            />
            <Choice
                id="games-opening"
                label={text.games.opening}
                describedBy="games-opening-note"
                value={filters.opening}
                options={openingOptions.map((value) => [value, text.games.openingValue(Number(value))] as const)}
                onChange={(value) => {
                    set(`opening`, value);
                }}
            />
            <Choice
                id="games-kind"
                label={text.games.kind}
                value={filters.kind}
                options={kindOptions.map((value) => [value, text.games.kinds[value]] as const)}
                onChange={(value) => {
                    set(`kind`, value);
                }}
            />
            <Choice
                id="games-event"
                label={text.games.event}
                value={filters.event}
                options={eventOptions.map((value) => [value, text.games.events[value]] as const)}
                onChange={(value) => {
                    set(`event`, value);
                }}
            />
            <Choice
                id="games-analyzed"
                label={text.games.analysis}
                value={filters.analyzed}
                options={[[`1`, text.games.analyzed] as const]}
                onChange={(value) => {
                    set(`analyzed`, value);
                }}
            />
            <div className="games-field">
                <label htmlFor="games-before">{text.games.before}</label>
                <input
                    id="games-before"
                    type="date"
                    value={filters.before ?? ``}
                    onChange={(event) => {
                        // A date still being typed reads empty; only a whole one, or a cleared field, moves the list.
                        const value = event.target.value;
                        if (value === `` || event.target.validity.valid) set(`before`, value === `` ? undefined : value);
                    }}
                />
            </div>
        </>
    );
}

// A name applies on Enter or when the field is left, never mid-word.
function NameField({ id, label, value, disabled = false, onCommit }: {
    id: string;
    label: string;
    value: string | undefined;
    disabled?: boolean;
    onCommit: (name: string | undefined) => void;
}) {
    const [draft, setDraft] = useState(value ?? ``);
    const [shown, setShown] = useState(value);
    if (shown !== value) {
        setShown(value);
        setDraft(value ?? ``);
    }
    function commit() {
        const name = draft.trim();
        if (name !== (value ?? ``)) onCommit(name === `` ? undefined : name);
    }
    return (
        <div className="games-field">
            <label htmlFor={id}>{label}</label>
            <input
                id={id}
                type="text"
                value={draft}
                maxLength={nameMaxLength}
                disabled={disabled}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                    setDraft(event.target.value);
                }}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key !== `Enter`) return;
                    event.preventDefault();
                    commit();
                }}
            />
        </div>
    );
}

function Choice<V extends string>({ id, label, describedBy, value, options, disabled = false, onChange }: {
    id: string;
    label: string;
    describedBy?: string;
    value: V | undefined;
    options: readonly (readonly [V, string])[];
    disabled?: boolean;
    onChange: (value: V | undefined) => void;
}) {
    return (
        <div className="games-field">
            <label htmlFor={id}>{label}</label>
            <select
                id={id}
                value={value ?? ``}
                disabled={disabled}
                aria-describedby={describedBy}
                onChange={(event) => {
                    onChange(options.find(([option]) => option === event.target.value)?.[0]);
                }}
            >
                <option value="">{text.games.any}</option>
                {options.map(([option, words]) => (
                    <option key={option} value={option}>
                        {words}
                    </option>
                ))}
            </select>
        </div>
    );
}

/** A filter as its chip and the no-match sentence name it. */
function chipOf(key: FilterKey, filters: GameFilters): string {
    const chips = text.games.chips;
    switch (key) {
        case `player`:
            return filters.player ?? ``;
        case `vs`:
            return chips.vs(filters.vs ?? ``);
        case `result`:
            return filters.result === undefined ? `` : chips.results[filters.result];
        case `side`:
            return chips.side(filters.side ?? ``);
        case `reason`:
            return filters.reason === undefined ? `` : finishReasonLabels[filters.reason].toLowerCase();
        case `clock`:
            return filters.clock === undefined ? `` : chips.clocks[filters.clock];
        case `kind`:
            return filters.kind === undefined ? `` : chips.kinds[filters.kind];
        case `event`:
            return filters.event === undefined ? `` : chips.events[filters.event];
        case `opening`:
            return chips.opening(Number(filters.opening));
        case `analyzed`:
            return chips.analyzed;
        case `before`:
            return chips.before(filters.before ?? ``);
    }
}

// A removed chip hands the keyboard to the chip that takes its place, or
// to the player field once none is left.
function Chips({ filters }: { filters: GameFilters }) {
    const keys = activeKeys(filters);
    const group = useRef<HTMLDivElement>(null);
    const [refocus, setRefocus] = useState<number | null>(null);
    useLayoutEffect(() => {
        if (refocus === null) return;
        setRefocus(null);
        const chips = group.current?.querySelectorAll<HTMLElement>(`.chip`) ?? [];
        const next = chips[Math.min(refocus, chips.length - 1)] ?? document.getElementById(`games-player`);
        next?.focus();
    }, [refocus]);
    if (keys.length === 0) return null;
    return (
        <div className="games-chips" role="group" aria-label={text.games.chipsLabel} ref={group}>
            {keys.map((key, index) => {
                const words = chipOf(key, filters);
                return (
                    <button
                        key={key}
                        type="button"
                        className="chip"
                        aria-label={text.games.remove(words)}
                        onClick={() => {
                            navigate(withFilter(filters, key, undefined));
                            setRefocus(index);
                        }}
                    >
                        <span>{words}</span>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M7 7l10 10M17 7L7 17" />
                        </svg>
                    </button>
                );
            })}
            <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                    navigate(`/games`);
                    setRefocus(0);
                }}
            >
                {text.games.clear}
            </button>
        </div>
    );
}

function Body({ load, onRetry, onPickBefore, onTurn }: { load: Load; onRetry: () => void; onPickBefore: () => void; onTurn: () => void }) {
    switch (load.kind) {
        case `loading`:
            return <SkeletonRows />;
        case `failed`:
            return <ErrorFrame sentence={text.games.failed} onRetry={onRetry} wait={load.limited} />;
        case `unknown`:
            return (
                <div className="empty">
                    <h2>{text.games.unknown(load.name)}</h2>
                    <p>{text.games.unknownBody}</p>
                    {load.kept === null ? <ClearAction /> : <ClearAction to={gamesPathOf(load.kept)} label={text.games.gamesOf(load.kept)} />}
                </div>
            );
        case `ready`:
            return <Results page={load.page} view={load.view} now={load.at} onPickBefore={onPickBefore} onTurn={onTurn} />;
    }
}

function ClearAction({ to = `/games`, label = text.games.clear }: { to?: string; label?: string }) {
    return (
        <div className="actions">
            <Link to={to} className="btn btn-primary">
                {label}
            </Link>
        </div>
    );
}

function Results({ page, view, now, onPickBefore, onTurn }: { page: FinishedGamesPage; view: GamesView; now: number; onPickBefore: () => void; onTurn: () => void }) {
    const { filters } = view;
    const keys = activeKeys(filters);
    if (page.games.length === 0) {
        if (keys.length === 0 && page.total === 0) {
            return (
                <div className="empty">
                    <h2>{text.games.dayOne.heading}</h2>
                    <p>{text.games.dayOne.body}</p>
                    <div className="actions">
                        <Link to="/games/live" className="btn btn-primary">
                            {text.games.dayOne.watch}
                        </Link>
                        <Link to="/connect" className="btn btn-ghost">
                            {text.games.dayOne.build}
                        </Link>
                    </div>
                </div>
            );
        }
        // A page past the last one the filters reach is on its way to that page.
        if (page.total > 0) return <SkeletonRows />;
        return (
            <div className="empty">
                <h2>{text.games.noMatch.heading}</h2>
                <p>{text.games.noMatch.body(keys.map((key) => chipOf(key, view.filters)).join(`, `))}</p>
                <ClearAction />
            </div>
        );
    }
    const player = filters.player === undefined ? undefined : seatNamed(page.games, filters.player);
    const vs = filters.vs === undefined ? undefined : seatNamed(page.games, filters.vs);
    const reach = finishedGamesPageCap * finishedGamesPageSize;
    return (
        <>
            {player !== undefined && vs !== undefined && page.record !== undefined ? <HeadToHead player={player} vs={vs} record={page.record} /> : null}
            <div className="games-list">
                <GameRows games={page.games} now={now} label={text.games.listed(page.page)} />
            </div>
            <Paging page={page} filters={filters} onTurn={onTurn} />
            {page.total > reach ? (
                <p className="games-cap">
                    <span className="note">{text.games.cap(reach, page.total)}</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={onPickBefore}>
                        {text.games.pickBefore}
                    </button>
                </p>
            ) : null}
        </>
    );
}

// The seat a name sat in, under its own spelling.
function seatNamed(games: readonly FinishedGameEntry[], name: string): GamePlayer | undefined {
    const key = nameKeyOf(name);
    for (const game of games) {
        for (const seat of [game.players.x, game.players.o]) if (nameKeyOf(seat.name) === key) return seat;
    }
    return undefined;
}

function Named({ player }: { player: GamePlayer }): ReactNode {
    return (
        <span className="games-h2h-name">
            {player.kind === `guest` ? player.name : <PlayerName name={player.name} kind={player.kind === `bot` ? `bot` : `human`} />}
            {player.kind === `bot` ? <BotBadge /> : null}
        </span>
    );
}

/** The player's record against one opponent: three figures, then the split by side in a sentence. */
function HeadToHead({ player, vs, record }: { player: GamePlayer; vs: GamePlayer; record: FinishedGamesRecord }) {
    return (
        <section className="games-h2h" aria-labelledby="games-h2h-title">
            <h2 id="games-h2h-title" className="games-h2h-title">
                {text.games.against(<Named player={player} />, <Named player={vs} />)}
            </h2>
            <ul className="games-h2h-figures">
                <li>
                    <span className="games-h2h-n">{String(record.won)}</span>
                    <span className="games-h2h-label">{text.games.won(player.name)}</span>
                </li>
                <li>
                    <span className="games-h2h-n">{String(record.lost)}</span>
                    <span className="games-h2h-label">{text.games.won(vs.name)}</span>
                </li>
                <li>
                    <span className="games-h2h-n">{String(record.undecided)}</span>
                    <span className="games-h2h-label">{text.games.noWinner}</span>
                </li>
            </ul>
            <p className="games-h2h-split">
                {text.games.split(player.name, record.games, record.asX, record.asO)}
                {record.voided === 0 ? null : ` ${text.games.voidedLeftOut(record.voided)}.`}
            </p>
        </section>
    );
}

/**
 * The list's place among its pages, then a link to each page the filters
 * reach between Previous and Next; the current page is marked, not linked
 * away from, and an end's step stays in place without a link.
 */
function Paging({ page, filters, onTurn }: { page: FinishedGamesPage; filters: GameFilters; onTurn: () => void }) {
    if (page.pages <= 1) return <p className="note games-paging-line">{text.games.count(page.total)}</p>;
    const numbers = Array.from({ length: page.pages }, (_, index) => index + 1);
    const step = (to: number, words: string, rel: `prev` | `next`) =>
        to < 1 || to > page.pages ? (
            <span className="btn btn-ghost games-page-end" aria-disabled="true">
                {words}
            </span>
        ) : (
            <Link to={pagePathOf(filters, to)} className="btn btn-ghost" rel={rel} onNavigate={onTurn}>
                {words}
            </Link>
        );
    return (
        <nav className="games-paging" aria-label={text.games.paging}>
            <p className="note games-paging-line">{text.games.pageOf(page.page, page.pages, page.total)}</p>
            <div className="games-pages">
                {step(page.page - 1, text.games.previous, `prev`)}
                <ol className="games-page-numbers">
                    {numbers.map((number) => (
                        <li key={number}>
                            <Link
                                to={pagePathOf(filters, number)}
                                className="btn btn-ghost games-page-number"
                                ariaCurrent={number === page.page}
                                ariaLabel={text.games.pageLink(number)}
                                onNavigate={onTurn}
                            >
                                {String(number)}
                            </Link>
                        </li>
                    ))}
                </ol>
                {step(page.page + 1, text.games.next, `next`)}
            </div>
        </nav>
    );
}
