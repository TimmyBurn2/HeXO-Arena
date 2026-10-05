import { useCallback, useEffect, useReducer, useRef, useState, type Dispatch } from 'react';
import { nameKeyOf, playMeta, type BotListing } from '@hexo-arena/contract';
import { fetchBots } from '../api/client';
import { liveRefreshMs } from '../api/refresh';
import { useAsync } from '../api/use-async';
import { BotBadge, Rating } from '../components/player';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { useMe } from '../me';
import { ClockPicker } from '../play/ClockPicker';
import { useExpectedScore } from '../play/expected';
import { OpeningRow } from '../play/OpeningRow';
import { PlayHead } from '../play/PlayHead';
import { useReserved } from '../play/reserved';
import { RatedRow } from '../play/RatedRow';
import { OpponentSheet, RosterList, type PickedBy } from '../play/Roster';
import { StartArea } from '../play/StartArea';
import { StrengthRow } from '../play/StrengthRow';
import {
    clockFor,
    clockFromParam,
    levelFor,
    openingFromParam,
    ownedBy,
    playPath,
    preselect,
    readinessOf,
    readPlayed,
    rosterOf,
    writeRated,
    type Played,
} from '../play/setup';
import { firstSetup, settle, setupReducer, shownBot, type Asked, type CardSetup, type ListFacts, type SetupAction } from '../play/setup-state';
import { Link } from '../router/Link';
import { routePath } from '../router/route';
import { subscribe, useRoute } from '../router/use-route';
import { useSiteStatus } from '../site-status';
import { text } from '../text';
import { useDocumentMeta } from '../use-document-meta';
import './PlayScreen.css';

// The bot list has no stream of its own,
// so the page reads it again on the bot lists' beat while it is in view,
// and at once after a refusal on the bot's side.
function useBotList() {
    const reserved = useReserved();
    // Each list carries how many reads have landed, so a line about the bot's state knows a newer one.
    const landed = useRef(0);
    const load = useCallback(async () => {
        const bots = await fetchBots(false);
        landed.current += 1;
        return { bots, reads: landed.current };
    }, []);
    const list = useAsync(load, { every: liveRefreshMs });
    const reload = () => {
        reserved.reload();
        list.reload();
    };
    return { bots: list.data?.bots ?? null, reserved: reserved.bots, holder: reserved.tournament, reads: list.data?.reads ?? 0, failed: list.error, limited: list.limited, reload };
}

type BotList = ReturnType<typeof useBotList>;

// A level in the address belongs to the bot the address names.
function readAsked(): Asked {
    const params = new URLSearchParams(window.location.search);
    const bot = params.get(`bot`);
    const level = params.get(`level`);
    return {
        bot,
        clock: clockFromParam(params.get(`clock`)),
        opening: openingFromParam(params.get(`opening`)),
        level: bot === null || level === null ? null : { bot, id: level },
    };
}

/**
 * Pick a bot and a clock and start a game:
 * the ready bots beside a card holding the setup,
 * the card alone with a sheet for the bots on phones.
 * The address follows the setup, so a sign-in comes back to it and a link shares it.
 */
export function PlayScreen() {
    const [visit, setVisit] = useState(0);
    const list = useBotList();
    const [played] = useState(readPlayed);
    // The Rated switch as this browser last left it, off until turned on; it stands across visits.
    const [rated, setRated] = useState(played.rated);

    // The route stays the same when the nav's Play or Back lands on another setup,
    // so the setup starts over from the address then;
    // its own replaced address never notifies.
    useEffect(
        () =>
            subscribe(() => {
                if (window.location.pathname === routePath({ name: `play` })) setVisit((count) => count + 1);
            }),
        [],
    );

    return (
        <Visit
            key={visit}
            list={list}
            played={played}
            rated={rated}
            onRated={(next) => {
                setRated(next);
                writeRated(next);
            }}
        />
    );
}

