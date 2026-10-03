import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { clockText, nameKeyOf, type BotListing, type DuelGames, type DuelQuota, type Level, type Me, type OpeningPlies, type TimeControl } from '@hexo-arena/contract';
import { createDuel } from '../api/client';
import { DiscordSignIn } from '../components/DiscordButton';
import { OpeningRow } from '../play/OpeningRow';
import { ownedBy } from '../play/setup';
import { Link } from '../router/Link';
import { navigate } from '../router/use-route';
import { text } from '../text';
import { DuelClock } from './DuelClock';
import { Picker } from './Picker';
import { namesABot, refusalLine, refusalReads, refusedBot } from './refusal';
import { GameGlyph } from './Scoreboard';
import {
    clockForPair,
    defaultDuelOpening,
    duelPagePath,
    gameCountsOf,
    kindOf,
    openingAllowed,
    otherSlot,
    pickReason,
    ratedReason,
    readChoices,
    writeChoices,
    type DuelChoices,
    type DuelReads,
    type DuelSetup,
    type PickReason,
    type RatedReason,
    type SlotKey,
} from './setup';
import { EmptySlot, FilledSlot, VsCell } from './Slots';
import '../screens/PlayScreen.css';
import './Duels.css';

type Outcome = { kind: `idle` } | { kind: `sending` } | { kind: `refused`; line: ReactNode };

// A pair preview shows this many pairs, the rest counted after it.
const previewPairs = 5;

function levelOf(bot: BotListing | null, id: string | null): Level | null {
    if (bot === null || id === null || bot.levels === null || id === bot.levels.default) return null;
    return bot.levels.list.find((level) => level.id === id) ?? null;
}

function reasonLine(bot: BotListing, reason: PickReason, other: BotListing | null): string {
    if (reason === `offline`) return text.duels.slot.gone(bot.name);
    const words = text.duels.picker.reasons;
    const said = reason === `pair` ? words.pair(other?.name ?? ``) : reason === `clock` ? words.clock(other?.name ?? ``) : words[reason];
    return text.duels.slot.unready(bot.name, said);
}

function ratedLine(reason: RatedReason): string {
    const words = text.duels.rated;
    switch (reason.kind) {
        case `may`:
            return words.may(reason.own);
        case `neither`:
            return words.neither;
        case `strength`:
            return words.strength(reason.bot, reason.label);
        case `both`:
            return words.both;
        case `owner`:
            return words.owner(reason.owner);
    }
}

/**
 * A new duel from empty, or as a link sets it up: two slots, each filled
 * through the bot list, then the games, the clock, the opening, and Rated
 * with its reason, and Start, which opens the duel's page. Two bots of one
 * owner make a test. A compact card, as Home's, shows the slots and Start
 * alone and starts with the defaults.
 */
