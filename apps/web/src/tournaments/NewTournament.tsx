import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { nameKeyOf, tournamentBotsMax, tournamentBotsMin, type BotListing, type Level, type Me, type OpeningPlies, type TimeControl, type TournamentGamesPerPair, type TournamentQuota } from '@hexo-arena/contract';
import { ApiError, createTournament, limitedFor } from '../api/client';
import { DiscordSignIn } from '../components/DiscordButton';
import { DuelClock } from '../duels/DuelClock';
import { defaultFieldClock, takenByAll } from '../duels/setup';
import { EmptySlot, FilledSlot, VsCell } from '../duels/Slots';
import { OpeningRow } from '../play/OpeningRow';
import { clockClashes, eventReadiness, isTest, reasonText, type BotReason, type SetupReads } from '../play/readiness';
import { ownedBy } from '../play/setup';
import { navigate } from '../router/use-route';
import { text } from '../text';
import { BotPicker } from './BotPicker';
import { Hex } from './Crosstable';
import {
    countsInReach,
    defaultTournamentOpening,
    gamesPerPairOf,
    readTournamentChoices,
    scheduleOf,
    tournamentSetupPath,
    writeTournamentChoices,
    type PickedBot,
    type TournamentChoices,
    type TournamentSetup,
} from './setup';
import { tournamentPagePath } from './view';
import '../screens/PlayScreen.css';
import '../duels/Duels.css';
import './RoundRobin.css';

type Outcome = { kind: `idle` } | { kind: `sending` } | { kind: `refused`; line: ReactNode; bot: string | null };

/** What a field plays by its size: two bots a duel, three or more a round robin, one person's bots alone a test. */
export type Kind = `duel` | `round_robin` | `test`;

// A games preview draws this many openings, the rest counted after it.
const previewOpenings = 5;

function levelOf(bot: BotListing, id: string | null): Level | null {
    if (id === null || bot.levels === null || id === bot.levels.default) return null;
    return bot.levels.list.find((level) => level.id === id) ?? null;
}

// Why a bot cannot play, in its plate's words: offline said on its own, every other reason after its name.
function reasonLine(bot: BotListing, reason: BotReason, field: readonly BotListing[]): string {
    if (reason === `offline`) return text.roundRobins.gone(bot.name);
    return text.duels.slot.unready(bot.name, reasonText(reason, clockClashes(bot, field).map((each) => each.name)));
}

// The next UTC midnight in the reader's own clock, as the daily cap's line names it.
function nextDayLocal(): string {
    const now = new Date();
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    return new Intl.DateTimeFormat(undefined, { timeStyle: `short` }).format(new Date(midnight));
}

/**
 * A refusal to set a duel or round robin up as its line, by its code,
 * naming the bot the server names, and why where the reads beside the bot
 * list tell; kind words what failed to start.
 */
export function tournamentRefusal(cause: unknown, why: (bot: string) => BotReason | null, kind: Kind): { line: ReactNode; bot: string | null } {
    const errors = text.roundRobins.errors;
    const wait = limitedFor(cause);
    if (wait !== null) return { line: text.states.tooMany(wait), bot: null };
    const failed = errors.failed[kind];
    if (!(cause instanceof ApiError)) return { line: failed, bot: null };
    const bot = cause.bot;
    const named = bot ?? ``;
    switch (cause.code) {
        case `tournament_busy`:
            return { line: errors.tournament_busy, bot: null };
        case `daily_tournament_cap`:
            return { line: errors.daily_tournament_cap(nextDayLocal()), bot: null };
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
        case `too_many_games`:
            return { line: errors.too_many_games, bot: null };
        case `paused`:
            return { line: errors.paused, bot: null };
        default:
            return { line: failed, bot: null };
    }
}

/**
 * A new duel or round robin from empty, or as a link sets it up: the bots
 * picked several at once from the bot list, each on a plate with its
 * strength; at two bots the plates face each other as a duel's, at three
 * or more they list and the schedule the event page will fill follows.
 * Then the games, the clock, the opening, and Rated, never; and Start,
 * which opens the event's page. The title, the games' label, and Start
 * follow the count, and one person's bots alone make a test. Signed out
 * or as a guest, the card says what an event is and how to sign in.
 */