function Visit({ list, played, rated: ratedPick, onRated }: { list: BotList; played: Played; rated: boolean; onRated: (rated: boolean) => void }) {
    const route = useRoute();
    const [asked] = useState(readAsked);
    const [state, dispatch] = useReducer(setupReducer, asked, firstSetup);
    const me = useMe();
    const paused = useSiteStatus() === `paused`;
    const bots = list.bots;
    const ready = bots !== null && me.status === `ready`;
    const find = (name: string) => (bots === null ? null : (bots.find((entry) => nameKeyOf(entry.name) === nameKeyOf(name)) ?? null));
    const rating = me.status === `ready` && me.me?.kind === `user` ? me.me.rating : null;
    // Only someone signed in has a rating to stake, so only they see the switch, and only they own bots.
    const viewer = me.status === `ready` && me.me?.kind === `user` ? me.me.name : null;
    const facts: ListFacts = {
        find,
        ready: (listed) => readinessOf(listed, list.reserved, viewer) === `ready`,
        open: (fromAddress) => (ready ? preselect(bots, fromAddress ? asked.bot : null, played.opponent, rating, list.reserved, viewer) : null),
    };
    // Each list read settles the setup before the card draws, so a bot that left the list never shows.
    const setup = bots === null ? state : settle(state, facts);
    if (setup !== state) dispatch({ kind: `settle`, facts });
    const bot = shownBot(setup, facts);
    const unlisted = setup.picked === null && setup.lost === null && asked.bot !== null && bots !== null && find(asked.bot) === null ? asked.bot : null;
    const gone = setup.lost ?? unlisted;
    // The clock picked stands while the bot takes it; otherwise the bot's default does.
    const clock = bot === null ? null : clockFor(bot, setup.clock, played.clock);
    // A strength stands for the bot it was picked for, while the bot still offers it; otherwise the default does.
    const level = bot === null ? null : levelFor(bot, setup.strength);

    // The address follows the setup, without a history entry per change; a new visit writes it too, for a nav link that left a bare address on the same setup.
    const path = ready ? playPath(bot?.name ?? null, clock, setup.opening, level) : null;
    useEffect(() => {
        if (path !== null) window.history.replaceState(window.history.state, ``, path);
    }, [path]);

    const meta = playMeta(bot?.name);
    useDocumentMeta(route, meta.title, meta.description);

    if (!ready) {
        return (
            <>
                <PlayHead view="bot" />
                {list.failed && bots === null ? <ErrorFrame sentence={text.play.listFailed} onRetry={list.reload} wait={list.limited} /> : <SkeletonRows />}
            </>
        );
    }
    if (bots.length === 0) return <Empty kind="none" />;
    if (bot === null || clock === null) return <Empty kind="unready" />;
    const roster = rosterOf(bots, [...(asked.bot === null ? [] : [asked.bot]), ...setup.shown, bot.name], list.reserved, viewer);
    const own = ownedBy(bot, viewer);
    const switchOn = viewer === null ? null : ratedPick;
    const card: CardSetup = {
        bot,
        clock,
        level,
        opening: setup.opening,
        own,
        switchOn,
        rated: switchOn === true && level === null && !own,
        last: played.clock,
        path: playPath(bot.name, clock, setup.opening, level),
        notice: gone === null ? null : text.play.errors.not_found(gone),
        choices: setup.choices,
    };
    const choose = (next: BotListing, from: PickedBy) => {
        dispatch({ kind: `pick`, bot: next.name, from });
    };

    return (
        <>
            <PlayHead view="bot" />
            <div className="play-layout">
                <section className="play-roster" aria-labelledby="opponent-label">
                    <div className="block-head">
                        <h2 className="play-label" id="opponent-label">
                            {text.play.opponent}
                        </h2>
                        <span className="note">{text.play.readyCount(roster.ready.length)}</span>
                    </div>
                    <RosterList roster={roster} reserved={list.reserved} viewer={viewer} chosen={bot} name="opponent" labelledBy="opponent-label" onChoose={choose} />
                </section>
                <SetupCard
                    setup={card}
                    list={list}
                    paused={paused}
                    dispatch={dispatch}
                    onRated={(next) => {
                        onRated(next);
                        dispatch({ kind: `rated` });
                    }}
                />
            </div>
            {setup.sheet ? (
                <OpponentSheet
                    onClose={() => {
                        dispatch({ kind: `sheet`, open: false });
                    }}
                >
                    <RosterList roster={roster} reserved={list.reserved} viewer={viewer} chosen={bot} name="sheet-opponent" labelledBy="sheet-title" onChoose={choose} />
                </OpponentSheet>
            ) : null}
        </>
    );
}