export function NewDuel({
    bots,
    reads,
    me,
    quota,
    paused,
    initial,
    compact = false,
    liveCount = null,
    onRefused,
}: {
    bots: readonly BotListing[];
    reads: DuelReads;
    me: Me | undefined;
    quota: DuelQuota | null;
    paused: boolean;
    initial: DuelSetup;
    compact?: boolean;
    // The duels live now, which Home's card names beside its way to Bot duels.
    liveCount?: number | null;
    onRefused: () => void;
}) {
    const ids = useId();
    const [slots, setSlots] = useState<Readonly<Record<SlotKey, string | null>>>({ first: initial.first, second: initial.second });
    const [levels, setLevels] = useState<Readonly<Record<SlotKey, string | null>>>(initial.levels);
    const [picking, setPicking] = useState<SlotKey | null>(null);
    const [choices, setChoices] = useState<DuelChoices>(readChoices);
    // The length a link asked for, until the person picks one.
    const [askedGames, setAskedGames] = useState<DuelGames | null>(initial.games);
    const [picks, setPicks] = useState<TimeControl | null>(initial.clock);
    const [opening, setOpening] = useState<OpeningPlies>(initial.opening ?? defaultDuelOpening);
    const [outcome, setOutcome] = useState<Outcome>({ kind: `idle` });
    const slotList = useRef<HTMLUListElement>(null);
    // The slot a bot was just added to, whose next control takes focus once the list is gone.
    const added = useRef<SlotKey | null>(null);
    const viewer = reads.viewer;
    const find = (name: string | null) => (name === null ? null : (bots.find((bot) => nameKeyOf(bot.name) === nameKeyOf(name)) ?? null));
    const first = find(slots.first);
    const second = find(slots.second);
    const bot = { first, second };

    // A link that names a bot no longer listed leaves its slot empty.
    useEffect(() => {
        if (slots.first !== null && first === null && bots.length > 0) setSlots((held) => ({ ...held, first: null }));
        if (slots.second !== null && second === null && bots.length > 0) setSlots((held) => ({ ...held, second: null }));
    }, [bots, slots, first, second]);

    const kind = first !== null && second !== null ? kindOf(first, second) : null;
    const counts = gameCountsOf(kind ?? `duel`);
    const stored = kind === `test` ? choices.testGames : choices.duelGames;
    const wanted = askedGames !== null && counts.includes(askedGames) ? askedGames : stored;
    const games: DuelGames = counts.includes(wanted) ? wanted : (counts[0] ?? 2);
    const picked = { first: levelOf(first, levels.first), second: levelOf(second, levels.second) };
    const clock = first !== null && second !== null ? clockForPair(first, second, picks, null) : null;
    const plies = openingAllowed(opening, games) ? opening : defaultDuelOpening;
    const reason = first !== null && second !== null ? ratedReason(first, second, picked, viewer) : null;
    const canRate = reason?.kind === `may`;
    // Home's card starts with the defaults, unrated.
    const rated = !compact && canRate && choices.rated;
    const warnings = {
        first: first === null ? null : warningOf(first, second),
        second: second === null ? null : warningOf(second, first),
    };
    const signedIn = me?.kind === `user`;
    const waits = warnings.first !== null || warnings.second !== null;
    const blocked = paused || !signedIn || first === null || second === null || clock === null || waits || outcome.kind === `sending`;
    const target: SlotKey | null = first === null ? `first` : second === null ? `second` : null;

    // A bot added hands focus to the next empty slot's Add, else to the filled slot's Change, since the button that opened the list may be gone.
    useEffect(() => {
        const slot = added.current;
        const list = slotList.current;
        if (slot === null || list === null) return;
        added.current = null;
        const next = list.querySelector<HTMLElement>(`[data-slot='${otherSlot(slot)}'] .slot-empty-add`) ?? list.querySelector<HTMLElement>(`[data-slot='${slot}'] .slot-change`);
        next?.focus();
    });

    function warningOf(subject: BotListing, other: BotListing | null): string | null {
        const why = pickReason(subject, other, reads);
        return why === null ? null : reasonLine(subject, why, other);
    }

    function add(slot: SlotKey, next: BotListing) {
        added.current = slot;
        setSlots((held) => ({ ...held, [slot]: next.name }));
        setLevels((held) => ({ ...held, [slot]: null }));
        setPicking(null);
        setOutcome({ kind: `idle` });
    }

    function remove(slot: SlotKey) {
        setSlots((held) => ({ ...held, [slot]: null }));
        setLevels((held) => ({ ...held, [slot]: null }));
        setOutcome({ kind: `idle` });
    }

    async function start() {
        if (blocked) return;
        setOutcome({ kind: `sending` });
        try {
            const created = await createDuel({
                first: first.name,
                second: second.name,
                games,
                openingPlies: plies,
                timeControl: clock,
                levels: { ...(picked.first === null ? {} : { first: picked.first.id }), ...(picked.second === null ? {} : { second: picked.second.id }) },
                rated,
            });
            navigate(duelPagePath(created.id));
        } catch (cause) {
            // The reads beside the list may lag the server's, so a refusal naming a bot reads them again to tell which bot and why.
            const fresh = namesABot(cause) ? await refusalReads(viewer) : null;
            const listed = (held: BotListing) => fresh?.bots.find((each) => nameKeyOf(each.name) === nameKeyOf(held.name)) ?? held;
            const pair = [listed(first), listed(second)] as const;
            const terms = { clock, levelled: picked.first !== null ? (`first` as const) : picked.second !== null ? (`second` as const) : null };
            const line = await refusalLine(cause, { first: first.name, second: second.name }, (code) => refusedBot(code, pair, terms, fresh?.reads ?? reads), text.duels.errors.failed);
            setOutcome({ kind: `refused`, line });
            onRefused();
        }
    }

    const words = text.duels;
    const title = kind === `test` ? words.newTest : words.newDuel;
    // Each bot that offers strengths, at the one it plays.
    const strong = ([`first`, `second`] as const).flatMap((slot) => {
        const held = bot[slot];
        if (held === null || held.levels === null || held.levels.list.length < 2) return [];
        const label = picked[slot]?.label ?? held.levels.list.find((entry) => entry.id === held.levels?.default)?.label;
        return label === undefined ? [] : [[held.name, label] as const];
    });
    const note =
        kind === `test` && first !== null
            ? ownedBy(first, viewer)
                ? words.bothYours
                : words.bothOwners(first.ownerName ?? ``)
            : strong.length === 0
              ? words.cardNote
              : words.atStrengths(strong);

    const slotView = (slot: SlotKey) => {
        const held = bot[slot];
        if (held === null) {
            const hint = compact
                ? ``
                : !signedIn
                ? slot === `first`
                    ? words.slot.hintSignedOutFirst
                    : words.slot.hintSignedOutSecond
                : slot === `first`
                  ? words.slot.hintFirst
                  : words.slot.hintSecond;
            return (
                <EmptySlot
                    hint={hint}
                    target={target === slot}
                    label={`${words.slot.add}, ${slot === `first` ? words.slot.first : words.slot.second}`}
                    onAdd={() => {
                        setPicking(slot);
                    }}
                />
            );
        }
        return (
            <FilledSlot
                bot={held}
                viewer={viewer}
                level={picked[slot]}
                showVersion={kind === `test`}
                warning={warnings[slot]}
                onLevel={(id) => {
                    setLevels((current) => ({ ...current, [slot]: id }));
                }}
                onChange={() => {
                    setPicking(slot);
                }}
                onRemove={() => {
                    remove(slot);
                }}
            />
        );
    };

    return (
        <div className={compact ? `home-duel` : `duel-card-lift`}>
            <section className={compact ? undefined : `duel-card`} aria-labelledby={`${ids}-title`}>
                <header className={compact ? `home-duel-head` : `duel-card-head`}>
                    <h2 id={`${ids}-title`}>{compact ? words.home.title : title}</h2>
                    {compact ? (
                        <p className="note">
                            {liveCount === null || liveCount === 0
                                ? words.home.place((place) => <Link to="/play/duels">{place}</Link>)
                                : words.home.live(liveCount, (place) => <Link to="/play/duels">{place}</Link>)}
                        </p>
                    ) : (
                        <p className="note">{first === null && second === null ? words.cardNote : note}</p>
                    )}
                </header>
                <ul ref={slotList} className={compact ? `slots home-duel-slots` : `slots`}>
                    <li data-slot="first">{slotView(`first`)}</li>
                    <li aria-hidden="true">
                        <VsCell />
                    </li>
                    <li data-slot="second">{slotView(`second`)}</li>
                </ul>
                {compact ? null : first === null || second === null ? (
                    <p className="duel-wait">{words.cardFoot}</p>
                ) : (
                    <>
                        {kind === `test` ? (
                            <div className="duel-kind">
                                <h3>{words.testBlock.title}</h3>
                                <p className="note">{ownedBy(first, viewer) ? words.testBlock.yours : words.testBlock.owners(first.ownerName ?? ``)}</p>
                            </div>
                        ) : null}
                        <GamesRow
                            games={games}
                            counts={counts}
                            onGames={(next) => {
                                setAskedGames(null);
                                setChoices(writeChoices(kind === `test` ? { testGames: next } : { duelGames: next }));
                                setOutcome({ kind: `idle` });
                            }}
                        />
                        {clock === null ? null : (
                            <DuelClock
                                first={first}
                                second={second}
                                clock={clock}
                                onClock={(next) => {
                                    setPicks(next);
                                    setOutcome({ kind: `idle` });
                                }}
                            />
                        )}
                        <OpeningRow
                            opening={plies}
                            value={words.openingValue(plies, games)}
                            note={words.openingNote}
                            allowed={(count) => openingAllowed(count, games)}
                            onOpening={setOpening}
                        />
                        <div className="rated-row">
                            <label className="checkline">
                                <span>{words.rated.label}</span>
                                <input
                                    type="checkbox"
                                    role="switch"
                                    checked={rated}
                                    disabled={!canRate}
                                    aria-describedby={`${ids}-rated`}
                                    onChange={(event) => {
                                        setChoices(writeChoices({ rated: event.target.checked }));
                                    }}
                                />
                            </label>
                            {reason === null ? null : (
                                <p className="note rated-line" id={`${ids}-rated`}>
                                    {ratedLine(reason)}
                                </p>
                            )}
                        </div>
                    </>
                )}
                <StartPart
                    compact={compact}
                    me={me}
                    paused={paused}
                    blocked={blocked}
                    kind={kind ?? `duel`}
                    games={games}
                    clockWords={clock}
                    stoppers={first === null || second === null ? [] : stoppersOf(first, second, viewer)}
                    quota={quota}
                    outcome={outcome}
                    ready={first !== null && second !== null}
                    waits={waits}
                    onStart={() => void start()}
                />
            </section>
            {picking === null ? null : (
                <Picker
                    slot={picking}
                    bots={bots}
                    reads={reads}
                    other={bot[otherSlot(picking)]}
                    current={bot[picking]}
                    onAdd={(next) => {
                        add(picking, next);
                    }}
                    onClose={() => {
                        setPicking(null);
                    }}
                />
            )}
        </div>
    );
}

