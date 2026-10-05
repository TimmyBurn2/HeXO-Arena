import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { clockText, nameKeyOf, tournamentBotsMin, type BotListing, type Level, type Me } from '@hexo-arena/contract';
import { createTournament, fetchTournaments } from '../api/client';
import { useAsync } from '../api/use-async';
import { DiscordSignIn } from '../components/DiscordButton';
import { defaultFieldClock, kindOf, otherSlot, type SlotKey } from '../duels/setup';
import { EmptySlot, FilledSlot, VsCell } from '../duels/Slots';
import { eventReadiness, reasonText, type BotReason } from '../play/readiness';
import { Link } from '../router/Link';
import { navigate } from '../router/use-route';
import { useSiteStatus } from '../site-status';
import { text } from '../text';
import { BotPicker } from '../tournaments/BotPicker';
import { tournamentRefusal } from '../tournaments/NewTournament';
import { countsInReach, defaultTournamentOpening, readTournamentChoices, tournamentSetupPath } from '../tournaments/setup';
import { useBotStates } from '../tournaments/use-setup-reads';
import { gamesTournamentsPath, tournamentPagePath } from '../tournaments/view';
import '../screens/PlayScreen.css';
import '../duels/Duels.css';

type Outcome = { kind: `idle` } | { kind: `sending` } | { kind: `refused`; line: ReactNode };

// Duels live now, tests left off as Home leaves them off.
const loadLive = async () => (await fetchTournaments()).running.filter((tournament) => tournament.format === `duel` && !tournament.test).length;

function levelOf(bot: BotListing | null, id: string | null): Level | null {
    if (bot === null || id === null || bot.levels === null || id === bot.levels.default) return null;
    return bot.levels.list.find((level) => level.id === id) ?? null;
}

function reasonLine(bot: BotListing, reason: BotReason, other: BotListing | null): string {
    if (reason === `offline`) return text.roundRobins.gone(bot.name);
    return text.duels.slot.unready(bot.name, reasonText(reason, other === null ? [] : [other.name]));
}

/**
 * Home's duel: two slots that open the same bot list as Tournament, and
 * Start, which sets a duel or a test up with the games last picked there
 * and the defaults; with fewer than two bots ready, nothing.
 */
export function HomeDuel({ bots, me }: { bots: readonly BotListing[] | null; me: Me | undefined }) {
    const states = useBotStates();
    const live = useAsync(loadLive).data;
    const paused = useSiteStatus() === `paused`;
    const viewer = me?.kind === `user` ? me.name : null;
    const reads = { reserved: states.reserved, states: states.states, viewer };
    if (bots === null || me === undefined) return null;
    if (bots.filter((bot) => eventReadiness(bot, [], reads) === null).length < tournamentBotsMin) return null;
    return <DuelCard bots={bots} me={me} reads={reads} live={live} paused={paused} onRefused={states.reload} />;
}