export function NewTournament({
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
    reads: SetupReads;
    me: Me | undefined;
    quota: TournamentQuota | null;
    paused: boolean;
    initial: TournamentSetup;
    // The line a bot entered in the coming weekly carries, naming what it leaves; null for any other.
    weekly: (bot: string, kind: Kind) => string | null;
    onRefused: () => void;
}) {
    const ids = useId();
    const [picked, setPicked] = useState<readonly PickedBot[]>(initial.bots);
    const [picking, setPicking] = useState(false);
    const [choices, setChoices] = useState<TournamentChoices>(readTournamentChoices);
    // The count a link asked for or the person picked here, which a field of another size keeps as far as it fits.
    const [chosenGames, setChosenGames] = useState<TournamentGamesPerPair | null>(initial.games);
    const [picks, setPicks] = useState<TimeControl | null>(initial.clock);
    const [opening, setOpening] = useState<OpeningPlies>(initial.opening ?? defaultTournamentOpening);
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

    const ready = field.length >= tournamentBotsMin;
    const duel = field.length <= tournamentBotsMin;
    const test = ready && isTest(fieldBots);
    const kind: Kind = test ? `test` : duel ? `duel` : `round_robin`;
    const counts = gamesPerPairOf(test);
    const reach = countsInReach(field.length, test);
    const stored = test ? choices.testGames : duel ? choices.duelGames : choices.games;
    const wanted = chosenGames ?? stored;
    // A count past the field's reach falls to the largest it takes at or under it.
    const games: TournamentGamesPerPair = reach.includes(wanted) ? wanted : ([...reach].reverse().find((count) => count <= wanted) ?? reach[0] ?? 1);
    const clock = field.length === 0 ? null : picks !== null && takenByAll(picks, fieldBots) ? picks : defaultFieldClock(fieldBots, null);
    const plies = opening > 1 || games <= 2 ? opening : defaultTournamentOpening;
    const warnings = field.map((entry) => {
        const why = eventReadiness(entry.bot, fieldBots, reads);
        return why === null ? null : reasonLine(entry.bot, why, fieldBots);
    });
    const signedIn = me?.kind === `user`;
    const waits = warnings.some((warning) => warning !== null);
    const blocked = paused || !signedIn || !ready || clock === null || waits || outcome.kind === `sending`;
    const schedule = scheduleOf(field.length, games);
    const words = text.roundRobins;
    const first = fieldBots[0];
    const owner = first?.ownerName ?? ``;
    const yours = first !== undefined && ownedBy(first, viewer);
    // Before two bots, the rule under the plates says what the field makes.
    const note = test ? (yours ? words.allYours(field.length) : words.allOwners(owner, field.length)) : ready ? words.fieldNote(field.length) : null;

    function add(next: readonly BotListing[]) {
        added.current = true;
        setPicked([...picked, ...next.map((bot) => ({ name: bot.name, level: null }))].slice(0, tournamentBotsMax));
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
            const created = await createTournament({
                bots: field.map((entry) => ({ name: entry.bot.name, ...(entry.level === null ? {} : { level: entry.level.id }) })),
                gamesPerPair: games,
                openingPlies: plies,
                timeControl: clock,
            });
            // Back from the event's page finds the setup as it was left.
            navigate(tournamentSetupPath({ bots: setup, games, clock, opening: plies }), { replace: true });
            navigate(tournamentPagePath(created.id));
        } catch (cause) {
            const why = (name: string) => {
                const bot = find(name);
                return bot === null ? null : eventReadiness(bot, fieldBots, reads);
            };
            const refusal = tournamentRefusal(cause, why, kind);
            setOutcome({ kind: `refused`, line: refusal.line, bot: refusal.bot });
            onRefused();
        }
    }

    const plate = (entry: (typeof field)[number], index: number) => (
        <FilledSlot
            bot={entry.bot}
            viewer={viewer}
            level={entry.level}
            showVersion={test}
            warning={warnings[index] ?? null}
            hint={weekly(entry.bot.name, kind)}
            marked={outcome.kind === `refused` && outcome.bot !== null && nameKeyOf(outcome.bot) === nameKeyOf(entry.bot.name)}
            onLevel={(id) => {
                setPicked(picked.map((each) => (nameKeyOf(each.name) === nameKeyOf(entry.bot.name) ? { ...each, level: id } : each)));
            }}
            onChange={null}
            onRemove={() => {
                remove(entry.bot.name);
            }}
        />
    );
    const addSlot = (hint: string, target: boolean, label: string) => (
        <EmptySlot
            hint={hint}
            target={target}
            label={label}
            title={words.add}
            onAdd={() => {
                setPicking(true);
            }}
        />
    );

    return (
        <div className="duel-card-lift">
            <section className="duel-card rr-card" aria-labelledby={`${ids}-title`}>
                <header className="duel-card-head">
                    <h2 id={`${ids}-title`}>{words.title[kind]}</h2>
                    {note === null ? null : <p className="note">{note}</p>}
                </header>
                {signedIn ? (
                    duel ? (
                        <ul ref={plateList} className="slots">
                            {[0, 1].map((index) => {
                                const entry = field[index];
                                return [
                                    index === 1 ? (
                                        <li key="vs" aria-hidden="true">
                                            <VsCell />
                                        </li>
                                    ) : null,
                                    <li key={entry?.bot.name ?? `empty-${String(index)}`} data-slot={index === 0 ? `first` : `second`}>
                                        {entry === undefined
                                            ? addSlot(index === 0 ? words.addHint : words.addSecond, index === field.length, index === 0 ? words.addLabel : words.addSecondLabel)
                                            : plate(entry, index)}
                                    </li>,
                                ];
                            })}
                            {field.length === tournamentBotsMin ? <li className="event-add">{addSlot(words.moreFit(tournamentBotsMax - field.length, field.length), false, words.addLabel)}</li> : null}
                        </ul>
                    ) : (
                        <ul ref={plateList} className="slots rr-plates">
                            {field.map((entry, index) => (
                                <li key={entry.bot.name}>{plate(entry, index)}</li>
                            ))}
                            {field.length < tournamentBotsMax ? <li>{addSlot(words.moreFit(tournamentBotsMax - field.length, field.length), false, words.addLabel)}</li> : null}
                        </ul>
                    )
                ) : null}
                {!signedIn || !ready ? (
                    <p className="duel-wait">{words.rule}</p>
                ) : clock !== null ? (
                    <>
                        {test ? (
                            <div className="duel-kind">
                                <h3>{words.testBlock.title}</h3>
                                <p className="note">{yours ? words.testBlock.yours(field.length, Math.max(...reach)) : words.testBlock.owners(owner, field.length, Math.max(...reach))}</p>
                            </div>
                        ) : null}
                        {duel ? null : <ScheduleBlock field={fieldBots} games={games} />}
                        <GamesRow
                            games={games}
                            counts={counts}
                            reach={reach}
                            bots={field.length}
                            onGames={(next) => {
                                setChosenGames(next);
                                setChoices(writeTournamentChoices(test ? { testGames: next } : duel ? { duelGames: next } : { games: next }));
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
                            allowed={(count) => count > 1 || games <= 2}
                            onOpening={setOpening}
                        />
                        <div className="rated-row rr-rated">
                            <p className="checkline">
                                <span>{words.rated}</span>
                                <span>{words.no}</span>
                            </p>
                            <p className="note rated-line">{test ? words.ratedTest(field.length) : words.ratedLine}</p>
                        </div>
                    </>
                ) : null}
                <StartPart
                    me={me}
                    paused={paused}
                    blocked={blocked}
                    kind={kind}
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
                <BotPicker
                    bots={bots}
                    reads={reads}
                    mode={{ kind: `several`, field: fieldBots, onAdd: add }}
                    onClose={() => {
                        setPicking(false);
                    }}
                />
            ) : null}
        </div>
    );
}