// Who can stop the duel: its starter, the reader, and each bot's owner.
function stoppersOf(first: BotListing, second: BotListing, viewer: string | null): string[] {
    const owners = [first.ownerName, second.ownerName].filter((owner): owner is string => owner !== null && owner !== viewer);
    return [text.duels.you, ...new Set(owners)];
}

function GamesRow({ games, counts, onGames }: { games: DuelGames; counts: readonly DuelGames[]; onGames: (games: DuelGames) => void }) {
    const ids = useId();
    const pairs = Math.ceil(games / 2);
    const preview = Array.from({ length: Math.min(pairs, previewPairs) }, (_, index) => index);
    return (
        <div className="setup-block">
            <h3 className="play-label" id={`${ids}-games`}>
                {text.duels.games}
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
                    {preview.map((pair) => (
                        <span key={pair} className="xt-pair">
                            {(games === 1 ? [1] : [1, 2]).map((game) => (
                                <GameGlyph key={game} game={{ game, x: `first`, gameId: null, state: `pending`, winner: null, reason: null, turns: null, opening: null }} side="first" bot="" opponent="" />
                            ))}
                        </span>
                    ))}
                </span>
                {pairs > previewPairs ? <span className="note">{text.duels.morePairs(pairs - previewPairs)}</span> : null}
                <p className="note">{text.duels.pairNote(games)}</p>
            </div>
        </div>
    );
}

