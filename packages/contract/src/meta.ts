import { gameWallCapMs } from './limits';
import { gameTurnCap } from './limits';
import type { FinishReason, Side, TimeControl } from './stream';

/** The site's display name: the wordmark, every page title, and the API document's title. */
export const siteName = `HeXO Arena`;

/** What the site is, beside its name in the root title and the page footer. */
export const siteTagline = `one ladder for bots and humans`;

/** What the site offers, as the static page describes it and any page without data of its own. */
export const siteDescription = `Connect a HeXO bot, or play one in the browser`;

/** A page's title and the description its link previews carry. */
export interface PageMeta {
    readonly title: string;
    readonly description: string;
}

/** A page's title: its own name, then the site's. */
export function pageTitle(page: string): string {
    return `${page} - ${siteName}`;
}

/** The noun a count takes, `one` for exactly one and `other` otherwise; every count either side shows picks its noun here. */
export function plural(count: number, one: string, other: string): string {
    return count === 1 ? one : other;
}

/**
 * A duration in whole seconds under a minute, else minutes and any
 * seconds left: "20 s", "5 min", "1 min 40 s".
 */
export function durationText(ms: number): string {
    const seconds = Math.round(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (minutes === 0) return `${String(rest)} s`;
    return rest === 0 ? `${String(minutes)} min` : `${String(minutes)} min ${String(rest)} s`;
}

/** A clock's mode, all a reader knows of a clock whose settings are not at hand. */
export type ClockMode = TimeControl[`mode`];

const clockNames: Readonly<Record<ClockMode, string>> = {
    turn: `turn clock`,
    match: `match clock`,
    unlimited: `unlimited`,
};

/**
 * The clock as every page words it: "turn clock 20 s", "match clock
 * 5 min + 3 s", "unlimited"; given only a mode, its name alone.
 */
export function clockText(clock: TimeControl | ClockMode): string {
    if (typeof clock === `string`) return clockNames[clock];
    switch (clock.mode) {
        case `turn`:
            return `${clockNames.turn} ${durationText(clock.turnTimeMs)}`;
        case `match`: {
            const main = `${clockNames.match} ${durationText(clock.mainTimeMs)}`;
            return clock.incrementMs === 0 ? main : `${main} + ${durationText(clock.incrementMs)}`;
        }
        case `unlimited`:
            return clockNames.unlimited;
    }
}

/** A finish reason as a filter or a list names it. */
export const finishReasonLabels: Readonly<Record<FinishReason, string>> = {
    'six-in-a-row': `Six in a row`,
    timeout: `On time`,
    surrender: `Resignation`,
    disconnect: `Disconnect`,
    terminated: `Terminated`,
    aborted: `Aborted`,
};

const wallCapHours = gameWallCapMs / 3_600_000;

/**
 * The turns a board of this many stones holds, opening turns included:
 * the origin is no turn, every later turn places two,
 * and a win on the first stone of a turn leaves it one short.
 */
export function turnsOnBoard(stones: number): number {
    return Math.ceil((stones - 1) / 2);
}

/** How a game ended: the side that won, if any, why, and after how many turns. */
export interface GameResult {
    readonly winner: Side | null;
    readonly reason: FinishReason;
    readonly turns: number;
}

/**
 * A finished game's result as one sentence; `you` names the reader's own
 * side, which reads as "You" or "you" in place of that player's name.
 * A game with a winner is terminated only by an illegal move, one without
 * by the turn cap or by the wall-time cap.
 */
export function resultSentence(result: GameResult, names: Readonly<Record<Side, string>>, you?: Side): string {
    const { winner, reason, turns } = result;
    if (winner === null) {
        if (reason === `terminated`) {
            return turns >= gameTurnCap
                ? `No winner; the game reached the ${String(gameTurnCap)}-turn limit`
                : `No winner; the game reached the ${String(wallCapHours)}-hour limit`;
        }
        if (reason === `aborted`) return `No winner; the game was aborted`;
        return `No winner`;
    }
    const loser = winner === `x` ? `o` : `x`;
    const won = `${winner === you ? `You` : names[winner]} won`;
    const lost = loser === you ? `you` : names[loser];
    switch (reason) {
        case `six-in-a-row`:
            return `${won} with six in a row`;
        case `timeout`:
            return `${won} on time`;
        case `surrender`:
            return `${won}; ${lost} resigned`;
        case `disconnect`:
            return `${won}; ${lost} disconnected`;
        case `terminated`:
            return `${won}; ${lost} played an illegal move`;
        case `aborted`:
            return `${won}; the game was aborted`;
    }
}

/** What the root and the ladder say about the bots here, when it is known. */
export interface Roster {
    readonly listed: number;
    readonly online: number;
    readonly leader?: { readonly name: string; readonly rating: number } | undefined;
}

// An empty roster reads as the site's own description, and no bot online
// as a word, never as zeros; the leader may be a human, so it is named by
// the ladder rather than after the bot count.
function rosterDescription(roster: Roster | undefined): string {
    if (roster === undefined || roster.listed === 0) return siteDescription;
    const online = roster.online === 0 ? `none` : String(roster.online);
    const leader =
        roster.leader === undefined ? `` : `; first on the ladder: ${roster.leader.name} (${String(Math.round(roster.leader.rating))})`;
    return `${String(roster.listed)} ${plural(roster.listed, `bot`, `bots`)} listed, ${online} online${leader}`;
}

/** The root's meta: the site's own title whatever screen it shows. */
export function siteMeta(roster?: Roster): PageMeta {
    return { title: `${siteName} - ${siteTagline}`, description: rosterDescription(roster) };
}

/** The ladder's meta, on its own route. */
export function ladderMeta(roster?: Roster): PageMeta {
    return { title: pageTitle(`Ladder`), description: rosterDescription(roster) };
}

/** The bot list's meta. */
export const botsMeta: PageMeta = { title: pageTitle(`Bots`), description: `Every bot on ${siteName}, online or not` };

/** The finished games, newest first, with their filters. */
export const gamesMeta: PageMeta = { title: pageTitle(`Games`), description: `Every finished game on ${siteName}, newest first, by player, result, and clock` };

/** Every game in progress, as boards. */
export const liveGamesMeta: PageMeta = { title: pageTitle(`Live games`), description: `Every game in progress on ${siteName}, bots and humans alike` };

/** The way to build a bot, from sign-in to a connected bot. */
export const connectMeta: PageMeta = { title: pageTitle(`Build a bot`), description: `Sign in, create a bot, and connect it to the ladder` };

/** Who is signed in: their rating and their bots. */
export const profileMeta: PageMeta = { title: pageTitle(`Profile`), description: `Your rating and your bots` };

/** Where a person picks a bot and a clock and starts a game, the bot named when the link names one. */
export function playMeta(bot?: string): PageMeta {
    return {
        title: pageTitle(bot === undefined ? `Play` : `Play ${bot}`),
        description: `Pick a bot and a clock, and play HeXO in the browser`,
    };
}

/** The first sign-in's page, where a person chooses their public name. */
export const welcomeMeta: PageMeta = { title: pageTitle(`Create your account`), description: `Choose the public name for your ${siteName} account` };

/** What the site builds on. */
export const creditsMeta: PageMeta = { title: pageTitle(`Credits`), description: `The game, its community, and the themes, font, and projects ${siteName} builds on` };

/** A page that does not exist, a hidden bot, or a game that is gone. */
export const notFoundMeta: PageMeta = { title: pageTitle(`Not found`), description: `That page does not exist` };

const aboutExcerptLength = 120;

// The about text on one line, cut at a word within the limit; it ends on
// its last word, its own question or exclamation mark, or the cut's
// ellipsis, never on the owner's trailing period, comma, or space.
function aboutExcerpt(about: string): string {
    const line = about.replace(/\s+/gu, ` `).trim();
    if (line.length <= aboutExcerptLength) return line.replace(/[\s.,;:]+$/u, ``);
    const space = line.lastIndexOf(` `, aboutExcerptLength);
    const cut = space > 0 ? line.slice(0, space) : line.slice(0, aboutExcerptLength);
    return `${cut.replace(/[\s.,;:!?-]+$/u, ``)}...`;
}

/** What a bot's preview says: its owner when known, rating, presence, and the start of its about text. */
export function botMeta(bot: {
    readonly name: string;
    readonly ownerName: string | null;
    readonly rating: number;
    readonly provisional: boolean;
    readonly online: boolean;
    readonly openForChallenges: boolean;
    readonly about?: string | undefined;
}): PageMeta {
    const owner = bot.ownerName === null ? `` : ` by ${bot.ownerName}`;
    const rated = `rated ${String(bot.rating)}${bot.provisional ? ` (provisional)` : ``}`;
    const state = !bot.online
        ? `offline`
        : bot.openForChallenges
          ? `online and open for challenges`
          : `online, closed for challenges`;
    const excerpt = bot.about === undefined ? `` : aboutExcerpt(bot.about);
    const about = excerpt === `` ? `` : `. ${excerpt}`;
    return { title: pageTitle(bot.name), description: `HeXO bot${owner}, ${rated}, ${state}${about}` };
}

/**
 * What a game's link preview needs: both names, and the side to move with
 * the clock, or the result.
 */
export type GameHeadline =
    | {
          readonly status: `live`;
          readonly names: Record<Side, string>;
          readonly toMove: Side;
          readonly timeControl: TimeControl;
      }
    | {
          readonly status: `finished`;
          readonly names: Record<Side, string>;
          readonly winner: Side | null;
          readonly reason: FinishReason;
          readonly turns: number;
      };

/** A game's meta: both names, then who is to move under which clock, or the result. */
export function gameMeta(headline: GameHeadline): PageMeta {
    const title = pageTitle(`${headline.names.x} vs ${headline.names.o}`);
    if (headline.status === `live`) {
        return {
            title,
            description: `Live; ${headline.names[headline.toMove]} to move; ${clockText(headline.timeControl)}`,
        };
    }
    return { title, description: resultSentence(headline, headline.names) };
}

/** A finished game's headline, all an analysis page names of the game it opens. */
export type FinishedHeadline = Extract<GameHeadline, { readonly status: `finished` }>;

/** The analysis board's meta: the board alone, or the finished game it opens, named as its own page names it. */
export function analysisMeta(game?: FinishedHeadline): PageMeta {
    if (game === undefined) {
        return {
            title: pageTitle(`Analysis`),
            description: `Play HeXO turns for both sides, step through finished games, set up positions, and read or write HTTTX notation`,
        };
    }
    return { title: pageTitle(`Analysis: ${game.names.x} vs ${game.names.o}`), description: resultSentence(game, game.names) };
}
