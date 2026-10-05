import { Fragment, useCallback, useId } from 'react';
import { analysisPagePath, botMeta, levelFacts, nameKeyOf, notFoundMeta, pagePath, type Accepts, type Analyzer, type BotListing, type Levels, type LiveGameEntry } from '@hexo-arena/contract';
import { fetchBots } from '../api/client';
import { eventReadiness, reasonText } from '../play/readiness';
import { emptyTournamentSetup, tournamentSetupPath } from '../tournaments/setup';
import { useBotStates } from '../tournaments/use-setup-reads';
import { useAsync } from '../api/use-async';
import { OwnerPanel } from '../components/OwnerPanel';
import { ReportLine } from '../components/ReportLine';
import { PlayerHistory } from '../games/PlayerHistory';
import { BotEvents } from '../players/BotEvents';
import { PendingPlate } from '../players/PendingPlate';
import { PlayerBlocks } from '../players/PlayerBlocks';
import { LiveGameGrid } from '../live/LiveGameCard';
import { useLiveReplay } from '../live/use-live-replay';
import { BotBadge, OpenTag, PlayerName, PresenceDot, Rating } from '../components/player';
import { useMe } from '../me';
import { turnWindowOf } from '../play/accepts';
import { ownedBy, playBotPath, readinessOf, type Readiness } from '../play/setup';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { Link } from '../router/Link';
import { botApiRepository } from '../site-links';
import { useRoute } from '../router/use-route';
import { text } from '../text';
import { useDocumentMeta } from '../use-document-meta';
import './BotScreen.css';

export function BotScreen({ name }: { name: string }) {
    const route = useRoute();
    const load = useCallback(async () => fetchBots(false), []);
    const { data, error, limited, loading, reload } = useAsync(load);
    const bot = data?.find((entry) => nameKeyOf(entry.name) === nameKeyOf(name));

    // A bot the list does not hold reads as any missing page, as the
    // server's preview of it does.
    const meta = bot !== undefined ? botMeta(bot) : data !== null ? notFoundMeta : undefined;
    useDocumentMeta(route, meta?.title, meta?.description);

    if (loading && data === null) {
        return (
            <>
                <PendingPlate name={name} tag={<BotBadge />} />
                <SkeletonRows />
            </>
        );
    }
    if (error && data === null) {
        return (
            <>
                <PendingPlate name={name} tag={<BotBadge />} />
                <ErrorFrame sentence={text.bot.failed} onRetry={reload} wait={limited} />
            </>
        );
    }
    if (data !== null && bot === undefined) return <MissingBot name={name} />;
    if (bot === undefined) return null;

    return <BotProfile bot={bot} onChanged={reload} />;
}

function MissingBot({ name }: { name: string }) {
    return (
        <div className="empty">
            <h1>{text.bot.missing(name)}</h1>
            <div className="actions">
                <Link to="/bots" className="btn btn-ghost">
                    {text.bot.browse}
                </Link>
            </div>
        </div>
    );
}

