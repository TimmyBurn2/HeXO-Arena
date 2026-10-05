import { clockText, type DuelDetail, type DuelEstimate, type DuelGameState, type DuelSide, type DuelSummary } from '@hexo-arena/contract';
import { text } from '../text';

type Named = Pick<DuelSummary, `first` | `second`>;

// A game of a duel as its score reads it: how it stands and who won.
interface ScoredGame {
    readonly state: DuelGameState;
    readonly winner: DuelSide | null;
}

// The bot on one side of a duel, by name.
function nameOf(duel: Named, side: DuelSide): string {
    return duel[side].name;
}

const otherSide = (side: DuelSide): DuelSide => (side === `first` ? `second` : `first`);

/** The games played to the end without a winner, which the score counts for neither bot and the estimate as halves. */
export function noWinnerCount(games: readonly ScoredGame[]): number {
    return games.filter((game) => game.state === `played` && game.winner === null).length;
}

/** A count of points, a game without a winner as a half. */
export function pointsText(points: number): string {
    return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

/** The score, the first bot's first. */
export function scoreText(duel: Pick<DuelSummary, `score`>): string {
    return text.duels.row.score(String(duel.score.first), String(duel.score.second));
}

// The score with the leader's points first, and the games without a winner that it leaves out.
function leaderScore(duel: Pick<DuelSummary, `score`>, games: readonly ScoredGame[]): string {
    const leader = leaderOf(duel);
    const score = leader === null ? scoreText(duel) : text.duels.row.score(String(duel.score[leader]), String(duel.score[otherSide(leader)]));
    return `${score}${text.duels.noWinner(noWinnerCount(games))}`;
}

// The bot ahead, or null when level.
function leaderOf(duel: Pick<DuelSummary, `score`>): DuelSide | null {
    if (duel.score.first === duel.score.second) return null;
    return duel.score.first > duel.score.second ? `first` : `second`;
}

/** Who leads by how much, or that it stands level, the leader's points first and any game without a winner named. */
export function standingText(duel: Pick<DuelSummary, `first` | `second` | `score`>, games: readonly ScoredGame[]): string {
    const leader = leaderOf(duel);
    const words = text.duels.page.status;
    const score = leaderScore(duel, games);
    return leader === null ? words.level(score) : words.leads(nameOf(duel, leader), score);
}

// Why a duel was cut short, in a few words.
function cutText(duel: Pick<DuelSummary, `first` | `second` | `end`>): string {
    const end = duel.end;
    if (end === undefined) return ``;
    const bot = end.bot === null ? `` : nameOf(duel, end.bot);
    switch (end.reason) {
        case `starter`:
        case `owner`:
        case `operator`:
            return ``;
        default:
            return text.duels.cutReasons[end.reason](bot);
    }
}

// The number of the game live, else the next one, else null once over.
function currentGame(duel: Pick<DuelSummary, `results` | `status`>): { game: number; live: boolean } | null {
    if (duel.status !== `running`) return null;
    const live = duel.results.find((result) => result.state === `live`);
    if (live !== undefined) return { game: live.game, live: true };
    const next = duel.results.find((result) => result.state === `pending`);
    return next === undefined ? null : { game: next.game, live: false };
}

/** Where a duel stands, as a list row says it. */
export function rowState(duel: DuelSummary): string {
    const words = text.duels.row;
    const of = duel.terms.games;
    const score = leaderScore(duel, duel.results);
    switch (duel.status) {
        case `running`: {
            const current = currentGame(duel);
            if (current === null) return words.next(duel.played + 1, of);
            return current.live ? words.live(current.game, of) : words.next(current.game, of);
        }
        case `finished`: {
            const leader = leaderOf(duel);
            return leader === null ? words.level(score) : words.won(nameOf(duel, leader), score);
        }
        case `cut_short`:
            return words.cutShort(score, cutText(duel));
        case `stopped`:
            return words.stopped(score);
    }
}

/** A rating difference with its sign. */
export function signed(value: number): string {
    return text.duels.estimate.signed(value);
}

/** Whether one bot won every game the estimate counts. */
export function sweptBy(estimate: DuelEstimate): DuelSide | null {
    const favored = estimate.favored;
    return favored !== null && estimate.points[otherSide(favored)] === 0 ? favored : null;
}

/** A test's estimate in a row: the favored bot about so many points, and the verdict; a sweep said as one. */
export function estimateRow(duel: Named & { readonly estimate?: DuelEstimate | undefined }): string | null {
    const estimate = duel.estimate;
    if (estimate === undefined) return null;
    const verdict = text.duels.estimate.verdicts[estimate.verdict];
    const swept = sweptBy(estimate);
    if (swept !== null && estimate.games >= 2) return text.duels.row.sweep(nameOf(duel, swept), estimate.games, verdict);
    const favored = estimate.favored ?? `first`;
    const rating = favored === `first` ? estimate.rating : -estimate.rating;
    return text.duels.row.estimate(nameOf(duel, favored), signed(rating), verdict);
}

/** A test's points, halves shown, the first bot's first. */
export function estimatePoints(estimate: DuelEstimate): string {
    return text.duels.row.score(pointsText(estimate.points.first), pointsText(estimate.points.second));
}

/** Seconds as a countdown reads them, minutes and seconds. */
export function countdown(seconds: number): string {
    return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, `0`)}`;
}

// Who stopped a duel, as its status names them: the reader as you.
function stopperOf(duel: DuelDetail, viewer: string | null): string {
    const words = text.duels.page.status;
    const end = duel.end;
    if (end?.reason === `operator`) return words.operator;
    const who = end?.reason === `owner` && end.bot !== null ? duel[end.bot].ownerName : duel.startedBy;
    return viewer !== null && who === viewer ? words.you : who;
}

/**
 * The status sentence a duel's page leads with; a test over leaves its
 * score to the head and the estimate, which say it already.
 */
export function statusSentence(duel: DuelDetail, now: number, viewer: string | null): string {
    const words = text.duels.page.status;
    const kind = words.kinds[duel.kind];
    const over = duel.games.filter((game) => game.state === `played`).length;
    switch (duel.status) {
        case `running`: {
            if (duel.waiting !== undefined) {
                const left = Math.max(0, Math.ceil((Date.parse(duel.waiting.until) - now) / 1000));
                return words.waiting(nameOf(duel, duel.waiting.bot), countdown(left), kind);
            }
            const live = duel.games.find((game) => game.state === `live`);
            if (live !== undefined) return over === 0 ? words.first(duel.terms.games) : words.live(live.game, duel.terms.games, standingText(duel, duel.games));
            return words.next(over + 1, standingText(duel, duel.games));
        }
        case `finished`: {
            if (duel.kind === `test`) return words.testOver(duel.terms.games);
            const leader = leaderOf(duel);
            const score = leaderScore(duel, duel.games);
            return leader === null ? words.drawn(kind, score) : words.won(nameOf(duel, leader), kind, score);
        }
        case `cut_short`: {
            const missing = duel.games.filter((game) => game.state === `not_played` || game.state === `aborted`).length;
            return words.cutShort(cutText(duel), duel.terms.games - missing + 1, missing);
        }
        case `stopped`: {
            const who = stopperOf(duel, viewer);
            if (over === 0) return words.stoppedAtOnce(who, kind);
            const tally =
                duel.kind === `test`
                    ? ``
                    : words.tally(words.points(duel.first.name, String(duel.score.first)), words.points(duel.second.name, String(duel.score.second)), text.duels.noWinner(noWinnerCount(duel.games)));
            return words.stopped(who, kind, over, tally);
        }
    }
}

/** The status a screen reader hears while the next game waits, which holds still as the countdown ticks. */
export function waitingQuiet(duel: DuelDetail): string | null {
    if (duel.status !== `running` || duel.waiting === undefined) return null;
    return text.duels.page.status.waitingQuiet(nameOf(duel, duel.waiting.bot), text.duels.page.status.kinds[duel.kind]);
}

/** The terms line under the status: length, clock, opening, strengths, rated, and who started it. */
export function termsLine(duel: DuelDetail, viewer: string | null): string {
    const words = text.duels.page.terms;
    const games = duel.terms.games;
    const parts = [
        games === 1 ? words.single : games === 2 ? words.pair : words.pairs(games),
        clockText(duel.terms.timeControl),
        words.openings(duel.terms.openingPlies),
        ...([`first`, `second`] as const).flatMap((side) => {
            const level = duel[side].level;
            return level === undefined ? [] : [words.strength(duel[side].name, level.label)];
        }),
        duel.kind === `test` ? words.test : duel.terms.rated ? ownRated(duel, viewer) : words.unrated,
    ];
    return words.line(parts, viewer !== null && viewer === duel.startedBy ? words.startedByYou : words.startedBy(duel.startedBy));
}

function ownRated(duel: DuelDetail, viewer: string | null): string {
    const own = ([`first`, `second`] as const).find((side) => duel[side].ownerName === viewer);
    return own === undefined || viewer !== duel.startedBy ? text.duels.page.terms.rated : text.duels.page.terms.ratedOwn(duel[own].name);
}