function DuelCard({
    bots,
    me,
    reads,
    live,
    paused,
    onRefused,
}: {
    bots: readonly BotListing[];
    me: Me;
    reads: Parameters<typeof eventReadiness>[2];
    live: number | null;
    paused: boolean;
    onRefused: () => void;
}) {
    const ids = useId();
    const [slots, setSlots] = useState<Readonly<Record<SlotKey, string | null>>>({ first: null, second: null });
    const [levels, setLevels] = useState<Readonly<Record<SlotKey, string | null>>>({ first: null, second: null });
    const [picking, setPicking] = useState<SlotKey | null>(null);
    const [outcome, setOutcome] = useState<Outcome>({ kind: `idle` });
    const slotList = useRef<HTMLUListElement>(null);
    // The slot a bot was just added to, whose next control takes focus once the list is gone.
    const added = useRef<SlotKey | null>(null);
    const find = useCallback((name: string | null) => (name === null ? null : (bots.find((bot) => nameKeyOf(bot.name) === nameKeyOf(name)) ?? null)), [bots]);
    const bot = { first: find(slots.first), second: find(slots.second) };
    const { first, second } = bot;
    const picked = { first: levelOf(first, levels.first), second: levelOf(second, levels.second) };
    const viewer = reads.viewer;
    const test = first !== null && second !== null && kindOf(first, second) === `test`;
    const choices = readTournamentChoices();
    const wanted = test ? choices.testGames : choices.duelGames;
    const reach = countsInReach(tournamentBotsMin, test);
    const games = reach.includes(wanted) ? wanted : ([...reach].reverse().find((count) => count <= wanted) ?? 2);
    const clock = first !== null && second !== null ? defaultFieldClock([first, second], null) : null;
    const warningOf = (subject: BotListing, other: BotListing | null) => {
        const why = eventReadiness(subject, other === null ? [] : [other], reads);
        return why === null ? null : reasonLine(subject, why, other);
    };
    const warnings = { first: first === null ? null : warningOf(first, second), second: second === null ? null : warningOf(second, first) };
    const signedIn = me !== null && me.kind === `user`;
    const waits = warnings.first !== null || warnings.second !== null;
    const blocked = paused || !signedIn || first === null || second === null || clock === null || waits || outcome.kind === `sending`;
    const target: SlotKey | null = first === null ? `first` : second === null ? `second` : null;
    const words = text.duels.home;

    // A link that names a bot no longer listed leaves its slot empty.
    useEffect(() => {
        if (slots.first !== null && first === null) setSlots((held) => ({ ...held, first: null }));
        if (slots.second !== null && second === null) setSlots((held) => ({ ...held, second: null }));
    }, [slots, first, second]);

    // A bot added hands focus to the next empty slot's Add, else to the filled slot's Remove, since the button that opened the list may be gone.
    useEffect(() => {
        const slot = added.current;
        const list = slotList.current;
        if (slot === null || list === null) return;
        added.current = null;
        const next = list.querySelector<HTMLElement>(`[data-slot='${otherSlot(slot)}'] .slot-empty-add`) ?? list.querySelector<HTMLElement>(`[data-slot='${slot}'] .slot-remove`);
        next?.focus();
    });

    async function start() {
        if (blocked) return;
        setOutcome({ kind: `sending` });
        try {
            const created = await createTournament({
                bots: [
                    { name: first.name, ...(picked.first === null ? {} : { level: picked.first.id }) },
                    { name: second.name, ...(picked.second === null ? {} : { level: picked.second.id }) },
                ],
                gamesPerPair: games,
                openingPlies: defaultTournamentOpening,
                timeControl: clock,
            });
            navigate(tournamentPagePath(created.id));
        } catch (cause) {
            const why = (name: string) => {
                const subject = nameKeyOf(name) === nameKeyOf(first.name) ? first : second;
                return eventReadiness(subject, [subject === first ? second : first], reads);
            };
            setOutcome({ kind: `refused`, line: tournamentRefusal(cause, why, test ? `test` : `duel`).line });
            onRefused();
        }
    }

    const slotView = (slot: SlotKey) => {
        const held = bot[slot];
        if (held === null) {
            return (
                <EmptySlot
                    hint=""
                    target={target === slot}
                    label={`${text.duels.slot.add}, ${slot === `first` ? text.duels.slot.first : text.duels.slot.second}`}
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
                showVersion={test}
                warning={warnings[slot]}
                onLevel={(id) => {
                    setLevels((current) => ({ ...current, [slot]: id }));
                }}
                onChange={() => {
                    setPicking(slot);
                }}
                onRemove={() => {
                    setSlots((held) => ({ ...held, [slot]: null }));
                    setLevels((held) => ({ ...held, [slot]: null }));
                    setOutcome({ kind: `idle` });
                }}
            />
        );
    };

    const all = (place: string) => <Link to={gamesTournamentsPath()}>{place}</Link>;
    return (
        <div className="home-duel">
            <section aria-labelledby={`${ids}-title`}>
                <header className="home-duel-head">
                    <h2 id={`${ids}-title`}>{words.title}</h2>
                    <p className="note">{live === null || live === 0 ? words.place(all) : words.live(live, all)}</p>
                </header>
                <ul ref={slotList} className="slots home-duel-slots">
                    <li data-slot="first">{slotView(`first`)}</li>
                    <li aria-hidden="true">
                        <VsCell />
                    </li>
                    <li data-slot="second">{slotView(`second`)}</li>
                </ul>
                {!signedIn ? (
                    <div className="duel-start">
                        <p className="note">{me === null ? text.roundRobins.signedOut : text.roundRobins.guest}</p>
                        <DiscordSignIn next="/" guest={me !== null} />
                    </div>
                ) : first === null || second === null ? null : (
                    <div className="duel-start">
                        {clock === null ? null : (
                            <p className="note">
                                {words.terms(games, clockText(clock), test ? words.test : words.unrated, (place) => (
                                    <Link to={tournamentSetupPath({ bots: [{ name: first.name, level: picked.first?.id ?? null }, { name: second.name, level: picked.second?.id ?? null }], games: null, clock: null, opening: null })}>{place}</Link>
                                ))}
                            </p>
                        )}
                        <button type="button" className="btn btn-primary" aria-disabled={blocked ? `true` : undefined} onClick={() => void start()}>
                            {test ? text.roundRobins.start.test : text.roundRobins.start.duel}
                        </button>
                        <div role="status">
                            {outcome.kind === `sending` ? <p className="sr-only">{text.roundRobins.starting}</p> : null}
                            {outcome.kind === `refused` ? <p className="start-refusal">{outcome.line}</p> : null}
                        </div>
                        {paused ? <p className="note">{text.roundRobins.errors.paused}</p> : waits ? <p className="note">{text.roundRobins.startWaits}</p> : null}
                    </div>
                )}
            </section>
            {picking === null ? null : (
                <BotPicker
                    bots={bots}
                    reads={reads}
                    mode={{
                        kind: `one`,
                        slot: picking,
                        other: bot[otherSlot(picking)],
                        current: bot[picking],
                        onAdd: (next) => {
                            added.current = picking;
                            setSlots((held) => ({ ...held, [picking]: next.name }));
                            setLevels((held) => ({ ...held, [picking]: null }));
                            setPicking(null);
                            setOutcome({ kind: `idle` });
                        },
                    }}
                    onClose={() => {
                        setPicking(null);
                    }}
                />
            )}
        </div>
    );
}