function StartPart({
    compact,
    me,
    paused,
    blocked,
    kind,
    games,
    clockWords,
    stoppers,
    quota,
    outcome,
    ready,
    waits,
    onStart,
}: {
    compact: boolean;
    me: Me | undefined;
    paused: boolean;
    blocked: boolean;
    kind: `duel` | `test`;
    games: number;
    clockWords: TimeControl | null;
    stoppers: readonly string[];
    quota: DuelQuota | null;
    outcome: Outcome;
    ready: boolean;
    // A bot in a slot can no longer start, which its slot says.
    waits: boolean;
    onStart: () => void;
}) {
    const words = text.duels;
    if (me === undefined) return null;
    if (me !== null && me.kind === `user` && !ready) return null;
    if (me === null || me.kind === `guest`) {
        return (
            <div className="duel-start">
                <p className="note">{me === null ? words.signedOut : words.guest(me.name)}</p>
                <DiscordSignIn next="/play/duels" guest={me !== null} />
            </div>
        );
    }
    return (
        <div className="duel-start">
            {compact && clockWords !== null ? (
                <p className="note">
                    {words.home.terms(games, clockText(clockWords), kind === `test` ? words.home.test : words.home.unrated, (place) => <Link to="/play/duels">{place}</Link>)}
                </p>
            ) : null}
            <button type="button" className="btn btn-primary" aria-disabled={blocked ? `true` : undefined} onClick={onStart}>
                {kind === `test` ? words.startTest : words.start}
            </button>
            <div role="status">
                {outcome.kind === `sending` ? <p className="sr-only">{words.starting}</p> : null}
                {outcome.kind === `refused` ? <p className="start-refusal">{outcome.line}</p> : null}
            </div>
            {paused ? <p className="note">{words.errors.paused}</p> : waits ? <p className="note">{words.startWaits}</p> : null}
            {compact || !ready ? null : <p className="note">{kind === `test` ? words.termsTest(games, stoppers) : words.terms(games, stoppers)}</p>}
            {compact || quota === null ? null : <p className="note">{words.quota(quota.live, quota.today)}</p>}
        </div>
    );
}