const pending = { state: `pending`, gameId: null } as const;

// One opening's cells still to play, as the first bot plays them: two, or one for a single game.
function PendingOpening({ single }: { single: boolean }) {
    return (
        <span className="xt-pair">
            <Hex view={pending} side="x" bot="" opponent="" />
            {single ? null : <Hex view={pending} side="o" bot="" opponent="" />}
        </span>
    );
}

// The schedule before a game: the crosstable the event page will fill,
// every pair as its cells still to play, beside what the field plays and
// how much of it at once.
function ScheduleBlock({ field, games }: { field: readonly BotListing[]; games: number }) {
    const ids = useId();
    const schedule = scheduleOf(field.length, games);
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
                                            {row === column ? null : <PendingOpening single={games === 1} />}
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

// The games a pair plays: each count the field's kind offers, those that
// would take a bot past its most games outlined out of reach with why;
// then the openings drawn as cells to play.
function GamesRow({
    games,
    counts,
    reach,
    bots,
    onGames,
}: {
    games: TournamentGamesPerPair;
    counts: readonly TournamentGamesPerPair[];
    reach: readonly TournamentGamesPerPair[];
    bots: number;
    onGames: (games: TournamentGamesPerPair) => void;
}) {
    const ids = useId();
    const words = text.roundRobins;
    const openings = Math.max(1, games / 2);
    const preview = Array.from({ length: Math.min(openings, previewOpenings) }, (_, index) => index);
    const out = counts.filter((count) => !reach.includes(count));
    return (
        <div className="setup-block">
            <h3 className="play-label" id={`${ids}-games`}>
                {words.gamesLabel(bots)}
            </h3>
            <div className="count-chips" role="radiogroup" aria-labelledby={`${ids}-games`} aria-describedby={out.length === 0 ? undefined : `${ids}-out`}>
                {counts.map((count) => {
                    const fits = reach.includes(count);
                    return (
                        <label key={count} className="strength-chip count-chip">
                            <input
                                type="radio"
                                name={`${ids}-count`}
                                value={count}
                                checked={games === count}
                                disabled={!fits}
                                onChange={() => {
                                    onGames(count);
                                }}
                            />
                            <span className="strength-label">{String(count)}</span>
                        </label>
                    );
                })}
            </div>
            {out.length === 0 ? null : (
                <p className="note count-out-note" id={`${ids}-out`}>
                    {words.countsOut(bots, Math.max(...reach))}
                </p>
            )}
            <div className="pair-line">
                <span className="pair-preview" aria-hidden="true">
                    {preview.map((opening) => (
                        <PendingOpening key={opening} single={games === 1} />
                    ))}
                </span>
                {openings > previewOpenings ? <span className="note">{text.duels.morePairs(openings - previewOpenings)}</span> : null}
                <p className="note">{words.pairNote(games, bots)}</p>
            </div>
        </div>
    );
}

function StartPart({
    me,
    paused,
    blocked,
    kind,
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
    kind: Kind;
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
    const ready = count >= tournamentBotsMin;
    return (
        <div className="duel-start">
            <button type="button" className="btn btn-primary" aria-disabled={blocked ? `true` : undefined} onClick={onStart}>
                {words.start[kind]}
            </button>
            <div role="status">
                {outcome.kind === `sending` ? <p className="sr-only">{words.starting}</p> : null}
                {outcome.kind === `refused` ? <p className="start-refusal">{outcome.line}</p> : null}
            </div>
            {paused ? (
                <p className="note">{words.errors.paused}</p>
            ) : !ready ? (
                <p className="note">{words.fewer(tournamentBotsMin - count)}</p>
            ) : waits ? (
                <p className="note">{words.startWaits}</p>
            ) : null}
            {ready ? <p className="note">{words.terms(kind, count, games, atOnce)}</p> : null}
            {quota === null ? null : <p className="note">{words.quota(quota.live, quota.today)}</p>}
        </div>
    );
}