function Empty({ kind }: { kind: `none` | `unready` }) {
    return (
        <>
            <PlayHead view="bot" />
            {kind === `none` ? (
                <div className="empty">
                    <h2>{text.play.empty.heading}</h2>
                    <p>{text.play.empty.body}</p>
                    <div className="actions">
                        <Link to="/connect" className="btn btn-primary">
                            {text.play.empty.build}
                        </Link>
                    </div>
                </div>
            ) : (
                <div className="empty">
                    <h2>{text.play.noneReady.heading}</h2>
                    <p>{text.play.noneReady.body}</p>
                    <div className="actions">
                        <Link to="/bots" className="btn btn-primary">
                            {text.play.noneReady.browse}
                        </Link>
                        <Link to="/connect" className="btn btn-ghost">
                            {text.play.noneReady.build}
                        </Link>
                    </div>
                </div>
            )}
        </>
    );
}

function SetupCard({ setup, list, paused, dispatch, onRated }: { setup: CardSetup; list: BotList; paused: boolean; dispatch: Dispatch<SetupAction>; onRated: (rated: boolean) => void }) {
    const { bot, level, own, switchOn, rated } = setup;
    // The expected score is a rated game's; practice at another level, a game with Rated off, and one against the person's own bot have none.
    const expected = useExpectedScore(bot.name);
    return (
        <div className="play-setup-lift">
            <section className="play-setup" aria-label={text.play.setup}>
                <header className="setup-head">
                    <h2>{text.play.cardTitle(bot.name)}</h2>
                    <span className="setup-rating">
                        <Rating value={bot.rating} provisional={bot.provisional} />
                    </span>
                </header>
                <div className="bot-choice-row">
                    <div className="bot-choice">
                        <p className="play-label">{text.play.opponent}</p>
                        <p className="bot-choice-name">
                            <strong>{bot.name}</strong>
                            <BotBadge />
                        </p>
                    </div>
                    <div className="bot-choice-side">
                        <span className="setup-rating">
                            <Rating value={bot.rating} provisional={bot.provisional} />
                        </span>
                        <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            aria-label={text.play.changeOpponent}
                            onClick={() => {
                                dispatch({ kind: `sheet`, open: true });
                            }}
                        >
                            {text.play.change}
                        </button>
                    </div>
                </div>
                {rated && expected.kind === `ready` ? <p className="note setup-expected">{text.play.expected(bot.name, text.rundown.score(expected.score))}</p> : null}
                {/* the line's own words hold its room while the records load, so the clock below never moves */}
                {rated && expected.kind === `loading` ? (
                    <p className="note setup-expected setup-expected-pending" aria-hidden="true">
                        {text.play.expected(bot.name, text.rundown.score(0))}
                    </p>
                ) : null}
                {/* practice and Rated off keep the line's place, saying why the score is gone, so a pick never moves the row under the pointer */}
                {level !== null && expected.kind !== `none` ? <p className="note setup-expected">{text.play.practiceScore(level.label)}</p> : null}
                {level === null && own && expected.kind !== `none` ? <p className="note setup-expected">{text.play.ownScore}</p> : null}
                {level === null && !own && switchOn === false && expected.kind !== `none` ? <p className="note setup-expected">{text.play.unratedScore}</p> : null}
                <ClockPicker
                    bot={bot}
                    clock={setup.clock}
                    last={setup.last}
                    onClock={(clock) => {
                        dispatch({ kind: `clock`, clock });
                    }}
                    onAdjust={(clock) => {
                        dispatch({ kind: `adjust`, clock });
                    }}
                />
                <StrengthRow
                    bot={bot}
                    level={level}
                    onLevel={(id) => {
                        dispatch({ kind: `level`, level: { bot: bot.name, id } });
                    }}
                />
                {switchOn === null ? null : <RatedRow rated={switchOn} practice={level !== null} own={own} bot={bot.name} onRated={onRated} />}
                <OpeningRow
                    opening={setup.opening}
                    onOpening={(opening) => {
                        dispatch({ kind: `opening`, opening });
                    }}
                />
                <StartArea setup={setup} paused={paused} reads={list.reads} reserved={list.reserved} holder={list.holder} onRefused={list.reload} />
            </section>
        </div>
    );
}
