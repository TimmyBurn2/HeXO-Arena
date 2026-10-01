import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { nameKeyOf, playMeta, type BotListing, type OpeningPlies, type TimeControl } from '@hexo-arena/contract';
import { fetchBots, limitedFor } from '../api/client';
import { liveRefreshMs } from '../api/refresh';
import { BotBadge, Rating } from '../components/player';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { useMe } from '../me';
import { ClockPicker } from '../play/ClockPicker';
import { OpeningRow } from '../play/OpeningRow';
import { OpponentSheet, RosterList, type PickedBy } from '../play/Roster';
import { StartArea } from '../play/StartArea';
import { clockFor, clockFromParam, openingFromParam, playPath, preselect, readinessOf, readPlayed, rosterOf } from '../play/setup';
import { Link } from '../router/Link';
import { routePath } from '../router/route';
import { subscribe, useRoute } from '../router/use-route';
import { siteStatusStore } from '../site-status';
import { text } from '../text';
import { useDocumentMeta } from '../use-document-meta';
import './PlayScreen.css';

// The bot list has no stream of its own,
// so the page reads it again on the live games' beat while it is in view,
// and at once after a refusal on the bot's side.
function useBotList() {
    const [bots, setBots] = useState<BotListing[] | null>(null);
    const [reads, setReads] = useState(0);
    const [failed, setFailed] = useState(false);
    const [limited, setLimited] = useState<number | null>(null);
    const reload = useCallback(async () => {
        try {
            setBots(await fetchBots(false));
            setReads((count) => count + 1);
            setFailed(false);
        } catch (cause) {
            setFailed(true);
            setLimited(limitedFor(cause));
        }
    }, []);
    useEffect(() => {
        void reload();
        const timer = setInterval(() => {
            if (document.visibilityState === `visible`) void reload();
        }, liveRefreshMs);
        function onVisible() {
            if (document.visibilityState === `visible`) void reload();
        }
        document.addEventListener(`visibilitychange`, onVisible);
        return () => {
            clearInterval(timer);
            document.removeEventListener(`visibilitychange`, onVisible);
        };
    }, [reload]);
    return { bots, reads, failed, limited, reload };
}

function readAsked() {
    const params = new URLSearchParams(window.location.search);
    return { bot: params.get(`bot`), clock: clockFromParam(params.get(`clock`)), opening: openingFromParam(params.get(`opening`)) };
}

/**
 * Pick a bot and a clock and start a game:
 * the ready bots beside a card holding the setup,
 * the card alone with a sheet for the bots on phones.
 * The address follows the setup, so a sign-in comes back to it and a link shares it.
 */
