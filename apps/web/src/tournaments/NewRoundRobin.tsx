import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { nameKeyOf, roundRobinMaxBots, tournamentMinPresent, type BotListing, type Level, type Me, type OpeningPlies, type TimeControl, type TournamentGamesPerPair, type TournamentQuota } from '@hexo-arena/contract';
import { ApiError, createRoundRobin, limitedFor } from '../api/client';
import { DiscordSignIn } from '../components/DiscordButton';
import { DuelClock } from '../duels/DuelClock';
import { refusalReads } from '../duels/refusal';
import { GameGlyph } from '../duels/Scoreboard';
import { defaultFieldClock, takenByAll, type DuelReads } from '../duels/setup';
import { EmptySlot, FilledSlot } from '../duels/Slots';
import { OpeningRow } from '../play/OpeningRow';
import { ownedBy } from '../play/setup';
import { navigate } from '../router/use-route';
import { text } from '../text';
import {
    defaultRoundRobinOpening,
    gamesPerPairOf,
    isTest,
    joinReason,
    readRoundRobinChoices,
    roundRobinSetupPath,
    scheduleOf,
    writeRoundRobinChoices,
    clockClashes,
    type JoinReason,
    type PickedBot,
    type RoundRobinChoices,
    type RoundRobinSetup,
} from './round-robin';
import { RoundRobinPicker } from './RoundRobinPicker';
import { tournamentPagePath } from './view';
import '../screens/PlayScreen.css';
import '../duels/Duels.css';
import './RoundRobin.css';

type Outcome = { kind: `idle` } | { kind: `sending` } | { kind: `refused`; line: ReactNode; bot: string | null };

function levelOf(bot: BotListing, id: string | null): Level | null {
    if (id === null || bot.levels === null || id === bot.levels.default) return null;
    return bot.levels.list.find((level) => level.id === id) ?? null;
}

function reasonLine(bot: BotListing, reason: JoinReason, field: readonly BotListing[]): string {
    if (reason === `offline`) return text.roundRobins.gone(bot.name);
    const words = text.roundRobins.picker.reasons;
    const said = reason === `clock` ? words.clock(clockClashes(bot, field).map((each) => each.name)) : words[reason];
    return text.duels.slot.unready(bot.name, said);
}

// The next UTC midnight in the reader's own clock, as the daily cap's line names it.
function nextDayLocal(): string {
    const now = new Date();
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    return new Intl.DateTimeFormat(undefined, { timeStyle: `short` }).format(new Date(midnight));
}

/** A refusal to set a round robin up as its line, by its code, naming the bot the server names, and why where the reads tell. */
export function roundRobinRefusal(cause: unknown, why: (bot: string) => JoinReason | null, test: boolean): { line: ReactNode; bot: string | null } {
    const errors = text.roundRobins.errors;
    const wait = limitedFor(cause);
    if (wait !== null) return { line: text.states.tooMany(wait), bot: null };
    const failed = test ? errors.failedTest : errors.failed;
    if (!(cause instanceof ApiError)) return { line: failed, bot: null };
    const bot = cause.bot;
    const named = bot ?? ``;
    switch (cause.code) {
        case `round_robin_busy`:
            return { line: errors.round_robin_busy, bot: null };
        case `daily_round_robin_cap`:
            return { line: errors.daily_round_robin_cap(nextDayLocal()), bot: null };
        case `duel_refused`:
            return { line: errors.duel_refused(named), bot };
        case `not_open`:
            return { line: errors.not_open(named), bot };
        case `clock_not_accepted`:
            return { line: errors.clock_not_accepted(named), bot };
        case `unknown_level`:
            return { line: errors.unknown_level(named), bot };
        case `bot_busy`: {
            const reason = bot === null ? null : why(bot);
            return { line: reason === `busy` || reason === `events` || reason === `tournament` ? errors.busyBecause[reason](named) : errors.bot_busy(named), bot };
        }
        case `delisted`:
        case `banned`:
        case `not_found`:
            return { line: errors.gone(named), bot };
        case `test_only`:
            return { line: errors.test_only, bot: null };
        case `paused`:
            return { line: errors.paused, bot: null };
        default:
            return { line: failed, bot: null };
    }
}