function BotProfile({ bot, onChanged }: { bot: BotListing; onChanged: () => void }) {
    const me = useMe();
    const ids = useId();
    const botStates = useBotStates();
    const botState = botStates.states.find((state) => nameKeyOf(state.name) === nameKeyOf(bot.name)) ?? null;
    const viewer = me.status === `ready` && me.me?.kind === `user` ? me.me.name : null;
    const owned = ownedBy(bot, viewer);
    // The owner plays their own bot while it is online, open to others or not.
    const readiness = readinessOf(bot, botStates.reserved, viewer);
    const blockedReasons = {
        busy: text.play.busy,
        tournament: text.play.inTournament,
        offline: text.bot.offlineReason,
        closed: text.bot.closedReason,
        nothing: text.bot.noClockReason,
    };
    // Start a duel opens a setup only for a bot the picker would add, and says why not as the picker does;
    // beside no other bot, no reason is a clock's.
    const duelWhy = eventReadiness(bot, [], { reserved: botStates.reserved, states: botStates.states, viewer });
    const duelReason = duelWhy === null || duelWhy === `clock` ? null : reasonText(duelWhy, []);
    const reason = readiness !== `ready` ? blockedReasons[readiness] : duelReason;

    return (
        <>
            {/* The lift sits on a wrapper because the cut clips it. */}
            <div className="bot-lift">
                <header className="bot-plate">
                    <div className="bot-title">
                        <h1>{bot.name}</h1>
                        <BotBadge />
                    </div>
                    <div className="bot-rating">
                        <span className="bot-rating-number">
                            <Rating value={bot.rating} provisional={bot.provisional} />
                        </span>
                        <span className="note">{bot.provisional ? text.bot.provisionalRating : text.bot.rating}</span>
                    </div>
                    <div className="bot-facts">
                        <span className="player-cell">
                            <PresenceDot online={bot.online} />
                            {bot.online ? text.bot.online : text.bot.offline}
                        </span>
                        <OpenTag open={bot.openForChallenges} />
                        {bot.ownerName === null ? null : <span>{text.bot.by(<PlayerName name={bot.ownerName} kind="human" />)}</span>}
                    </div>
                    <div className="play-strip">
                        <div className="play-strip-go">
                            {readiness === `ready` ? (
                                <Link to={playBotPath(bot.name)} className="btn btn-primary">
                                    {text.bot.play(bot.name)}
                                </Link>
                            ) : (
                                <button type="button" className="btn btn-primary" disabled aria-describedby={`${ids}-why`}>
                                    {text.bot.play(bot.name)}
                                </button>
                            )}
                            {duelReason === null ? (
                                <Link to={tournamentSetupPath({ ...emptyTournamentSetup, bots: [{ name: bot.name, level: null }] })} className="btn btn-ghost">
                                    {text.duels.bot.start}
                                </Link>
                            ) : (
                                <button type="button" className="btn btn-ghost" disabled aria-describedby={`${ids}-why`}>
                                    {text.duels.bot.start}
                                </button>
                            )}
                            {reason === null ? null : (
                                <span className="note play-reason" id={`${ids}-why`}>
                                    {reason}
                                </span>
                            )}
                        </div>
                        <AcceptsLine accepts={bot.accepts} owned={owned} byOthers={botState?.duelsByOthers ?? null} />
                    </div>
                </header>
            </div>

            {bot.about !== undefined ? <p className="about">{bot.about}</p> : null}
            {bot.levels === null ? null : <StrengthRows bot={bot.name} levels={bot.levels} readiness={readiness} />}
            <BotDetails bot={bot} />
            <PlayingNow bot={bot.name} />
            <BotEvents bot={bot.name} owner={bot.ownerName} />
            <PlayerBlocks name={bot.name} />
            <PlayerHistory player={bot.name} title={text.games.recent} />
            {owned ? <OwnerPanel bot={bot.name} onChanged={onChanged} /> : null}
            <ReportLine subject={pagePath(`bot`, { bot: bot.name })} name={bot.name} />
        </>
    );
}

// The pairs carry no visible heading beside Play, so a group around the
// list names them; the list keeps its own role, so its pairs stay its items.
function AcceptsLine({ accepts, owned, byOthers }: { accepts: Accepts | undefined; owned: boolean; byOthers: boolean | null }) {
    const duels =
        byOthers === null ? null : (
            <div>
                <dt>{text.duels.bot.byOthers}</dt>
                <dd>{byOthers ? text.duels.bot.on : text.duels.bot.off}</dd>
            </div>
        );
    const window = accepts === undefined ? null : turnWindowOf(accepts);
    return (
        <div className="accepts-group" role="group" aria-label={text.bot.accepts}>
            <dl className="accepts-line">
                {accepts === undefined ? (
                    <div>
                        <dt>{text.bot.accepts}</dt>
                        {owned ? (
                            <dd>
                                <p className="accepts-help">
                                    {text.bot.acceptsNothingOwner((words) => (
                                        <a href={botApiRepository} rel="noreferrer" target="_blank">
                                            {words}
                                        </a>
                                    ))}
                                </p>
                            </dd>
                        ) : (
                            <dd>{text.bot.acceptsNothing}</dd>
                        )}
                    </div>
                ) : (
                    <>
                        <div>
                            <dt>{text.bot.turnClock}</dt>
                            <dd>{window === null ? text.bot.no : text.bot.turnWindow(window[0] / 1000, window[1] / 1000)}</dd>
                        </div>
                        <div>
                            <dt>{text.bot.matchClock}</dt>
                            <dd>{accepts.match ? text.bot.yes : text.bot.no}</dd>
                        </div>
                        <div>
                            <dt>{text.bot.unlimited}</dt>
                            <dd>{accepts.unlimited ? text.bot.yes : text.bot.no}</dd>
                        </div>
                    </>
                )}
                {duels}
            </dl>
        </div>
    );
}

