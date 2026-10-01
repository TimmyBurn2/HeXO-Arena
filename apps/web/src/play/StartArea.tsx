import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { humanGameCooldownSeconds, legalPagePath, type BotListing, type OpeningPlies, type TimeControl } from '@hexo-arena/contract';
import { ApiError, createGame, limitedFor } from '../api/client';
import { DiscordButton } from '../components/DiscordButton';
import { WaitText } from '../components/wait';
import { meStore, useMe } from '../me';
import { Link } from '../router/Link';
import { navigate } from '../router/use-route';
import { siteStatusStore } from '../site-status';
import { text } from '../text';
import { readinessOf, writePlayed } from './setup';

// What the start area last heard back:
// nothing yet, a request in flight,
// a line to show, with the bot and clock the bot's side refused when it did,
// the live-game cap, whose line leads to the games that fill it,
// a wait counting down to a time from the seconds it began with, in its own words,
// or a session that ended, with who held it.
type Outcome =
    | { kind: `idle` }
    | { kind: `sending` }
    | { kind: `line`; text: string; refused: Refused | null }
    | { kind: `capped` }
    | { kind: `wait`; until: number; seconds: number; line: (seconds: number) => string }
    | { kind: `stale`; was: `guest` | `user` };

const botSideCodes = [`bot_busy`, `clock_not_accepted`, `not_open`, `delisted`, `not_found`] as const;
type BotSideCode = (typeof botSideCodes)[number];

function isBotSide(code: string | null): code is BotSideCode {
    return botSideCodes.some((known) => known === code);
}

// A refusal on the bot's side: the bot and clock it was for, and the list reads done when it came.
// It stands until a read after the one it asks for shows that bot ready.
interface Refused {
    bot: string;
    setup: string;
    reads: number;
}

const setupOf = (bot: BotListing, clock: TimeControl) => `${bot.name}:${JSON.stringify(clock)}`;

// A second click of a double click never lands on a control that appeared under the pointer;
// keys click with no detail and pass.
function secondClick(event: MouseEvent): boolean {
    return event.detail > 1;
}

/**
 * The one action and what it waits on, per visitor: Start game for someone
 * signed in or a guest, Play as guest and Sign in for anyone else, with
 * every refusal said in a line.
 */