/**
 * A new round robin from empty, or as a link sets it up: the bots picked
 * several at once from the bot list, each on a plate with its strength,
 * then the schedule the event page will fill, the games a pair plays, the
 * clock, the opening, and Rated, never; and Start, which opens the round
 * robin's page. One person's bots alone make a test. Signed out or as a
 * guest, the card says what a round robin is and how to sign in.
 */
export function NewRoundRobin({
    bots,
    reads,
    me,
    quota,
    paused,
    initial,
    weekly,
    onRefused,
}: {
    bots: readonly BotListing[];
    reads: DuelReads;
    me: Me | undefined;
    quota: TournamentQuota | null;
    paused: boolean;
    initial: RoundRobinSetup;
    // The line a bot entered in the coming weekly carries, null for any other.
    weekly: (bot: string) => string | null;
    onRefused: () => void;
}) {
    const ids = useId();
    const [picked, setPicked] = useState<readonly PickedBot[]>(initial.bots);
    const [picking, setPicking] = useState(false);
    const [choices, setChoices] = useState<RoundRobinChoices>(readRoundRobinChoices);
    // The length a link asked for, until the person picks one.
    const [askedGames, setAskedGames] = useState<TournamentGamesPerPair | null>(initial.games);
    const [picks, setPicks] = useState<TimeControl | null>(initial.clock);
    const [opening, setOpening] = useState<OpeningPlies>(initial.opening ?? defaultRoundRobinOpening);
    const [outcome, setOutcome] = useState<Outcome>({ kind: `idle` });
    const added = useRef(false);
    const plateList = useRef<HTMLUListElement>(null);
    const viewer = reads.viewer;
    const find = (name: string) => bots.find((bot) => nameKeyOf(bot.name) === nameKeyOf(name)) ?? null;
    const field = picked.flatMap((entry) => {
        const bot = find(entry.name);
        return bot === null ? [] : [{ bot, level: levelOf(bot, entry.level) }];
    });
    const fieldBots = field.map((entry) => entry.bot);

    // A link that names a bot no longer listed leaves it out.
    useEffect(() => {
        if (bots.length > 0 && field.length < picked.length) setPicked(picked.filter((entry) => find(entry.name) !== null));
    });

    // Bots added hand focus to the Add slot, else to the last plate's Remove, since the button that opened the list may be gone.
    useEffect(() => {
        if (!added.current) return;
        added.current = false;
        const list = plateList.current;
        (list?.querySelector<HTMLElement>(`.slot-empty-add`) ?? [...(list?.querySelectorAll<HTMLElement>(`.slot-remove`) ?? [])].at(-1))?.focus();
    });

    const test = field.length >= tournamentMinPresent && isTest(fieldBots);
    const counts = gamesPerPairOf(test);
    const stored = test ? choices.testGames : choices.games;
    const wanted = askedGames !== null && counts.includes(askedGames) ? askedGames : stored;
    const games: TournamentGamesPerPair = counts.includes(wanted) ? wanted : (counts[0] ?? 2);
    const clock = field.length === 0 ? null : picks !== null && takenByAll(picks, fieldBots) ? picks : defaultFieldClock(fieldBots, null);
    const plies = opening > 1 || games === 2 ? opening : defaultRoundRobinOpening;
    const warnings = field.map((entry) => {
        const why = joinReason(entry.bot, fieldBots, reads);
        return why === null ? null : reasonLine(entry.bot, why, fieldBots);
    });
    const signedIn = me?.kind === `user`;
    const waits = warnings.some((warning) => warning !== null);
    const ready = field.length >= tournamentMinPresent;
    const blocked = paused || !signedIn || !ready || clock === null || waits || outcome.kind === `sending`;
    const schedule = scheduleOf(field.length, games);
    const words = text.roundRobins;
    const first = fieldBots[0];
    const owner = first?.ownerName ?? ``;
    const yours = first !== undefined && ownedBy(first, viewer);
    const note = field.length === 0 ? words.cardNote : test ? (yours ? words.allYours(field.length) : words.allOwners(owner, field.length)) : words.fieldNote(field.length);

    function add(next: readonly BotListing[]) {
        added.current = true;
        setPicked([...picked, ...next.map((bot) => ({ name: bot.name, level: null }))].slice(0, roundRobinMaxBots));
        setPicking(false);
        setOutcome({ kind: `idle` });
    }

    function remove(name: string) {
        setPicked(picked.filter((entry) => nameKeyOf(entry.name) !== nameKeyOf(name)));
        setOutcome({ kind: `idle` });
    }

    async function start() {
        if (blocked) return;
        setOutcome({ kind: `sending` });
        const setup = picked.filter((entry) => find(entry.name) !== null);
        try {
            const created = await createRoundRobin({
                bots: field.map((entry) => ({ name: entry.bot.name, ...(entry.level === null ? {} : { level: entry.level.id }) })),
                gamesPerPair: games,
                openingPlies: plies,
                timeControl: clock,
            });
            // Back from the round robin's page finds the setup as it was left.
            navigate(roundRobinSetupPath({ bots: setup, games, clock, opening: plies }), { replace: true });
            navigate(tournamentPagePath(created.id));
        } catch (cause) {
            // The reads beside the list may lag the server's, so a refusal naming a bot reads them again to tell why.
            const named = cause instanceof ApiError ? cause.bot : null;
            const fresh = named === null ? null : await refusalReads(viewer);
            const why = (name: string) => {
                const bot = (fresh?.bots ?? bots).find((each) => nameKeyOf(each.name) === nameKeyOf(name));
                return bot === undefined ? null : joinReason(bot, fieldBots, fresh?.reads ?? reads);
            };
            const refusal = roundRobinRefusal(cause, why, test);
            setOutcome({ kind: `refused`, line: refusal.line, bot: refusal.bot });
            onRefused();
        }
    }

    return (
        <div className="duel-card-lift">
            <section className="duel-card rr-card" aria-labelledby={`${ids}-title`}>
                <header className="duel-card-head">
                    <h2 id={`${ids}-title`}>{test ? words.newTest : words.newRoundRobin}</h2>
                    <p className="note">{note}</p>
                </header>
                {signedIn ? (
                    <ul ref={plateList} className="slots rr-plates">
                        {field.map((entry, index) => (
                            <li key={entry.bot.name}>
                                <FilledSlot
                                    bot={entry.bot}
                                    viewer={viewer}
                                    level={entry.level}
                                    showVersion={test}
                                    warning={warnings[index] ?? null}
                                    hint={weekly(entry.bot.name)}
                                    marked={outcome.kind === `refused` && outcome.bot !== null && nameKeyOf(outcome.bot) === nameKeyOf(entry.bot.name)}
                                    onLevel={(id) => {
                                        setPicked(picked.map((each) => (nameKeyOf(each.name) === nameKeyOf(entry.bot.name) ? { ...each, level: id } : each)));
                                    }}
                                    onChange={null}
                                    onRemove={() => {
                                        remove(entry.bot.name);
                                    }}
                                />
                            </li>
                        ))}
                        {field.length < roundRobinMaxBots ? (
                            <li>
                                <EmptySlot
                                    hint={field.length === 0 ? words.addHint : field.length < tournamentMinPresent ? words.addMore(tournamentMinPresent - field.length) : words.moreFit(roundRobinMaxBots - field.length)}
                                    target={field.length < tournamentMinPresent}
                                    label={words.addLabel}
                                    title={words.add}
                                    onAdd={() => {
                                        setPicking(true);
                                    }}
                                />
                            </li>
                        ) : null}
                    </ul>
                ) : null}
                {!signedIn || field.length === 0 ? (
                    <p className="duel-wait">{words.rule}</p>
                ) : ready && clock !== null ? (
                    <>
                        {test ? (
                            <div className="duel-kind">
                                <h3>{words.testBlock.title}</h3>
                                <p className="note">{yours ? words.testBlock.yours : words.testBlock.owners(owner)}</p>
                            </div>
                        ) : null}
                        <ScheduleBlock field={fieldBots} games={games} />
                        <GamesRow
                            games={games}
                            counts={counts}
                            onGames={(next) => {
                                setAskedGames(null);
                                setChoices(writeRoundRobinChoices(test ? { testGames: next } : { games: next }));
                                setOutcome({ kind: `idle` });
                            }}
                        />
                        <DuelClock
                            field={fieldBots}
                            clock={clock}
                            foot={words.clockFoot}
                            onClock={(next) => {
                                setPicks(next);
                                setOutcome({ kind: `idle` });
                            }}
                        />
                        <OpeningRow
                            opening={plies}
                            value={words.openingValue(plies)}
                            note={text.duels.openingNote}
                            allowed={(count) => count > 1 || games === 2}
                            onOpening={setOpening}
                        />
                        <div className="rated-row rr-rated">
                            <p className="checkline">
                                <span>{words.rated}</span>
                                <span>{words.no}</span>
                            </p>
                            <p className="note rated-line">{test ? words.ratedTest : words.ratedLine}</p>
                        </div>
                    </>
                ) : null}
                <StartPart
                    me={me}
                    paused={paused}
                    blocked={blocked}
                    test={test}
                    count={field.length}
                    games={schedule.games}
                    atOnce={schedule.atOnce}
                    quota={quota}
                    outcome={outcome}
                    waits={waits}
                    onStart={() => void start()}
                />
            </section>
            {picking ? (
                <RoundRobinPicker
                    bots={bots}
                    reads={reads}
                    field={fieldBots}
                    onAdd={add}
                    onClose={() => {
                        setPicking(false);
                    }}
                />
            ) : null}
        </div>
    );
}