export function PlayScreen() {
    const route = useRoute();
    const [asked, setAsked] = useState(readAsked);
    const [played] = useState(readPlayed);
    const list = useBotList();
    const me = useMe();
    const paused = useSyncExternalStore(siteStatusStore.subscribe, siteStatusStore.read, siteStatusStore.read) === `paused`;
    const [picked, setPicked] = useState<string | null>(null);
    const [opened, setOpened] = useState<string | null>(null);
    // The bot the card showed that then left the list, named in a line until the person picks.
    const [lost, setLost] = useState<string | null>(null);
    const [shown, setShown] = useState<string[]>([]);
    // Counts the person's own picks, so the start area tells them from the list's changes.
    const [choices, setChoices] = useState(0);
    const [picks, setPicks] = useState<TimeControl | null>(asked.clock);
    const [opening, setOpening] = useState<OpeningPlies>(asked.opening);
    const [sheet, setSheet] = useState(false);
    const [visit, setVisit] = useState(0);

    // The route stays the same when the nav's Play or Back lands on another setup,
    // so the page reads the address again then;
    // its own replaced address never notifies.
    useEffect(
        () =>
            subscribe(() => {
                if (window.location.pathname !== routePath({ name: `play` })) return;
                const next = readAsked();
                setAsked(next);
                setPicked(null);
                setOpened(null);
                setLost(null);
                setShown([]);
                setPicks(next.clock);
                setOpening(next.opening);
                setSheet(false);
                setVisit((count) => count + 1);
            }),
        [],
    );

    const bots = list.bots;
    const ready = bots !== null && me.status === `ready`;
    const find = (name: string | null) => (name === null || bots === null ? null : (bots.find((entry) => nameKeyOf(entry.name) === nameKeyOf(name)) ?? null));
    const pickedBot = find(picked);
    const openedBot = find(opened);
    // Until the person picks, the page stays on the bot it opened on,
    // so a list read after a refusal never swaps the card under the line that explains it.
    // A bot picked or opened on that leaves the list gives way, once, to a new preselect the page then stays on,
    // and its name stays in a line;
    // listed again before the person picks, it takes the card back.
    const rating = me.status === `ready` && me.me?.kind === `user` ? me.me.rating : null;
    const fallback =
        ready && pickedBot === null && openedBot === null ? preselect(bots, picked === null && lost === null ? asked.bot : null, played.opponent, rating) : null;
    const bot = pickedBot ?? openedBot ?? fallback;
    useEffect(() => {
        if (bots === null) return;
        if (picked !== null && find(picked) === null) {
            setLost(picked);
            setPicked(null);
            setOpened(null);
        } else if (picked === null && opened !== null && find(opened) === null) {
            setLost(opened);
            setOpened(null);
        } else if (picked === null && lost !== null && find(lost) !== null) {
            setOpened(lost);
            setLost(null);
        } else if (picked === null && opened === null && fallback !== null) {
            setOpened(fallback.name);
        }
    });
    // A bot the card showed while it was not ready keeps its row for the visit,
    // so picking another never moves the list under the pointer.
    useEffect(() => {
        if (bot !== null && readinessOf(bot) !== `ready` && !shown.includes(bot.name)) setShown([...shown, bot.name]);
    }, [bot, shown]);
    const unlisted = picked === null && lost === null && asked.bot !== null && bots !== null && find(asked.bot) === null ? asked.bot : null;
    // A lost bot listed again needs no line.
    const gone = lost !== null ? (find(lost) === null ? lost : null) : unlisted;
    const notice = gone === null ? null : text.play.errors.not_found(gone);
    // The clock picked stands while the bot takes it; otherwise the bot's default does.
    const clock = bot === null ? null : clockFor(bot, picks, played.clock);

    // The address follows the setup, without a history entry per change.
    const path = ready ? playPath(bot?.name ?? null, clock, opening) : null;
    // A new visit writes it too, for a nav link that left a bare address on the same setup.
    useEffect(() => {
        if (path !== null) window.history.replaceState(window.history.state, ``, path);
    }, [path, visit]);

    const meta = playMeta(bot?.name);
    useDocumentMeta(route, meta.title, meta.description);

    function choose(next: BotListing, from: PickedBy) {
        setPicked(next.name);
        setLost(null);
        setChoices((count) => count + 1);
        if (from === `pointer`) setSheet(false);
    }

    if (!ready) {
        return (
            <>
                <h1 className="screen-title">{text.play.title}</h1>
                {list.failed && bots === null ? <ErrorFrame sentence={text.play.listFailed} onRetry={() => void list.reload()} wait={list.limited} /> : <SkeletonRows />}
            </>
        );
    }
    if (bots.length === 0) return <Empty kind="none" />;
    if (bot === null || clock === null) return <Empty kind="unready" />;
    const roster = rosterOf(bots, [...(asked.bot === null ? [] : [asked.bot]), ...shown, bot.name]);

    return (
        <>
            <h1 className="screen-title">{text.play.title}</h1>
            <div className="play-layout">
                <section className="play-roster" aria-labelledby="opponent-label">
                    <div className="block-head">
                        <h2 className="play-label" id="opponent-label">
                            {text.play.opponent}
                        </h2>
                        <span className="note">{text.play.readyCount(roster.ready.length)}</span>
                    </div>
                    <RosterList roster={roster} chosen={bot} name="opponent" labelledBy="opponent-label" onChoose={choose} />
                </section>
                <SetupCard
                    key={visit}
                    bot={bot}
                    clock={clock}
                    last={played.clock}
                    opening={opening}
                    path={playPath(bot.name, clock, opening)}
                    paused={paused}
                    notice={notice}
                    choices={choices}
                    reads={list.reads}
                    onClock={(next) => {
                        setPicks(next);
                        setChoices((count) => count + 1);
                    }}
                    onAdjust={setPicks}
                    onOpening={(next) => {
                        setOpening(next);
                        setChoices((count) => count + 1);
                    }}
                    onChange={() => {
                        setSheet(true);
                    }}
                    onRefused={() => void list.reload()}
                />
            </div>
            {sheet ? (
                <OpponentSheet
                    onClose={() => {
                        setSheet(false);
                    }}
                >
                    <RosterList roster={roster} chosen={bot} name="sheet-opponent" labelledBy="sheet-title" onChoose={choose} />
                </OpponentSheet>
            ) : null}
        </>
    );
}

function Empty({ kind }: { kind: `none` | `unready` }) {
    return (
        <>
            <h1 className="screen-title">{text.play.title}</h1>
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

function SetupCard({
    bot,
    clock,
    last,
    opening,
    path,
    paused,
    notice,
    choices,
    reads,
    onClock,
    onAdjust,
    onOpening,
    onChange,
    onRefused,
}: {
    bot: BotListing;
    clock: TimeControl;
    last: TimeControl | null;
    opening: OpeningPlies;
    // The setup's own address, where a sign-in from the card returns.
    path: string;
    paused: boolean;
    notice: string | null;
    choices: number;
    reads: number;
    onClock: (clock: TimeControl) => void;
    onAdjust: (clock: TimeControl) => void;
    onOpening: (opening: OpeningPlies) => void;
    onChange: () => void;
    onRefused: () => void;
}) {
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
                        <button type="button" className="btn btn-ghost btn-sm" aria-label={text.play.changeOpponent} onClick={onChange}>
                            {text.play.change}
                        </button>
                    </div>
                </div>
                <ClockPicker bot={bot} clock={clock} last={last} onClock={onClock} onAdjust={onAdjust} />
                <OpeningRow opening={opening} onOpening={onOpening} />
                <StartArea bot={bot} clock={clock} opening={opening} path={path} paused={paused} notice={notice} choices={choices} reads={reads} onRefused={onRefused} />
            </section>
        </div>
    );
}