// Each strength starts its own game, the rated one the plain game Play
// starts; a bot that cannot start one keeps its rows to read.
function StrengthRows({ bot, levels, readiness }: { bot: string; levels: Levels; readiness: Readiness }) {
    return (
        <section className="levels" aria-labelledby="strength-title">
            <h2 id="strength-title" className="detail-title">
                {text.bot.strength}
            </h2>
            <ol className="level-rows">
                {levels.list.map((level) => {
                    const rated = level.id === levels.default;
                    const facts = levelFacts(level);
                    return (
                        <li key={level.id} className="level-row">
                            <span className="level-name">
                                {level.label}
                                {rated ? <span className="tag">{text.bot.strengthRated}</span> : null}
                            </span>
                            {facts === `` ? null : <span className="level-facts">{facts}</span>}
                            {level.about === undefined ? null : <span className="level-about">{level.about}</span>}
                            {readiness === `ready` ? (
                                <Link to={playBotPath(bot, rated ? null : level)} className="btn btn-ghost btn-sm level-go" ariaLabel={text.bot.playAt(bot, level.label)}>
                                    {text.bots.play}
                                </Link>
                            ) : null}
                        </li>
                    );
                })}
            </ol>
            <p className="note">{text.bot.strengthNote}</p>
        </section>
    );
}

// Analyzer and Source stand unboxed, so a group the bot does not declare
// leaves no hole and a short one no empty surface.
function BotDetails({ bot }: { bot: BotListing }) {
    const repoUrl = bot.repoUrl === `` ? undefined : bot.repoUrl;
    const source = bot.version !== undefined || repoUrl !== undefined;
    if (bot.analyzer === null && !source) return null;
    return (
        <div className="bot-details">
            {bot.analyzer === null ? null : <AnalyzerDetail analyzer={bot.analyzer} />}
            {source ? (
                <section className="detail" aria-labelledby="source-title">
                    <h2 id="source-title" className="detail-title">
                        {text.bot.source}
                    </h2>
                    <dl className="kv">
                        {bot.version !== undefined ? (
                            <>
                                <dt>{text.bot.version}</dt>
                                <dd>{bot.version}</dd>
                            </>
                        ) : null}
                        {repoUrl !== undefined ? (
                            <>
                                <dt>{text.bot.repository}</dt>
                                <dd>
                                    <a href={repoUrl} rel="noreferrer" target="_blank">
                                        <ShortRepo url={repoUrl} />
                                    </a>
                                </dd>
                            </>
                        ) : null}
                    </dl>
                </section>
            ) : null}
        </div>
    );
}

function AnalyzerDetail({ analyzer }: { analyzer: Analyzer }) {
    const words = text.bot.analyzer;
    return (
        <section className="detail" aria-labelledby="analyzer-title">
            <h2 id="analyzer-title" className="detail-title">
                {words.title}
            </h2>
            <dl className="kv">
                <dt>{words.time}</dt>
                <dd>{words.timeValue(analyzer.maxSeconds)}</dd>
                <dt>{words.lines}</dt>
                <dd>{words.linesValue(analyzer.lines)}</dd>
                <dt>{words.when}</dt>
                <dd>{analyzer.whilePlaying ? words.whilePlaying : words.betweenGames}</dd>
                <dt>{words.now}</dt>
                <dd>{analyzer.ready ? words.ready : words.notReady}</dd>
            </dl>
            <p className="note">{words.note((board) => <Link to={analysisPagePath}>{board}</Link>)}</p>
        </section>
    );
}

// Bot names are unique across users and bots, so a bot seat with the name
// is this bot.
function playing(entry: LiveGameEntry, bot: string): boolean {
    return [entry.players.x, entry.players.o].some((player) => player.kind === `bot` && player.name === bot);
}

// Every game the bot plays right now, as boards, from the list the live
// pages read.
function PlayingNow({ bot }: { bot: string }) {
    const games = (useLiveReplay().games ?? []).filter((game) => playing(game.entry, bot));
    if (games.length === 0) return null;
    return (
        <section className="bot-live" aria-labelledby="playing-title">
            <h2 id="playing-title" className="section-title">
                {text.bot.playingNow}
            </h2>
            <LiveGameGrid games={games} level={3} />
        </section>
    );
}

// A narrow column breaks the path after a slash, never inside a name.
function ShortRepo({ url }: { url: string }) {
    return url
        .replace(/^https?:\/\//, ``)
        .split(`/`)
        .map((part, index) => (
            <Fragment key={`${String(index)}-${part}`}>
                {index > 0 ? (
                    <>
                        /<wbr />
                    </>
                ) : null}
                {part}
            </Fragment>
        ));
}