/**
 * The schedule before a game: the crosstable the event page will fill,
 * every pair as two cells still to play, beside what the field plays and
 * how much of it at once.
 */
function ScheduleBlock({ field, games }: { field: readonly BotListing[]; games: number }) {
    const ids = useId();
    const schedule = scheduleOf(field.length, games);
    const pending = { game: 1, x: `first` as const, gameId: null, state: `pending` as const, winner: null, reason: null, turns: null, opening: null };
    return (
        <div className="setup-block rr-schedule">
            <h3 className="play-label" id={`${ids}-schedule`}>
                {text.roundRobins.schedule}
            </h3>
            <div className="rr-schedule-body">
                <div className="xt-frame" tabIndex={0} role="region" aria-label={text.roundRobins.scheduleLabel(field.length)}>
                    <table className="xt rr-schedule-table">
                        <thead>
                            <tr>
                                <th scope="col" className="xt-name">
                                    {text.tournaments.columns.bot}
                                </th>
                                {field.map((bot, index) => (
                                    <th key={bot.name} scope="col" className="xt-col">
                                        <span aria-hidden="true">{String(index + 1)}</span>
                                        <span className="sr-only">{bot.name}</span>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {field.map((bot, row) => (
                                <tr key={bot.name}>
                                    <th scope="row" className="xt-name">
                                        <span className="xt-rank" aria-hidden="true">
                                            {String(row + 1)}
                                        </span>
                                        {bot.name}
                                    </th>
                                    {field.map((opponent, column) => (
                                        <td key={opponent.name} className={row === column ? `xt-cell xt-self` : `xt-cell`}>
                                            {row === column ? null : (
                                                <span className="xt-pair" aria-hidden="true">
                                                    <GameGlyph game={pending} side="first" bot="" opponent="" linked={false} />
                                                    <GameGlyph game={{ ...pending, game: 2, x: `second` }} side="first" bot="" opponent="" linked={false} />
                                                </span>
                                            )}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <p className="note">{text.roundRobins.scheduleLine(schedule.pairs, schedule.rounds, schedule.atOnce, schedule.gamesPerBot)}</p>
            </div>
        </div>
    );
}

function GamesRow({ games, counts, onGames }: { games: TournamentGamesPerPair; counts: readonly TournamentGamesPerPair[]; onGames: (games: TournamentGamesPerPair) => void }) {
    const ids = useId();
    const openings = Array.from({ length: games / 2 }, (_, index) => index);
    const pending = { game: 1, x: `first` as const, gameId: null, state: `pending` as const, winner: null, reason: null, turns: null, opening: null };
    return (
        <div className="setup-block">
            <h3 className="play-label" id={`${ids}-games`}>
                {text.roundRobins.gamesPerPair}
            </h3>
            <div className="count-chips" role="radiogroup" aria-labelledby={`${ids}-games`}>
                {counts.map((count) => (
                    <label key={count} className="strength-chip count-chip">
                        <input
                            type="radio"
                            name={`${ids}-count`}
                            value={count}
                            checked={games === count}
                            onChange={() => {
                                onGames(count);
                            }}
                        />
                        <span className="strength-label">{String(count)}</span>
                    </label>
                ))}
            </div>
            <div className="pair-line">
                <span className="pair-preview" aria-hidden="true">
                    {openings.map((opening) => (
                        <span key={opening} className="xt-pair">
                            <GameGlyph game={pending} side="first" bot="" opponent="" linked={false} />
                            <GameGlyph game={{ ...pending, game: 2, x: `second` }} side="first" bot="" opponent="" linked={false} />
                        </span>
                    ))}
                </span>
                <p className="note">{text.roundRobins.pairNote(games)}</p>
            </div>
        </div>
    );
}

function StartPart({
    me,
    paused,
    blocked,
    test,
    count,
    games,
    atOnce,
    quota,
    outcome,
    waits,
    onStart,
}: {
    me: Me | undefined;
    paused: boolean;
    blocked: boolean;
    test: boolean;
    count: number;
    games: number;
    atOnce: number;
    quota: TournamentQuota | null;
    outcome: Outcome;
    // A bot on a plate can no longer start, which its plate says.
    waits: boolean;
    onStart: () => void;
}) {
    const words = text.roundRobins;
    if (me === undefined) return null;
    if (me === null || me.kind === `guest`) {
        return (
            <div className="duel-start">
                <p className="note">{me === null ? words.signedOut : words.guest}</p>
                <DiscordSignIn next="/play/tournament" guest={me !== null} />
            </div>
        );
    }
    if (count === 0) return null;
    const ready = count >= tournamentMinPresent;
    return (
        <div className="duel-start">
            <button type="button" className="btn btn-primary" aria-disabled={blocked ? `true` : undefined} onClick={onStart}>
                {test ? words.startTest : words.start}
            </button>
            <div role="status">
                {outcome.kind === `sending` ? <p className="sr-only">{words.starting}</p> : null}
                {outcome.kind === `refused` ? <p className="start-refusal">{outcome.line}</p> : null}
            </div>
            {paused ? (
                <p className="note">{words.errors.paused}</p>
            ) : !ready ? (
                <p className="note">{words.fewer(tournamentMinPresent - count)}</p>
            ) : waits ? (
                <p className="note">{words.startWaits}</p>
            ) : null}
            {ready ? <p className="note">{test ? words.termsTest(games, atOnce) : words.terms(games, atOnce)}</p> : null}
            {quota === null ? null : <p className="note">{words.quota(quota.live, quota.today)}</p>}
        </div>
    );
}