export function StartArea({
    bot,
    clock,
    opening,
    path,
    paused,
    notice,
    choices,
    reads,
    onRefused,
}: {
    bot: BotListing;
    clock: TimeControl;
    opening: OpeningPlies;
    path: string;
    paused: boolean;
    notice: string | null;
    // How many picks the person has made, so a line gives way to their next one and not to the list's.
    choices: number;
    // How many times the bot list has been read, so a line about the bot's state knows a newer read.
    reads: number;
    onRefused: () => void;
}) {
    const me = useMe();
    const [outcome, setOutcome] = useState<Outcome>({ kind: `idle` });
    const [now, setNow] = useState(() => Date.now());
    const warning = useRef<HTMLParagraphElement>(null);
    // The reads when a refusal arrives, not when Start was pressed, since a read may land while it is out.
    const readsNow = useRef(reads);
    useEffect(() => {
        readsNow.current = reads;
    });
    const state = readinessOf(bot);

    useEffect(() => {
        if (outcome.kind !== `wait`) return;
        const timer = setInterval(() => {
            const at = Date.now();
            setNow(at);
            if (at >= outcome.until) setOutcome({ kind: `idle` });
        }, 1000);
        return () => {
            clearInterval(timer);
        };
    }, [outcome]);

    // A pick by the person is a new try; a line about the last one goes.
    const [lastChoices, setLastChoices] = useState(choices);
    if (choices !== lastChoices) {
        setLastChoices(choices);
        if (outcome.kind === `line` || outcome.kind === `capped`) setOutcome({ kind: `idle` });
    }
    // After a refusal the list may move the bot or the clock;
    // the start then holds until the person picks, so the next press never starts a game nobody chose.
    // A line about the bot goes once a later read shows that setup's bot ready,
    // skipping the read the refusal asks for, which may lag the server's own count.
    const refused = outcome.kind === `line` ? outcome.refused : null;
    const moved = refused !== null && refused.setup !== setupOf(bot, clock);
    if (refused !== null && !moved && reads > refused.reads + 1 && readinessOf(bot) === `ready`) setOutcome({ kind: `idle` });

    const visitor = me.status === `loading` ? null : me.me;
    const stale = outcome.kind === `stale`;
    const warned = stale && visitor === null;

    // The control that was pressed turns into another once the session ends,
    // so focus moves to the warning, and a second press of the same key starts nothing.
    useEffect(() => {
        if (warned) warning.current?.focus();
    }, [warned]);

    function wait(seconds: number, line: (seconds: number) => string) {
        const at = Date.now();
        setNow(at);
        setOutcome({ kind: `wait`, until: at + seconds * 1000, seconds, line });
    }

    async function start(asGuest: boolean) {
        const was = asGuest || visitor?.kind === `guest` ? `guest` : `user`;
        setOutcome({ kind: `sending` });
        if (asGuest) {
            try {
                await meStore.guest();
            } catch (cause) {
                const limited = limitedFor(cause);
                if (limited !== null) {
                    wait(limited, text.play.guestLimited);
                    return;
                }
                setOutcome({ kind: `line`, text: cause instanceof ApiError && cause.code === `guest_limit` ? text.play.guestLimit : text.play.guestFailed, refused: null });
                return;
            }
        }
        try {
            const snapshot = await createGame({ bot: bot.name, timeControl: clock, openingPlies: opening });
            writePlayed(bot.name, clock);
            navigate(`/game/${encodeURIComponent(snapshot.gameId)}`);
        } catch (cause) {
            if (cause instanceof ApiError && cause.status === 401) {
                // The session ended on the server;
                // the page asks again and shows the ways in once it knows,
                // or says the start failed if the session still reads as someone.
                const who = await meStore.refresh();
                setOutcome(who === null ? { kind: `stale`, was } : { kind: `line`, text: text.play.failed, refused: null });
                return;
            }
            const code = cause instanceof ApiError ? cause.code : null;
            if (code === `game_cooldown` && cause instanceof ApiError) {
                wait(cause.retryAfter ?? humanGameCooldownSeconds, text.play.cooldown);
                return;
            }
            const limited = limitedFor(cause);
            if (limited !== null) {
                wait(limited, text.states.tooMany);
                return;
            }
            if (isBotSide(code)) onRefused();
            if (code === `paused`) {
                // The pause began between the site's probes, so the banner learns of it now;
                // once it shows, the banner and the note say it, and a line would repeat them.
                await siteStatusStore.probe();
                if (siteStatusStore.read() === `paused`) {
                    setOutcome({ kind: `idle` });
                    return;
                }
            }
            // The cap's line leads to the games that fill it, so the session is read again for them.
            if (code === `human_busy`) {
                await meStore.refresh();
                setOutcome({ kind: `capped` });
                return;
            }
            const errors = text.play.errors;
            const line =
                code === `paused`
                    ? errors[code]()
                    : code === `bot_busy` || code === `clock_not_accepted` || code === `not_open` || code === `delisted` || code === `not_found`
                      ? errors[code](bot.name)
                      : text.play.failed;
            setOutcome({
                kind: `line`,
                text: line,
                refused: isBotSide(code) ? { bot: bot.name, setup: setupOf(bot, clock), reads: readsNow.current } : null,
            });
        }
    }

    const unavailable = state === `ready` ? null : text.play.unavailable[state](bot.name);
    const cooling = outcome.kind === `wait` ? Math.max(1, Math.ceil((outcome.until - now) / 1000)) : null;
    const blocked = paused || unavailable !== null || cooling !== null || moved || outcome.kind === `sending` || (stale && visitor !== null);
    // Where the list kept the bot and moved its clock, the line says so, whatever the refusal was.
    const outcomeLine =
        outcome.kind === `capped`
            ? text.play.errors.human_busy()
            : outcome.kind !== `line`
              ? null
              : moved && refused.bot === bot.name
                ? text.play.errors.clock_not_accepted(bot.name)
                : outcome.text;
    // A refusal the page then explains, by the bot's state or its absence from the list, is said once.
    const lines = [
        { key: `notice`, text: notice },
        { key: `outcome`, text: unavailable === null && notice === null ? outcomeLine : null },
        { key: `unavailable`, text: unavailable },
    ].filter((line): line is { key: string; text: string } => line.text !== null);

    const page = (to: string) => (words: string) => <Link to={to}>{words}</Link>;
    const primary = (label: string, asGuest: boolean) => (
        <button
            type="button"
            className="btn btn-primary"
            aria-disabled={blocked ? `true` : undefined}
            onClick={(event) => {
                if (secondClick(event) || blocked) return;
                void start(asGuest);
            }}
        >
            {label}
        </button>
    );

    return (
        <div className="start-area">
            {warned ? (
                <p ref={warning} className="warn" role="alert" tabIndex={-1}>
                    {outcome.was === `guest` ? text.play.guestStale : text.play.stale}
                </p>
            ) : null}
            {visitor === null && !stale && !paused ? <p className="note">{text.play.signedOutLead}</p> : null}
            <div role="status" className="start-lines">
                {outcome.kind === `sending` ? <p className="sr-only">{text.play.starting}</p> : null}
                {lines.map((line) => (
                    <p key={line.key} className="field-error">
                        {line.text}
                    </p>
                ))}
                {outcome.kind === `capped` && visitor !== null && visitor.liveGames.length > 0 ? (
                    <ul className="start-yours">
                        {visitor.liveGames.map((game) => (
                            <li key={game.gameId}>
                                <Link to={`/game/${encodeURIComponent(game.gameId)}`}>
                                    {text.play.yourGame(game.players[game.players.x.name === visitor.name ? `o` : `x`].name)}
                                </Link>
                            </li>
                        ))}
                    </ul>
                ) : null}
                {outcome.kind === `wait` && cooling !== null ? (
                    <p className="field-error">
                        <WaitText wait={{ seconds: outcome.seconds, left: cooling }} line={outcome.line} />
                    </p>
                ) : null}
            </div>
            {me.status === `loading` ? null : visitor === null ? (
                <>
                    <div className="start-actions">
                        {primary(text.play.playAsGuest, true)}
                        <DiscordButton next={path} guard />
                    </div>
                    {paused ? <p className="note">{text.play.paused}</p> : null}
                    <p className="note start-notice">{text.play.notice(page(legalPagePath(`terms`)), page(legalPagePath(`privacy`)))}</p>
                </>
            ) : (
                <>
                    <div className="start-actions">{primary(text.play.start, false)}</div>
                    <p className="note">
                        {paused ? text.play.paused : visitor.kind === `user` ? text.play.rated : text.play.guestNote(visitor.name)}
                    </p>
                </>
            )}
        </div>
    );
}
