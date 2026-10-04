import type { Page, Route } from '@playwright/test';
import {
    acceptsCovers,
    botConcurrentGameCap,
    duelDailyCap,
    duelGameCounts,
    duelLiveCap,
    duelPerBotCap,
    seatLevelOf,
    analysesPerGame,
    analysisListSchema,
    analysisRequestSchema,
    communityAnalysisSchema,
    createGameRequestSchema,
    createDuelRequestSchema,
    duelBotStatesSchema,
    duelDetailSchema,
    duelListQuerySchema,
    duelListSchema,
    estimateOf,
    meUpdateRequestSchema,
    positionCheckRequestSchema,
    positionReadingRequestSchema,
    positionReadingSchema,
    userMeSchema,
    type AnalysisFailure,
    type AnalysisLine,
    type AnalysisList,
    type AnalysisRequest,
    type AnalysisTurn,
    type AnalyzerValues,
    type CommunityAnalysis,
    type OwnAnalysis,
    type PositionReadingRequest,
    undeclaredValues,
    winChanceCuts,
    accountExportSchema,
    deleteAccountRequestSchema,
    reportFormMetaName,
    reportRequestSchema,
    botListingSchema,
    botSettingsSchema,
    botSettingsUpdateSchema,
    devAccountSchema,
    gameSnapshotSchema,
    leaderboardActiveDays,
    legalDetailsPath,
    legalDetailsSchema,
    legalDocumentPath,
    legalPages,
    leaderboardQuerySchema,
    leaderboardSchema,
    finishedGamesPageCap,
    finishedGamesPageSchema,
    finishedGamesQuerySchema,
    liveGameEntrySchema,
    meSchema,
    playerRecordSchema,
    ratingRangeSchema,
    signupSchema,
    tournamentDetailSchema,
    tournamentEntryRequestSchema,
    tournamentWithdrawRequestSchema,
    createRoundRobinRequestSchema,
    tournamentListSchema,
    type BotListing,
    type BotSettings,
    type DuelBotState,
    type DuelDetail,
    type DuelGame,
    type DuelSide,
    type DuelSummary,
    type EstimateUnit,
    type DevAccount,
    type GameSnapshot,
    type LegalDetails,
    type LegalPage,
    type Levels,
    type LeaderboardEntry,
    type FinishedGameEntry,
    type FinishedGamesPage,
    type LiveGameEntry,
    type Me,
    type PlayerRecord,
    type RatingPoint,
    type RatingRange,
    type Side,
    type Signup,
    type TournamentDetail,
    type TournamentEntry,
    type TournamentGame,
    type TournamentStanding,
    type TournamentPlace,
    type TournamentSummary,
} from '@hexo-arena/contract';

/**
 * The world one browser test sees; every answer is parsed with the
 * contract schemas, so a fixture that drifts from the contract fails
 * loudly instead of rendering something the server could never send.
 */
export interface World {
    me: Me;
    leaderboard: LeaderboardEntry[];
    bots: BotListing[];
    games: Record<string, GameSnapshot>;
    live: LiveGameEntry[];
    // The finished games, newest first, as the history's first page holds them.
    finished: FinishedGameEntry[];
    paused: boolean;
    // Hold every data answer back, for loading-state captures.
    stall: boolean;
    // Answer every data read with a 500, for error-state captures.
    broken: boolean;
    // A screen's module path whose download fails, as a missing page chunk
    // does; in a production build, the chunk named after it.
    unloadable: string | null;
    // The deployment's legal details; null answers not found.
    legal: LegalDetails | null;
    // The legal documents the deployment lacks, each answering not found.
    legalMissing: LegalPage[];
    // The first sign-in waiting for its name; null answers it as expired.
    signup: Signup | null;
    // How Create account answers: the account, or a refusal by its code.
    create: `created` | `name_taken` | `signup_limit` | `failed`;
    // How a game start answers: the running game, marked as the request asks, or a refusal.
    start: `created` | { status: number; code: string; retryAfter?: number };
    // Whether minting a guest session finds the guest limit full.
    guestLimit: boolean;
    // Every data read, or every write, refused as rate-limited, with the wait its limit names.
    limited: `reads` | `writes` | null;
    // The tournaments by id, which the list reads too.
    tournaments: TournamentDetail[];
    // The dev server's seeded personas; null answers as every other server does, not found.
    devAccounts: DevAccount[] | null;
    // Whether the page's shell names the report form, as the server's does where the deployment takes reports.
    reportForm: boolean;
    // The bots that declare an analyzer, as the directory lists them under analyzer=1.
    analyzers: BotListing[];
    // How each position request answers.
    positions: PositionAnswer;
    // Every position request so far, in order.
    asked: PositionReadingRequest[];
    // Each finished game's readings by id; a game not named has none.
    analyses: Record<string, AnalysisList>;
    // Every whole-game request so far, by game, in order.
    requested: { gameId: string; request: AnalysisRequest }[];
    // The settings of bots the signed-in person owns, by name; one not named reads as never set, its declared text as listed.
    settings: Record<string, BotSettings>;
    // Every duel and test by id, which the lists read too.
    duels: DuelDetail[];
    // Each listed bot's duel state; null derives it from the bots and the running duels, every switch on.
    duelStates: DuelBotState[] | null;
    // How a duel's start answers: the duel, as the request asks, or a refusal.
    duelStart: `created` | { status: number; code: string; retryAfter?: number };
    // How setting a round robin up answers: the round robin, as the request asks, or a refusal naming a bot where the server would.
    roundRobinStart: `created` | { status: number; code: string; bot?: string; retryAfter?: number };
}

/**
 * How the analysis board's position requests answer: a reading of lines
 * the mock picks next to the stones, or `lines` as given; queued `times`
 * times before that, naming the analyzer once `chosen`; held without an
 * answer; failed; or refused.
 */
export type PositionAnswer =
    | { kind: `done`; cached?: boolean; lines?: AnalysisLine[]; queued?: { ahead: number; times: number; chosen?: boolean } }
    | { kind: `held` }
    | { kind: `failed`; failure: AnalysisFailure }
    | { kind: `refused`; status: number; code: string; retryAfter?: number };

// kestrel declares its values expected, x's expected result, so its readings mark drops of value by lichess's cuts.
const winChanceValues: AnalyzerValues = { scale: 1, cuts: winChanceCuts, meaning: `expected` };

/** Two analyzers online, one reading up to 5 s and three lines, one up to 2 s and two, and one offline. */
export const analyzerBots: BotListing[] = [
    { name: `kestrel`, ownerName: `tom`, online: true, openForChallenges: false, rating: 1500, provisional: true, liveGames: 0, levels: null, version: `0.9`, analyzer: { maxSeconds: 5, lines: 3, whilePlaying: false, values: winChanceValues, ready: true } },
    { name: `driftwood`, ownerName: `mika`, online: true, openForChallenges: false, rating: 1500, provisional: true, liveGames: 0, levels: null, analyzer: { maxSeconds: 2, lines: 2, whilePlaying: false, values: undeclaredValues, ready: true } },
    { name: `slowpoke`, ownerName: `ana`, online: false, openForChallenges: false, rating: 1500, provisional: true, liveGames: 0, levels: null, analyzer: { maxSeconds: 10, lines: 1, whilePlaying: false, values: undeclaredValues, ready: false } },
];

// Each line's heuristic for the side to move, x-positive as the wire has it.
const mockHeuristics: Record<Side, readonly number[]> = { x: [0.31, 0.18, -0.05], o: [-0.12, -0.07, 0.02] };

// Empty cells next to the stones, nearest the newest first, so a line
// paired from them in order is legal.
function freeCells(cells: readonly { x: number; y: number }[]): { x: number; y: number }[] {
    const taken = new Set(cells.map((cell) => `${String(cell.x)},${String(cell.y)}`));
    const steps = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]] as const;
    const free: { x: number; y: number }[] = [];
    for (const stone of [...cells].reverse()) {
        for (const [dx, dy] of steps) {
            const cell = { x: stone.x + dx, y: stone.y + dy };
            const key = `${String(cell.x)},${String(cell.y)}`;
            if (taken.has(key)) continue;
            taken.add(key);
            free.push(cell);
        }
    }
    return free;
}

// Lines the mock analyzer reads, paired from the free cells in order.
function mockLines(request: PositionReadingRequest, count: number): AnalysisLine[] {
    const free = freeCells(request.cells);
    return Array.from({ length: count }, (_, index) => {
        const first = free[index * 2] ?? { x: 0, y: 0 };
        const second = free[index * 2 + 1] ?? { x: 0, y: 0 };
        return { cells: [first, second], heuristic: mockHeuristics[request.toMove][index] ?? 0 };
    });
}

// Three strengths, weakest first, the middle one rated, as the alpha-beta example declares them.
export const strengths: Levels = {
    default: `standard`,
    list: [
        { id: `quick`, label: `quick`, about: `Answers at once; a gentle first opponent.`, budget: { timeMs: 200 } },
        { id: `standard`, label: `standard`, budget: { nodes: 1_000_000 } },
        { id: `deep`, label: `deep`, budget: { depthTurns: 8, timeMs: 5_000 }, note: `slow on crowded boards` },
    ],
};

// A bot seat at a level other than its default, which shows no rating.
const atQuick = { id: `quick`, label: `quick`, budget: { timeMs: 200 } } as const;

// Every state a bot in the Play roster can be in:
// ready at several ratings and clocks, busy at its game cap,
// one taking turn clocks of 10 to 60 s only, one closed, one offline.
const full = { turnMs: [5000, 300000], match: true, unlimited: true };
export const playBots: BotListing[] = [
    { name: `sealbot`, ownerName: `bruno`, online: true, openForChallenges: true, rating: 1712, provisional: false, liveGames: 4, levels: null, analyzer: null, accepts: { turnMs: [5000, 60000], match: true, unlimited: false } },
    { name: `hextide`, ownerName: `ana`, online: true, openForChallenges: true, rating: 1690, provisional: false, liveGames: 1, levels: strengths, analyzer: null, accepts: { turnMs: [5000, 60000], match: true, unlimited: false } },
    { name: `devbot-b`, ownerName: `devowner-b`, online: true, openForChallenges: true, rating: 1538, provisional: false, liveGames: 0, levels: null, analyzer: null, accepts: full },
    { name: `devbot-a`, ownerName: `devowner-a`, online: true, openForChallenges: true, rating: 1520, provisional: false, liveGames: 2, levels: null, analyzer: null, accepts: full },
    { name: `devbot-c`, ownerName: `devowner-c`, online: true, openForChallenges: true, rating: 1514, provisional: false, liveGames: 0, levels: null, analyzer: null, accepts: full },
    { name: `quietlake`, ownerName: `dmitri`, online: true, openForChallenges: true, rating: 1420, provisional: true, liveGames: 0, levels: null, analyzer: null, accepts: { turnMs: [10000, 60000], match: false, unlimited: false } },
    { name: `pebble`, ownerName: `ana`, online: true, openForChallenges: false, rating: 1388, provisional: true, liveGames: 0, levels: null, analyzer: null, accepts: { turnMs: [5000, 30000], match: false, unlimited: true } },
    { name: `lantern`, ownerName: `ana`, online: false, openForChallenges: false, rating: 1500, provisional: true, liveGames: 0, levels: null, analyzer: null },
];

export const signup: Signup = { discord: { username: `mira.hex`, displayName: `Mira` }, suggestedName: `mira-hex`, next: `/connect` };

// Invented values: no real operator, host, or authority belongs in a fixture.
export const legalDetails: LegalDetails = {
    operator: { name: `Ada Beispiel`, street: `Musterweg 7`, postcodeAndCity: `12345 Beispielstadt`, country: `Germany`, email: `contact@arena.example`, discord: `ada_b` },
    host: { name: `Example Hosting GmbH`, street: `Serverstrasse 1`, postcodeAndCity: `54321 Rechenburg`, country: `Germany`, serverLocation: `Rechenburg, Germany` },
    supervisoryAuthority: {
        name: `Example State Data Protection Authority`,
        street: `Aufsichtsplatz 2`,
        postcodeAndCity: `11111 Landeshausen`,
        country: `Germany`,
        url: `https://authority.example/`,
    },
    mailProvider: { name: `Example Mail AG`, street: `Postfach 3`, postcodeAndCity: `22222 Briefstadt`, country: `Germany` },
};

const playedAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString().replace(/\.\d{3}Z$/u, `Z`);

// The ranked players, the last of them idle past the default 30 days.
export const leaderboard: LeaderboardEntry[] = [
    { rank: 1, name: `sealbot`, kind: `bot`, rating: 1712, games: 214, lastPlayedAt: playedAgo(0.1), ownerName: `quinn`, online: true },
    { rank: 2, name: `hextide`, kind: `bot`, rating: 1690, games: 188, lastPlayedAt: playedAgo(2), ownerName: `ana`, online: true },
    { rank: 3, name: `quinn`, kind: `human`, rating: 1503, games: 57, lastPlayedAt: playedAgo(30) },
    { rank: 4, name: `quietlake`, kind: `bot`, rating: 1461, games: 96, lastPlayedAt: playedAgo(80), ownerName: `quinn`, online: false },
    { rank: 5, name: `ana`, kind: `human`, rating: 1402, games: 49, lastPlayedAt: playedAgo(200) },
    { rank: 6, name: `driftwood`, kind: `bot`, rating: 1388, games: 71, lastPlayedAt: playedAgo(24 * 45), ownerName: `bruno`, online: false },
];

// One bot of each kind its page shows: sealbot declares everything, hextide
// only its source, and quietlake nothing while offline.
export const bots: BotListing[] = [
    {
        name: `sealbot`,
        ownerName: `quinn`,
        online: true,
        openForChallenges: true,
        rating: 1712,
        provisional: false,
        liveGames: 0,
        levels: strengths,
        analyzer: { maxSeconds: 10, lines: 1, whilePlaying: true, values: undeclaredValues, ready: true },
        about: `A clean-room HeXO engine with a rotation opener.`,
        version: `0.3.1`,
        repoUrl: `https://github.com/quinn/sealbot`,
        accepts: { turnMs: [5000, 60000], match: true, unlimited: true },
    },
    {
        name: `hextide`,
        ownerName: `ana`,
        online: true,
        openForChallenges: true,
        rating: 1690,
        provisional: false,
        liveGames: 0,
        levels: null,
        analyzer: null,
        version: `2.0.0`,
        repoUrl: `https://example.com/ana/hextide`,
        accepts: { turnMs: null, match: true, unlimited: true },
    },
    {
        name: `quietlake`,
        ownerName: `quinn`,
        online: false,
        openForChallenges: false,
        rating: 1461,
        provisional: true,
        liveGames: 0,
        levels: null,
        analyzer: null,
    },
];

/**
 * As many bots as an account holds, all quinn's, in the server's name
 * order: one never connected, one reading positions and closed for
 * challenges, the two of `bots`, and one under a long name that reads
 * positions and plays at three strengths.
 */
export const heldBots: BotListing[] = [
    { name: `alder`, ownerName: `quinn`, online: false, openForChallenges: false, rating: 1500, provisional: true, liveGames: 0, levels: null, analyzer: null },
    { name: `marsh`, ownerName: `quinn`, online: true, openForChallenges: false, rating: 1588, provisional: false, liveGames: 0, levels: null, version: `0.4.0`, analyzer: { maxSeconds: 5, lines: 3, whilePlaying: false, values: undeclaredValues, ready: true } },
    ...bots.filter((bot) => bot.ownerName === `quinn`),
    {
        name: `tidewater-alphabeta-v2`,
        ownerName: `quinn`,
        online: true,
        openForChallenges: true,
        rating: 1634,
        provisional: false,
        liveGames: 1,
        levels: strengths,
        analyzer: { maxSeconds: 2, lines: 2, whilePlaying: true, values: undeclaredValues, ready: true },
        accepts: { turnMs: [5000, 120000], match: true, unlimited: false },
    },
];

const seat = {
    sealbot: { name: `sealbot`, rating: 1712, provisional: false, kind: `bot` },
    hextide: { name: `hextide`, rating: 1690, provisional: false, kind: `bot` },
    quietlake: { name: `quietlake`, rating: 1461, provisional: true, kind: `bot` },
    driftwood: { name: `driftwood`, rating: 1388, provisional: false, kind: `bot` },
    ember: { name: `ember`, rating: 1320, provisional: true, kind: `bot` },
    quinn: { name: `quinn`, rating: 1503, provisional: false, kind: `user` },
    ana: { name: `ana`, rating: 1402, provisional: false, kind: `user` },
    guest: { name: `Guest k3f9`, rating: null, provisional: false, kind: `guest` },
    gone: { name: `deleted player`, rating: 1460, provisional: false, kind: `user`, deleted: true },
    quietlakeQuick: { name: `quietlake`, rating: null, provisional: false, kind: `bot`, level: atQuick },
    emberQuick: { name: `ember`, rating: null, provisional: false, kind: `bot`, level: atQuick },
} as const;

const clocks = [
    { mode: `turn`, turnTimeMs: 30_000 },
    { mode: `match`, mainTimeMs: 300_000, incrementMs: 2_000 },
    { mode: `unlimited` },
] as const;

// The side of each ply: x holds the origin, then the sides alternate in pairs.
function sideOfPly(ply: number): Side {
    return ply === 0 || Math.floor((ply - 1) / 2) % 2 === 1 ? `x` : `o`;
}

const nearSteps = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: -1, y: 1 },
    { x: 2, y: -1 },
    { x: -2, y: 1 },
    { x: 1, y: 1 },
    { x: -1, y: -1 },
];

/**
 * A game's stones as play leaves them, clustered near the stones before;
 * the same seed always draws the same board.
 */
export function playedCells(count: number, seed: number): LiveGameEntry[`cells`] {
    let state = seed * 7919 + 17;
    const next = () => {
        state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
        return state / 2_147_483_648;
    };
    const cells: LiveGameEntry[`cells`] = [{ x: 0, y: 0, side: `x` }];
    const taken = new Set([`0,0`]);
    while (cells.length < count) {
        const from = cells[Math.floor(next() * cells.length)] ?? { x: 0, y: 0 };
        const step = nearSteps[Math.floor(next() * nearSteps.length)] ?? { x: 1, y: 0 };
        const cell = { x: from.x + step.x, y: from.y + step.y };
        const key = `${String(cell.x)},${String(cell.y)}`;
        if (taken.has(key)) continue;
        taken.add(key);
        cells.push({ ...cell, side: sideOfPly(cells.length) });
    }
    return cells;
}

// The clock a live game shows for its time control, part spent.
function runningClock(timeControl: (typeof clocks)[number], index: number): LiveGameEntry[`clock`] {
    if (timeControl.mode === `turn`) return { mode: `turn`, remainingTurnMs: 24_000 - 1_000 * index };
    if (timeControl.mode === `match`) return { mode: `match`, remainingMainMs: { x: 241_000 - 3_000 * index, o: 263_000 - 2_000 * index } };
    return { mode: `unlimited` };
}

// A full list: the cap's worth of games, mixing bot pairs, users, and
// guests, with no bot past its four live games.
export const liveGames: LiveGameEntry[] = (
    [
        [seat.sealbot, seat.guest],
        [seat.hextide, seat.sealbot],
        [seat.quinn, seat.quietlake],
        [seat.driftwood, seat.hextide],
        [seat.guest, seat.driftwood],
        [seat.quietlake, seat.sealbot],
        [seat.ana, seat.hextide],
        [seat.sealbot, seat.driftwood],
        [seat.guest, seat.ember],
        [seat.quietlake, seat.driftwood],
        [seat.quinn, seat.emberQuick],
        [seat.hextide, seat.quietlake],
    ] as const
).map(([x, o], index) => {
    const timeControl = clocks[index % clocks.length] ?? clocks[2];
    const cells = playedCells(9 + 4 * index, index + 1);
    return {
        gameId: index === 0 ? `guest` : `live-${String(index)}`,
        players: { x, o },
        timeControl,
        toMove: sideOfPly(cells.length),
        rated: [x, o].every((player) => player.kind !== `guest` && !(`level` in player)),
        voided: false,
        cells,
        clock: runningClock(timeControl, index),
    };
});

// The bots the duel screens pick from, as the duel mockups name them:
// ana's three, one closed to others, one offline; bruno's with four
// strengths; three dev bots in a duel; dmitri's, whose owner keeps duels
// to himself.
const steadyLevels: Levels = {
    default: `steady`,
    list: [
        { id: `easy`, label: `easy`, budget: { timeMs: 100 } },
        { id: `steady`, label: `steady`, budget: { nodes: 20_000 } },
        { id: `sharp`, label: `sharp`, budget: { timeMs: 1_000 } },
    ],
};
const pistolLevels: Levels = {
    default: `strong`,
    list: [
        { id: `beginner`, label: `beginner`, budget: { depthTurns: 1 } },
        { id: `casual`, label: `casual`, budget: { nodes: 5_000 } },
        { id: `club`, label: `club`, budget: { nodes: 50_000 } },
        { id: `strong`, label: `strong`, budget: { timeMs: 1_000 }, about: `Searches as deep as one second allows, usually four turns.` },
    ],
};
const wide = { turnMs: [5_000, 300_000], match: true, unlimited: true };
export const duelBots: BotListing[] = [
    { name: `hextide`, ownerName: `ana`, online: true, openForChallenges: true, rating: 2117, provisional: true, liveGames: 0, levels: null, analyzer: null, version: `1.4.0`, accepts: { turnMs: [5_000, 120_000], match: true, unlimited: false } },
    { name: `pebble`, ownerName: `ana`, online: true, openForChallenges: false, rating: 1182, provisional: true, liveGames: 0, levels: null, analyzer: null, version: `0.3.1`, accepts: wide },
    { name: `cinder`, ownerName: `ana`, online: true, openForChallenges: true, rating: 1500, provisional: true, liveGames: 0, levels: steadyLevels, analyzer: null, version: `0.2.0`, accepts: { turnMs: [5_000, 60_000], match: false, unlimited: true } },
    { name: `lantern`, ownerName: `ana`, online: false, openForChallenges: false, rating: 1500, provisional: true, liveGames: 0, levels: null, analyzer: null },
    {
        name: `Pistol1`,
        ownerName: `bruno`,
        online: true,
        openForChallenges: true,
        rating: 1956,
        provisional: true,
        liveGames: 1,
        levels: pistolLevels,
        analyzer: null,
        about: `Classical alpha-beta search with threat-first move generation.`,
        accepts: wide,
    },
    { name: `devbot-b`, ownerName: `devowner-b`, online: true, openForChallenges: true, rating: 1519, provisional: false, liveGames: 1, levels: steadyLevels, analyzer: null, accepts: wide },
    { name: `devbot-c`, ownerName: `devowner-c`, online: true, openForChallenges: true, rating: 1500, provisional: false, liveGames: 1, levels: steadyLevels, analyzer: null, accepts: wide },
    { name: `devbot-a`, ownerName: `devowner-a`, online: true, openForChallenges: true, rating: 1498, provisional: false, liveGames: 0, levels: steadyLevels, analyzer: null, accepts: wide },
    { name: `quietlake`, ownerName: `dmitri`, online: true, openForChallenges: true, rating: 1460, provisional: true, liveGames: 0, levels: null, analyzer: null, accepts: { turnMs: [5_000, 300_000], match: false, unlimited: true } },
    { name: `driftwood`, ownerName: `bruno`, online: false, openForChallenges: false, rating: 1388, provisional: false, liveGames: 0, levels: null, analyzer: null, accepts: wide },
];

/** A bot as a duel names it, at its rating now and then. */
export function duelBotOf(bot: BotListing, extra: Partial<DuelDetail[`first`]> = {}): DuelDetail[`first`] {
    return {
        name: bot.name,
        ownerName: bot.ownerName ?? `nobody`,
        ratingAtStart: bot.rating,
        ...(bot.version === undefined ? {} : { version: bot.version }),
        now: { rating: bot.rating, provisional: bot.provisional },
        ...extra,
    };
}

const named = (name: string) => duelBots.find((bot) => bot.name === name) ?? duelBots[0] ?? (() => { throw new Error(`no duel bot`); })();

/** How one game of a fixture duel went: who won, no winner, live, or not played. */
type Outcome = DuelSide | `none` | `live` | `not_played`;

interface DuelPlan {
    id: string;
    first: DuelDetail[`first`];
    second: DuelDetail[`second`];
    kind: DuelDetail[`kind`];
    startedBy: string;
    games: DuelDetail[`terms`][`games`];
    rated: boolean;
    timeControl?: DuelDetail[`terms`][`timeControl`];
    openingPlies?: DuelDetail[`terms`][`openingPlies`];
    // Each game's outcome in order; the games past them are still to play.
    outcomes: readonly Outcome[];
    live: boolean;
    status: DuelDetail[`status`];
    end?: DuelDetail[`end`];
    // When it began and ended, in hours before now.
    began?: number;
    ended?: number;
}

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString().replace(/\.\d{3}Z$/u, `Z`);

/** A duel as its page reads it, its score, games, openings, and a test's estimate drawn from the plan. */
export function duelFixture(plan: DuelPlan): DuelDetail {
    const timeControl = plan.timeControl ?? { mode: `turn`, turnTimeMs: 10_000 };
    const openingPlies = plan.openingPlies ?? 5;
    const games: DuelGame[] = Array.from({ length: plan.games }, (_, index) => {
        const number = index + 1;
        const outcome = plan.outcomes[index];
        const pair = Math.ceil(number / 2);
        const x: DuelSide = number % 2 === 1 ? `first` : `second`;
        const drawn = outcome !== undefined && outcome !== `not_played`;
        const opening = drawn || (number % 2 === 0 && plan.outcomes[index - 1] !== undefined) ? playedCells(openingPlies, pair + plan.id.length).slice(0, openingPlies) : null;
        return {
            game: number,
            x,
            gameId: drawn ? `${plan.id}-${String(number)}` : null,
            state: outcome === undefined ? (plan.status === `running` ? `pending` : `not_played`) : outcome === `live` ? `live` : outcome === `not_played` ? `not_played` : `played`,
            winner: outcome === `first` || outcome === `second` ? outcome : null,
            reason: outcome === `first` || outcome === `second` ? `six-in-a-row` : outcome === `none` ? `terminated` : null,
            turns: outcome === `first` || outcome === `second` || outcome === `none` ? 20 + ((number * 7) % 23) : null,
            opening,
        };
    });
    const score = { first: games.filter((game) => game.winner === `first`).length, second: games.filter((game) => game.winner === `second`).length };
    const units: EstimateUnit[] = [];
    for (let at = 0; at < games.length; at += 2) {
        const unit = { games: 0, points: 0 };
        for (const game of games.slice(at, at + 2)) {
            if (game.state !== `played`) continue;
            unit.games += 1;
            unit.points += game.winner === null ? 0.5 : game.winner === `first` ? 1 : 0;
        }
        units.push(unit);
    }
    const estimate = plan.kind === `test` ? estimateOf(units) : null;
    const liveGame = games.find((game) => game.state === `live`);
    const players = (side: DuelSide) => ({ name: plan[side].name, rating: plan[side].ratingAtStart, provisional: plan[side].now?.provisional ?? false, kind: `bot` as const });
    const cells = playedCells(37, plan.id.length);
    const live: LiveGameEntry[] =
        liveGame === undefined || liveGame.gameId === null
            ? []
            : [
                  {
                      gameId: liveGame.gameId,
                      players: liveGame.x === `first` ? { x: players(`first`), o: players(`second`) } : { x: players(`second`), o: players(`first`) },
                      timeControl,
                      toMove: sideOfPly(cells.length),
                      rated: plan.rated,
                      cells,
                      clock: { mode: `turn`, remainingTurnMs: 6_000 },
                      duel: { id: plan.id, game: liveGame.game, of: plan.games },
                      ...(plan.kind === `test` ? { test: true as const } : {}),
                  },
              ];
    return {
        id: plan.id,
        kind: plan.kind,
        status: plan.status,
        startedBy: plan.startedBy,
        first: plan.first,
        second: plan.second,
        terms: { games: plan.games, openingPlies, timeControl, rated: plan.rated },
        score,
        ...(estimate === null ? {} : { estimate }),
        ...(plan.end === undefined ? {} : { end: plan.end }),
        createdAt: hoursAgo(plan.began ?? 1),
        endedAt: plan.status === `running` ? null : hoursAgo(plan.ended ?? 0.2),
        games,
        live,
    };
}

/** A duel as a list names it. */
export function summaryOfDuel(duel: DuelDetail): DuelSummary {
    const { games, live: _live, waiting: _waiting, ...fields } = duel;
    return { ...fields, played: games.filter((game) => game.state === `played`).length, results: games.map(({ game, x, gameId, state, winner }) => ({ game, x, gameId, state, winner })) };
}

// What the server refuses a duel's start for, in the order it checks:
// each bot's gates, being open and its owner's switch binding only bots the
// starter does not own, then the pair, the starter's running duels, a rated
// duel the starter may not have, a length only a test takes, and the day's cap.
function duelRefusal(state: World, viewer: string, pair: readonly [BotListing, BotListing], asked: { games: number; timeControl: DuelDetail[`terms`][`timeControl`]; rated: boolean; levels?: { first?: string | undefined; second?: string | undefined } | undefined }): { status: number; code: string } | null {
    const states = state.duelStates ?? statesOf(state);
    const stateOf = (bot: BotListing) => states.find((each) => each.name === bot.name);
    const own = (bot: BotListing) => bot.ownerName === viewer;
    if (pair.some((bot) => !bot.online || (!bot.openForChallenges && !own(bot)))) return { status: 400, code: `not_open` };
    if (pair.some((bot) => stateOf(bot)?.duelsByOthers === false && !own(bot))) return { status: 400, code: `duel_refused` };
    if (pair.some((bot) => !acceptsCovers(bot.accepts, asked.timeControl))) return { status: 400, code: `clock_not_accepted` };
    const [first, second] = pair;
    const declares = (bot: BotListing, id: string | undefined) => id === undefined || bot.levels?.list.some((level) => level.id === id) === true;
    if (!declares(first, asked.levels?.first) || !declares(second, asked.levels?.second)) return { status: 400, code: `unknown_level` };
    if (pair.some((bot) => bot.liveGames >= botConcurrentGameCap || (stateOf(bot)?.dueling.length ?? 0) >= duelPerBotCap)) return { status: 400, code: `bot_busy` };
    const running = state.duels.filter((duel) => duel.status === `running`);
    if (running.some((duel) => [duel.first.name, duel.second.name].every((name) => name === first.name || name === second.name))) return { status: 400, code: `duel_live` };
    if (running.filter((duel) => duel.startedBy === viewer).length >= duelLiveCap) return { status: 400, code: `duel_busy` };
    const test = first.ownerName !== null && first.ownerName === second.ownerName;
    const atDefault = [asked.levels?.first, asked.levels?.second].every((id, index) => id === undefined || id === pair[index]?.levels?.default);
    if (asked.rated && !(own(first) !== own(second) && atDefault && !test)) return { status: 400, code: `unrated_only` };
    if (!test && !duelGameCounts.some((count) => count === asked.games)) return { status: 400, code: `test_only` };
    if (state.duels.filter((duel) => duel.startedBy === viewer).length >= duelDailyCap) return { status: 429, code: `daily_duel_cap` };
    return null;
}

// Each listed bot's switch on, and the bots it plays a running duel with.
function statesOf(state: World): DuelBotState[] {
    return state.bots.map((bot) => ({
        name: bot.name,
        duelsByOthers: state.settings[bot.name]?.duelsByOthers ?? true,
        dueling: state.duels
            .filter((duel) => duel.status === `running` && [duel.first.name, duel.second.name].includes(bot.name))
            .map((duel) => (duel.first.name === bot.name ? duel.second.name : duel.first.name)),
        roundRobins: 0,
    }));
}

const won = (side: DuelSide, count: number): Outcome[] => Array.from({ length: count }, () => side);

/** The duels and tests the mockups show. */
export const duelFixtures = {
    live: duelFixture({
        id: `d_devbotbclive`,
        first: duelBotOf(named(`devbot-b`), { now: { rating: 1519, provisional: false } }),
        second: duelBotOf(named(`devbot-c`)),
        kind: `duel`,
        startedBy: `bruno`,
        games: 10,
        rated: false,
        outcomes: [`first`, `first`, `first`, `live`],
        live: true,
        status: `running`,
    }),
    rated: duelFixture({
        id: `d_hextideqlake`,
        first: duelBotOf(named(`hextide`), { ratingAtStart: 2110, now: { rating: 2117, provisional: true } }),
        second: duelBotOf(named(`quietlake`), { ratingAtStart: 1427, now: { rating: 1420, provisional: true } }),
        kind: `duel`,
        startedBy: `ana`,
        games: 2,
        rated: true,
        outcomes: [`first`, `first`],
        live: false,
        status: `finished`,
        began: 0.4,
        ended: 0.2,
    }),
    test: duelFixture({
        id: `d_cinderpebble`,
        first: duelBotOf(named(`cinder`)),
        second: duelBotOf(named(`pebble`)),
        kind: `test`,
        startedBy: `ana`,
        games: 50,
        rated: false,
        // 31 to 19 by pairs: six pairs won whole, nineteen split.
        outcomes: [...won(`first`, 12), ...Array.from({ length: 19 }, (): Outcome[] => [`first`, `second`]).flat()],
        live: false,
        status: `finished`,
        began: 1.8,
        ended: 1,
    }),
    testLive: duelFixture({
        id: `d_cinderpblliv`,
        first: duelBotOf(named(`cinder`)),
        second: duelBotOf(named(`pebble`)),
        kind: `test`,
        startedBy: `ana`,
        games: 50,
        rated: false,
        outcomes: [...Array.from({ length: 9 }, (): Outcome[] => [`first`, `second`]).flat(), `first`, `first`, `none`, `first`, `live`],
        live: true,
        status: `running`,
        began: 0.3,
    }),
    cutShort: duelFixture({
        id: `d_pistoldevaa1`,
        first: duelBotOf(named(`Pistol1`)),
        second: duelBotOf(named(`devbot-a`)),
        kind: `duel`,
        startedBy: `ana`,
        games: 4,
        rated: false,
        outcomes: [`first`, `first`],
        live: false,
        status: `cut_short`,
        end: { reason: `offline`, bot: `second` },
        began: 3.5,
        ended: 3,
    }),
    sweep: duelFixture({
        id: `d_hextidepbl20`,
        first: duelBotOf(named(`hextide`)),
        second: duelBotOf(named(`pebble`)),
        kind: `test`,
        startedBy: `ana`,
        games: 20,
        rated: false,
        outcomes: won(`first`, 20),
        live: false,
        status: `finished`,
        began: 26,
        ended: 25,
    }),
};

/** Games of the duels as the history lists them: a duel's, unrated, and a test's, which shows only with tests asked. */
export const duelGameRows: FinishedGameEntry[] = [
    {
        gameId: `${duelFixtures.live.id}-3`,
        players: { x: { name: `devbot-b`, rating: 1519, provisional: false, kind: `bot` }, o: { name: `devbot-c`, rating: 1500, provisional: false, kind: `bot` } },
        winner: `x`,
        reason: `six-in-a-row`,
        timeControl: { mode: `turn`, turnTimeMs: 10_000 },
        openingPlies: 5,
        turns: 52,
        finishedAt: hoursAgo(0.02),
        rated: false,
        voided: false,
        unratedByChoice: true,
        duel: { id: duelFixtures.live.id, game: 3, of: 10 },
        analyses: 0,
    },
    {
        gameId: `${duelFixtures.testLive.id}-22`,
        players: { x: { name: `pebble`, rating: 1182, provisional: true, kind: `bot` }, o: { name: `cinder`, rating: 1500, provisional: true, kind: `bot` } },
        winner: `o`,
        reason: `six-in-a-row`,
        timeControl: { mode: `turn`, turnTimeMs: 10_000 },
        openingPlies: 5,
        turns: 33,
        finishedAt: hoursAgo(0.03),
        rated: false,
        voided: false,
        unratedByChoice: true,
        test: true,
        duel: { id: duelFixtures.testLive.id, game: 22, of: 50 },
        analyses: 0,
    },
    {
        gameId: `${duelFixtures.rated.id}-2`,
        players: { x: { name: `hextide`, rating: 2114, provisional: true, kind: `bot` }, o: { name: `quietlake`, rating: 1425, provisional: true, kind: `bot` } },
        winner: `x`,
        reason: `six-in-a-row`,
        timeControl: { mode: `turn`, turnTimeMs: 10_000 },
        openingPlies: 5,
        turns: 6,
        finishedAt: hoursAgo(0.07),
        rated: true,
        voided: false,
        duel: { id: duelFixtures.rated.id, game: 2, of: 2 },
        analyses: 0,
    },
];

/** Games of the running and the finished tournament as the history lists them. */
export const tournamentGameRows: FinishedGameEntry[] = [
    {
        gameId: `finished`,
        players: { x: seat.driftwood, o: seat.ember },
        winner: `o`,
        reason: `six-in-a-row`,
        timeControl: { mode: `turn`, turnTimeMs: 10_000 },
        openingPlies: 5,
        turns: 31,
        finishedAt: hoursAgo(0.05),
        rated: true,
        voided: false,
        tournament: { id: `t_autumnrobin1`, name: `Autumn round robin`, round: 2, game: 1 },
        analyses: 0,
    },
    {
        gameId: `summer-final`,
        players: { x: seat.sealbot, o: seat.hextide },
        winner: `x`,
        reason: `timeout`,
        timeControl: { mode: `turn`, turnTimeMs: 10_000 },
        openingPlies: 5,
        turns: 44,
        finishedAt: hoursAgo(199),
        rated: true,
        voided: false,
        tournament: { id: `t_summercup202`, name: `Summer cup`, round: 3, game: 1 },
        analyses: 0,
    },
];

/** A duel's live game and a test's, as their pages read them. */
export const duelGameSnapshots: Record<string, GameSnapshot> = {
    'duel-game': {
        gameId: `duel-game`,
        players: { x: { name: `devbot-c`, rating: 1500, provisional: false, kind: `bot` }, o: { name: `devbot-b`, rating: 1519, provisional: false, kind: `bot` } },
        openingPlies: 5,
        board: { cells: playedCells(37, 4) },
        timeControl: { mode: `turn`, turnTimeMs: 10_000 },
        duel: { id: duelFixtures.live.id, game: 4, of: 10 },
        unratedByChoice: true,
        status: `in-progress`,
        toMove: `o`,
        clock: { mode: `turn`, remainingTurnMs: 6_000 },
    },
    'test-game': {
        gameId: `test-game`,
        players: { x: { name: `cinder`, rating: 1500, provisional: true, kind: `bot` }, o: { name: `pebble`, rating: 1182, provisional: true, kind: `bot` } },
        openingPlies: 5,
        board: { cells: playedCells(29, 5) },
        timeControl: { mode: `turn`, turnTimeMs: 10_000 },
        duel: { id: duelFixtures.testLive.id, game: 23, of: 50 },
        unratedByChoice: true,
        test: true,
        status: `in-progress`,
        toMove: `x`,
        clock: { mode: `turn`, remainingTurnMs: 4_000 },
    },
};

/** ana, signed in, who owns three of the duel bots. */
export const anaMe: Me = { kind: `user`, name: `ana`, rating: 1402, provisional: false, discord: null, liveGames: [], analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } };

/** bruno, signed in, who started the live duel. */
export const brunoMe: Me = { kind: `user`, name: `bruno`, rating: 1460, provisional: false, discord: null, liveGames: [], analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } };

// Fixtures name the bots; a detail keys them by their place among its
// entries, as the server does, and its pairings carry the names.
// A bot in `gone` was deleted with its owner since, so the detail reads
// both by their labels, as the server writes them.
type NamedGame = Omit<TournamentGame, `x` | `point` | `missing`> & { x: string; point: string | null; missing: string[] };
interface NamedTournament extends Omit<TournamentDetail, `entries` | `rounds` | `standings`> {
    entries: Omit<TournamentEntry, `key`>[];
    rounds: { round: number; pairings: { first: string; second: string; games: NamedGame[] }[]; rest: string | null }[];
    standings: Omit<TournamentStanding, `key`>[];
    gone?: readonly string[];
}

function keyed({ gone = [], ...named }: NamedTournament): TournamentDetail {
    const keyOf = (bot: string) => {
        const index = named.entries.findIndex((entry) => entry.bot === bot);
        if (index === -1) throw new Error(`a fixture names a bot it never entered: ${bot}`);
        return index + 1;
    };
    const seatOf = (bot: string) => (gone.includes(bot) ? { key: keyOf(bot), name: `deleted bot`, deleted: true as const } : { key: keyOf(bot), name: bot });
    const shown = <Line extends { bot: string; ownerName: string }>(line: Line) =>
        gone.includes(line.bot) ? { ...line, bot: `deleted bot`, ownerName: `deleted player`, deleted: true as const } : line;
    return {
        ...named,
        entries: named.entries.map((entry, index) => shown({ key: index + 1, ...entry })),
        rounds: named.rounds.map((round) => ({
            round: round.round,
            pairings: round.pairings.map((pairing) => ({
                first: seatOf(pairing.first),
                second: seatOf(pairing.second),
                games: pairing.games.map((game) => ({ ...game, x: keyOf(game.x), point: game.point === null ? null : keyOf(game.point), missing: game.missing.map(keyOf) })),
            })),
            rest: round.rest === null ? null : seatOf(round.rest),
        })),
        standings: named.standings.map((line) => shown({ ...line, key: keyOf(line.bot) })),
    };
}

const tGame = (x: string, outcome: TournamentGame[`outcome`], point: string | null = null, gameId: string | null = null, missing: string[] = []): NamedGame => ({
    x,
    gameId,
    outcome,
    point,
    missing,
});
const playing = (bot: string, ownerName: string, ratingAtStart: number, online = true) => ({ bot, ownerName, online, ratingAtStart, state: `playing` as const });
const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString().replace(/\.\d{3}Z$/u, `Z`);

// A running round robin of four, the second round under way with one
// game live; one entrant missed the start.
const runningTournament: NamedTournament = {
    id: `t_autumnrobin1`,
    name: `Autumn round robin`,
    origin: `operator`,
    createdBy: null,
    rated: true,
    test: false,
    gamesPerPair: 2,
    status: `running`,
    startsAt: hoursFromNow(-1),
    startedAt: hoursFromNow(-1),
    endedAt: null,
    waiting: [],
    nextRoundAt: null,
    timeControl: { mode: `turn`, turnTimeMs: 10_000 },
    openingPlies: 5,
    maxEntrants: 12,
    entries: [
        playing(`sealbot`, `quinn`, 1712),
        playing(`hextide`, `ana`, 1690),
        playing(`driftwood`, `bruno`, 1388),
        playing(`ember`, `cleo`, 1320),
        { bot: `lantern`, ownerName: `dmitri`, online: false, ratingAtStart: null, state: `absent` },
    ],
    rounds: [
        {
            round: 1,
            pairings: [
                { first: `sealbot`, second: `ember`, games: [tGame(`sealbot`, `played`, `sealbot`, `won`), tGame(`ember`, `played`, `sealbot`, `five-finished`)] },
                { first: `hextide`, second: `driftwood`, games: [tGame(`hextide`, `played`, `driftwood`, `nine-finished`), tGame(`driftwood`, `no_show`, `driftwood`, null, [`hextide`])] },
            ],
            rest: null,
        },
        {
            round: 2,
            pairings: [
                { first: `hextide`, second: `sealbot`, games: [tGame(`hextide`, `live`, null, `live-1`), tGame(`sealbot`, `pending`)] },
                { first: `driftwood`, second: `ember`, games: [tGame(`driftwood`, `played`, `ember`, `finished`), tGame(`ember`, `pending`)] },
            ],
            rest: null,
        },
        {
            round: 3,
            pairings: [
                { first: `sealbot`, second: `driftwood`, games: [tGame(`sealbot`, `pending`), tGame(`driftwood`, `pending`)] },
                { first: `ember`, second: `hextide`, games: [tGame(`ember`, `pending`), tGame(`hextide`, `pending`)] },
            ],
            rest: null,
        },
    ],
    standings: [
        { rank: 1, bot: `sealbot`, ownerName: `quinn`, points: 2, asX: 1, asO: 1, withdrawn: false },
        { rank: 2, bot: `driftwood`, ownerName: `bruno`, points: 2, asX: 1, asO: 1, withdrawn: false },
        { rank: 3, bot: `ember`, ownerName: `cleo`, points: 1, asX: 0, asO: 1, withdrawn: false },
        { rank: 4, bot: `hextide`, ownerName: `ana`, points: 0, asX: 0, asO: 0, withdrawn: false },
    ],
    live: liveGames.slice(1, 2),
};

// Every game of the running one played out, sealbot first.
const finishedTournament: NamedTournament = {
    ...runningTournament,
    id: `t_summercup202`,
    name: `Summer cup`,
    status: `finished`,
    startsAt: hoursFromNow(-200),
    startedAt: hoursFromNow(-200),
    endedAt: hoursFromNow(-199),
    rounds: runningTournament.rounds.map((round) => ({
        ...round,
        pairings: round.pairings.map((pairing) => ({
            ...pairing,
            games: pairing.games.map((game, index) =>
                game.outcome === `pending` || game.outcome === `live` ? tGame(game.x, `played`, index === 0 ? pairing.first : pairing.second, `won`) : game,
            ),
        })),
    })),
    standings: [
        { rank: 1, bot: `sealbot`, ownerName: `quinn`, points: 4, asX: 2, asO: 2, withdrawn: false },
        { rank: 2, bot: `driftwood`, ownerName: `bruno`, points: 3, asX: 2, asO: 1, withdrawn: false },
        { rank: 2, bot: `hextide`, ownerName: `ana`, points: 3, asX: 2, asO: 1, withdrawn: false },
        { rank: 4, bot: `ember`, ownerName: `cleo`, points: 2, asX: 1, asO: 1, withdrawn: true },
    ],
    gone: [`driftwood`, `ember`],
    entries: [...runningTournament.entries.slice(0, 3), { bot: `ember`, ownerName: `cleo`, online: false, ratingAtStart: 1320, state: `withdrawn`, reason: `missed` }, { bot: `lantern`, ownerName: `dmitri`, online: false, ratingAtStart: null, state: `left_out`, reason: `daily_cap` }],
    live: [],
};

// One waiting a few hours, two bots entered; quinn, signed in by default, has entered none.
const waitingTournament: NamedTournament = {
    ...runningTournament,
    id: `t_wintercup202`,
    name: `Winter cup`,
    status: `scheduled`,
    startsAt: hoursFromNow(3),
    startedAt: null,
    entries: [
        { bot: `hextide`, ownerName: `ana`, online: true, ratingAtStart: null, state: `entered` },
        { bot: `driftwood`, ownerName: `bruno`, online: false, ratingAtStart: null, state: `entered` },
    ],
    rounds: [],
    standings: [],
    live: [],
};

const calledOffTournament: NamedTournament = {
    ...waitingTournament,
    id: `t_raincup20261`,
    name: `Rain cup`,
    status: `called_off`,
    startsAt: hoursFromNow(-30),
    endedAt: hoursFromNow(-30),
    entries: [
        { bot: `hextide`, ownerName: `ana`, online: true, ratingAtStart: null, state: `entered` },
        { bot: `driftwood`, ownerName: `bruno`, online: false, ratingAtStart: null, state: `absent` },
        { bot: `ember`, ownerName: `cleo`, online: true, ratingAtStart: null, state: `entered` },
    ],
};

export const tournaments: TournamentDetail[] = [runningTournament, waitingTournament, finishedTournament, calledOffTournament].map(keyed);

const secondsFromNow = (seconds: number) => new Date(Date.now() + seconds * 1_000).toISOString().replace(/\.\d{3}Z$/u, `Z`);
const club = { id: `club`, label: `club` };
const robinLive = (id: string, name: string, createdBy: string, round: number): LiveGameEntry => ({
    ...structuredClone(liveGames[1] ?? liveGames[0] ?? (() => { throw new Error(`no live game`); })()),
    gameId: `${id}-live`,
    players: { x: { name: `hextide`, rating: 2117, provisional: true, kind: `bot` }, o: { name: `Pistol1`, rating: null, provisional: false, kind: `bot`, level: club } },
    rated: false,
    tournament: { id, name, round, game: 1, createdBy },
});

// bruno's round robin of four, round 2 under way: hextide and Pistol1 at
// their first game, devbot-b waiting for quietlake; Pistol1 plays at club.
const brunoLive: NamedTournament = {
    id: `t_brunorobin01`,
    name: `Round robin by bruno`,
    origin: `person`,
    createdBy: `bruno`,
    rated: false,
    test: false,
    gamesPerPair: 2,
    status: `running`,
    startsAt: hoursFromNow(-1),
    startedAt: hoursFromNow(-1),
    endedAt: null,
    timeControl: { mode: `turn`, turnTimeMs: 10_000 },
    openingPlies: 5,
    maxEntrants: 4,
    entries: [
        { ...playing(`hextide`, `ana`, 2117), version: `1.4.0` },
        { bot: `Pistol1`, ownerName: `bruno`, online: true, ratingAtStart: null, state: `playing`, level: club },
        playing(`devbot-b`, `devowner-b`, 1519),
        playing(`quietlake`, `dmitri`, 1460, false),
    ],
    rounds: [
        {
            round: 1,
            pairings: [
                { first: `hextide`, second: `quietlake`, games: [tGame(`hextide`, `played`, `hextide`, `won`), tGame(`quietlake`, `played`, `hextide`, `five-finished`)] },
                { first: `Pistol1`, second: `devbot-b`, games: [tGame(`Pistol1`, `played`, `Pistol1`, `nine-finished`), tGame(`devbot-b`, `played`, `devbot-b`, `finished`)] },
            ],
            rest: null,
        },
        {
            round: 2,
            pairings: [
                { first: `hextide`, second: `Pistol1`, games: [tGame(`hextide`, `live`, null, `t_brunorobin01-live`), tGame(`Pistol1`, `pending`)] },
                { first: `devbot-b`, second: `quietlake`, games: [tGame(`devbot-b`, `pending`), tGame(`quietlake`, `pending`)] },
            ],
            rest: null,
        },
        {
            round: 3,
            pairings: [
                { first: `hextide`, second: `devbot-b`, games: [tGame(`hextide`, `pending`), tGame(`devbot-b`, `pending`)] },
                { first: `quietlake`, second: `Pistol1`, games: [tGame(`quietlake`, `pending`), tGame(`Pistol1`, `pending`)] },
            ],
            rest: null,
        },
    ],
    standings: [
        { rank: 1, bot: `hextide`, ownerName: `ana`, points: 2, asX: 1, asO: 1, withdrawn: false },
        { rank: 2, bot: `Pistol1`, ownerName: `bruno`, points: 1, asX: 1, asO: 0, withdrawn: false },
        { rank: 2, bot: `devbot-b`, ownerName: `devowner-b`, points: 1, asX: 1, asO: 0, withdrawn: false },
        { rank: 4, bot: `quietlake`, ownerName: `dmitri`, points: 0, asX: 0, asO: 0, withdrawn: false },
    ],
    live: [robinLive(`t_brunorobin01`, `Round robin by bruno`, `bruno`, 2)],
    waiting: [{ key: 4, until: secondsFromNow(42) }],
    nextRoundAt: null,
};

// The same played out, hextide first with 5 of 6.
const brunoFinished: NamedTournament = {
    ...brunoLive,
    id: `t_brunorobin02`,
    status: `finished`,
    startsAt: hoursFromNow(-30),
    startedAt: hoursFromNow(-30),
    endedAt: hoursFromNow(-29),
    rounds: brunoLive.rounds.map((round) => ({
        ...round,
        pairings: round.pairings.map((pairing) => ({
            ...pairing,
            games: pairing.games.map((game, index) =>
                game.outcome === `pending` || game.outcome === `live` ? tGame(game.x, `played`, index === 0 ? pairing.first : pairing.second, `won`) : game,
            ),
        })),
    })),
    standings: [
        { rank: 1, bot: `hextide`, ownerName: `ana`, points: 5, asX: 3, asO: 2, withdrawn: false },
        { rank: 2, bot: `Pistol1`, ownerName: `bruno`, points: 3, asX: 2, asO: 1, withdrawn: false },
        { rank: 3, bot: `devbot-b`, ownerName: `devowner-b`, points: 2, asX: 2, asO: 0, withdrawn: false },
        { rank: 4, bot: `quietlake`, ownerName: `dmitri`, points: 2, asX: 1, asO: 1, withdrawn: true },
    ],
    entries: [...brunoLive.entries.slice(0, 3), { bot: `quietlake`, ownerName: `dmitri`, online: false, ratingAtStart: 1460, state: `withdrawn`, reason: `refused` }],
    live: [],
    waiting: [],
};

// bruno's stopped after round 1 by bruno himself.
const brunoStopped: NamedTournament = {
    ...brunoLive,
    id: `t_brunorobin03`,
    status: `stopped`,
    endedAt: hoursFromNow(-0.5),
    end: { reason: `creator`, round: 1 },
    rounds: brunoLive.rounds.map((round) => (round.round === 1 ? round : { ...round, pairings: round.pairings.map((pairing) => ({ ...pairing, games: pairing.games.map((game) => tGame(game.x, `not_played`)) })) })),
    standings: [
        { rank: 1, bot: `hextide`, ownerName: `ana`, points: 2, asX: 1, asO: 1, withdrawn: false },
        { rank: 2, bot: `Pistol1`, ownerName: `bruno`, points: 1, asX: 1, asO: 0, withdrawn: false },
        { rank: 2, bot: `devbot-b`, ownerName: `devowner-b`, points: 1, asX: 1, asO: 0, withdrawn: false },
        { rank: 4, bot: `quietlake`, ownerName: `dmitri`, points: 0, asX: 0, asO: 0, withdrawn: false },
    ],
    live: [],
    waiting: [],
};

// quinn's own, so the default reader may stop it.
const quinnLive: NamedTournament = { ...brunoLive, id: `t_quinnrobin01`, name: `Round robin by quinn`, createdBy: `quinn`, live: [robinLive(`t_quinnrobin01`, `Round robin by quinn`, `quinn`, 2)], waiting: [] };

const legs = (first: string, second: string, points: readonly string[]): NamedGame[] => points.map((point, index) => tGame(index % 2 === 0 ? first : second, `played`, point, `won`));
const estimate = (games: number, first: number, rating: number, low: number | null, high: number | null, chance: number, verdict: `stronger` | `likely_stronger` | `too_close`, narrowed: number) => ({
    games,
    points: { first, second: games - first },
    rating,
    low,
    high,
    chance,
    favored: rating > 0 ? (`first` as const) : rating < 0 ? (`second` as const) : null,
    verdict,
    narrowed,
});

// ana's test of her three bots, four games a pair, played out.
const anaTest: NamedTournament = {
    ...brunoLive,
    id: `t_anatest00001`,
    name: `Round robin by ana`,
    createdBy: `ana`,
    test: true,
    gamesPerPair: 4,
    status: `finished`,
    startsAt: hoursFromNow(-3),
    startedAt: hoursFromNow(-3),
    endedAt: hoursFromNow(-2),
    maxEntrants: 3,
    entries: [
        { ...playing(`hextide`, `ana`, 2117), version: `1.4.0` },
        { ...playing(`cinder`, `ana`, 1500), version: `0.9.2` },
        { ...playing(`pebble`, `ana`, 1182), version: `0.3.1` },
    ],
    rounds: [
        { round: 1, pairings: [{ first: `pebble`, second: `cinder`, games: legs(`pebble`, `cinder`, [`cinder`, `cinder`, `pebble`, `cinder`]) }], rest: `hextide` },
        { round: 2, pairings: [{ first: `pebble`, second: `hextide`, games: legs(`pebble`, `hextide`, [`hextide`, `hextide`, `hextide`, `hextide`]) }], rest: `cinder` },
        { round: 3, pairings: [{ first: `hextide`, second: `cinder`, games: legs(`hextide`, `cinder`, [`hextide`, `cinder`, `hextide`, `hextide`]) }], rest: `pebble` },
    ],
    standings: [
        { rank: 1, bot: `hextide`, ownerName: `ana`, points: 7, asX: 4, asO: 3, withdrawn: false },
        { rank: 2, bot: `cinder`, ownerName: `ana`, points: 4, asX: 2, asO: 2, withdrawn: false },
        { rank: 3, bot: `pebble`, ownerName: `ana`, points: 1, asX: 1, asO: 0, withdrawn: false },
    ],
    live: [],
    waiting: [],
    estimates: [
        { key: 1, estimate: estimate(8, 7, 191, 41, 480, 0.99, `stronger`, 125) },
        { key: 2, estimate: estimate(8, 4, 0, -233, 233, 0.5, `too_close`, 110) },
        { key: 3, estimate: estimate(8, 1, -232, -683, -72, 0.004, `stronger`, 90) },
    ],
};

/** The round robins people set up: bruno's live, played out, and stopped, quinn's own live, and ana's test. */
export const roundRobins: TournamentDetail[] = [brunoLive, brunoFinished, brunoStopped, quinnLive, anaTest].map(keyed);

function summaryOf(detail: TournamentDetail): TournamentSummary {
    const top = detail.standings[0];
    return {
        id: detail.id,
        name: detail.name,
        origin: detail.origin,
        createdBy: detail.createdBy,
        rated: detail.rated,
        test: detail.test,
        gamesPerPair: detail.gamesPerPair,
        status: detail.status,
        startsAt: detail.startsAt,
        timeControl: detail.timeControl,
        openingPlies: detail.openingPlies,
        entrants: detail.startedAt === null ? detail.entries.length : detail.standings.length,
        maxEntrants: detail.maxEntrants,
        winner: detail.status === `finished` && top !== undefined ? { name: top.bot, ownerName: top.ownerName } : null,
        round: detail.status === `running` && detail.rounds.length > 0 ? { current: 1 + detail.rounds.findIndex((round) => round.pairings.some((pairing) => pairing.games.some((game) => game.outcome === `pending` || game.outcome === `live`))), of: detail.rounds.length } : null,
        ...(detail.endedAt === null ? {} : { endedAt: detail.endedAt }),
    };
}

// A bot's entry and where it stands, as the list for that bot names it.
function placeOf(detail: TournamentDetail, bot: string): TournamentPlace | null {
    const entry = detail.entries.find((each) => each.bot === bot);
    if (entry === undefined) return null;
    const line = detail.standings.find((each) => each.bot === bot);
    return { state: entry.state, ...(entry.reason === undefined ? {} : { reason: entry.reason }), rank: line?.rank ?? null, points: line?.points ?? null };
}

const midCells: GameSnapshot[`board`][`cells`] = [
    { x: 0, y: 0, side: `x` },
    { x: 1, y: -1, side: `o` },
    { x: -1, y: 1, side: `o` },
    { x: 1, y: 0, side: `x` },
    { x: 2, y: -1, side: `x` },
    { x: 0, y: 1, side: `o` },
    { x: -1, y: 2, side: `o` },
    { x: -1, y: 0, side: `x` },
    { x: 0, y: -1, side: `x` },
    { x: 1, y: 1, side: `o` },
    { x: 2, y: 0, side: `o` },
];

// A game from the origin alone, won by x with six along y = 0.
const originCells: GameSnapshot[`board`][`cells`] = [
    { x: 0, y: 0, side: `x` },
    { x: 0, y: 1, side: `o` },
    { x: 1, y: 1, side: `o` },
    { x: 1, y: 0, side: `x` },
    { x: 2, y: 0, side: `x` },
    { x: 0, y: 2, side: `o` },
    { x: 1, y: 2, side: `o` },
    { x: 3, y: 0, side: `x` },
    { x: 4, y: 0, side: `x` },
    { x: 2, y: 2, side: `o` },
    { x: -1, y: 2, side: `o` },
    { x: 5, y: 0, side: `x` },
];

// The default signed-in user sits on x, facing a bot on o; whoever else
// opens the game watches it.
function facing(bot: string, rating: number): GameSnapshot[`players`] {
    return {
        x: { name: `quinn`, rating: 1503, provisional: false, kind: `user` },
        o: { name: bot, rating, provisional: false, kind: `bot` },
    };
}

// Sixty turns and more, ring by ring around the origin: a feed longer than
// any viewport, which the drawer must scroll instead of growing the stage.
const longCells: GameSnapshot[`board`][`cells`] = (() => {
    const steps = [
        { x: -1, y: 1 },
        { x: -1, y: 0 },
        { x: 0, y: -1 },
        { x: 1, y: -1 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
    ];
    const cells: { x: number; y: number }[] = [{ x: 0, y: 0 }];
    for (let ring = 1; cells.length < 121; ring += 1) {
        let cell = { x: ring, y: 0 };
        for (const step of steps) {
            for (let walk = 0; walk < ring; walk += 1) {
                cells.push(cell);
                cell = { x: cell.x + step.x, y: cell.y + step.y };
            }
        }
    }
    return cells.slice(0, 121).map((cell, ply) => ({
        ...cell,
        side: ply === 0 || Math.floor((ply - 1) / 2) % 2 === 1 ? (`x` as const) : (`o` as const),
    }));
})();

export const games: Record<string, GameSnapshot> = {
    long: {
        gameId: `long`,
        players: facing(`sealbot`, 1712),
        openingPlies: 5,
        board: { cells: longCells },
        timeControl: { mode: `turn`, turnTimeMs: 30_000 },
        status: `in-progress`,
        toMove: `x`,
        clock: { mode: `turn`, remainingTurnMs: 21_000 },
    },
    running: {
        gameId: `running`,
        players: facing(`sealbot`, 1712),
        openingPlies: 5,
        board: { cells: midCells },
        timeControl: { mode: `match`, mainTimeMs: 300_000, incrementMs: 2_000 },
        status: `in-progress`,
        toMove: `x`,
        clock: { mode: `match`, remainingMainMs: { x: 227_000, o: 252_000 } },
    },
    // Games before their first turn, the opening alone on the board, so
    // the rundown stands over the stage: one the bot opens, one quinn opens.
    fresh: {
        gameId: `fresh`,
        players: facing(`sealbot`, 1712),
        openingPlies: 5,
        board: { cells: midCells.slice(0, 5) },
        timeControl: { mode: `turn`, turnTimeMs: 30_000 },
        status: `in-progress`,
        toMove: `o`,
        clock: { mode: `turn`, remainingTurnMs: 28_000 },
    },
    // quinn against sealbot at a level other than its default, before the first turn.
    practice: {
        gameId: `practice`,
        players: { x: facing(`sealbot`, 1712).x, o: { name: `sealbot`, rating: null, provisional: false, kind: `bot`, level: atQuick } },
        openingPlies: 5,
        board: { cells: midCells.slice(0, 5) },
        timeControl: { mode: `turn`, turnTimeMs: 30_000 },
        status: `in-progress`,
        toMove: `o`,
        clock: { mode: `turn`, remainingTurnMs: 28_000 },
    },
    // quinn against sealbot at its default, started with Rated off, before the first turn.
    unrated: {
        gameId: `unrated`,
        players: facing(`sealbot`, 1712),
        openingPlies: 5,
        board: { cells: midCells.slice(0, 5) },
        timeControl: { mode: `turn`, turnTimeMs: 30_000 },
        status: `in-progress`,
        toMove: `o`,
        clock: { mode: `turn`, remainingTurnMs: 28_000 },
        unratedByChoice: true,
    },
    // A long label and name, the top chip's hardest case.
    'practice-long': {
        gameId: `practice-long`,
        players: { x: facing(`sealbot`, 1712).x, o: { name: `quietlake`, rating: null, provisional: false, kind: `bot`, level: { id: `6400`, label: `6400 sims`, budget: { playouts: 6400, timeMs: 5000 } } } },
        openingPlies: 5,
        board: { cells: midCells.slice(0, 5) },
        timeControl: { mode: `turn`, turnTimeMs: 30_000 },
        status: `in-progress`,
        toMove: `o`,
        clock: { mode: `turn`, remainingTurnMs: 28_000 },
    },
    'fresh-yours': {
        gameId: `fresh-yours`,
        players: facing(`sealbot`, 1712),
        openingPlies: 3,
        board: { cells: midCells.slice(0, 3) },
        timeControl: { mode: `turn`, turnTimeMs: 30_000 },
        status: `in-progress`,
        toMove: `x`,
        clock: { mode: `turn`, remainingTurnMs: 28_000 },
    },
    waiting: {
        gameId: `waiting`,
        players: facing(`sealbot`, 1712),
        openingPlies: 5,
        board: { cells: midCells.slice(0, 9) },
        timeControl: { mode: `match`, mainTimeMs: 300_000, incrementMs: 2_000 },
        status: `in-progress`,
        toMove: `o`,
        clock: { mode: `match`, remainingMainMs: { x: 227_000, o: 252_000 } },
    },
    hurry: {
        gameId: `hurry`,
        players: facing(`sealbot`, 1712),
        openingPlies: 5,
        board: { cells: midCells },
        timeControl: { mode: `turn`, turnTimeMs: 30_000 },
        status: `in-progress`,
        toMove: `x`,
        clock: { mode: `turn`, remainingTurnMs: 8_000 },
    },
    finished: {
        gameId: `finished`,
        players: facing(`hextide`, 1690),
        openingPlies: 1,
        board: { cells: originCells },
        timeControl: { mode: `turn`, turnTimeMs: 30_000 },
        status: `finished`,
        winner: `x`,
        reason: `six-in-a-row`,
        voided: false,
    },
    // The newest result, apart from the finished game the game screen's
    // tests use, so a path never names both.
    won: {
        gameId: `won`,
        players: facing(`hextide`, 1690),
        openingPlies: 1,
        board: { cells: originCells },
        timeControl: { mode: `turn`, turnTimeMs: 30_000 },
        status: `finished`,
        winner: `x`,
        reason: `six-in-a-row`,
        voided: false,
    },
    origin: {
        gameId: `origin`,
        players: facing(`hextide`, 1690),
        openingPlies: 1,
        board: { cells: originCells.slice(0, 7) },
        timeControl: { mode: `turn`, turnTimeMs: 30_000 },
        status: `in-progress`,
        toMove: `x`,
        clock: { mode: `turn`, remainingTurnMs: 21_000 },
    },
    nine: {
        gameId: `nine`,
        players: facing(`sealbot`, 1712),
        openingPlies: 9,
        board: { cells: midCells },
        timeControl: { mode: `match`, mainTimeMs: 300_000, incrementMs: 2_000 },
        status: `in-progress`,
        toMove: `x`,
        clock: { mode: `match`, remainingMainMs: { x: 227_000, o: 252_000 } },
    },
    'five-finished': {
        gameId: `five-finished`,
        players: facing(`sealbot`, 1712),
        openingPlies: 5,
        board: { cells: midCells },
        timeControl: { mode: `turn`, turnTimeMs: 30_000 },
        status: `finished`,
        winner: `o`,
        reason: `surrender`,
        voided: false,
    },
    guest: {
        gameId: `guest`,
        players: {
            x: { name: `sealbot`, rating: 1712, provisional: false, kind: `bot` },
            o: { name: `Guest k3f9`, rating: null, provisional: false, kind: `guest` },
        },
        openingPlies: 5,
        board: { cells: midCells.slice(0, 9) },
        timeControl: { mode: `turn`, turnTimeMs: 30_000 },
        status: `in-progress`,
        toMove: `o`,
        clock: { mode: `turn`, remainingTurnMs: 38_000 },
    },
    // A finished game whose human seat deleted the account since.
    gone: {
        gameId: `gone`,
        players: { x: seat.sealbot, o: seat.gone },
        openingPlies: 1,
        board: { cells: originCells },
        timeControl: { mode: `turn`, turnTimeMs: 30_000 },
        status: `finished`,
        winner: `x`,
        reason: `six-in-a-row`,
        voided: false,
    },
    // A long game over, for the analysis board: o's six on turn 25, two turns drawn.
    'long-finished': {
        gameId: `long-finished`,
        players: {
            x: { name: `hextide`, rating: 1690, provisional: false, kind: `bot` },
            o: { name: `quietlake`, rating: 1461, provisional: false, kind: `bot` },
        },
        openingPlies: 5,
        board: { cells: longCells.slice(0, 51) },
        timeControl: { mode: `turn`, turnTimeMs: 30_000 },
        status: `finished`,
        winner: `o`,
        reason: `six-in-a-row`,
        voided: false,
    },
    'nine-finished': {
        gameId: `nine-finished`,
        players: facing(`sealbot`, 1712),
        openingPlies: 9,
        board: {
            cells: [
                ...midCells,
                { x: 3, y: -2, side: `x` },
                { x: 3, y: -1, side: `x` },
            ],
        },
        timeControl: { mode: `turn`, turnTimeMs: 30_000 },
        status: `finished`,
        winner: `x`,
        reason: `timeout`,
        voided: false,
    },
};

// long-finished read whole: the best line's value at the position before
// each turn, x-positive, a forced win as winIn, counted in turns from the
// board after the line, its side to move first; a line completing six
// carries 1 for its mover. x slips on turn 6; from turn 10 the board holds
// o sixes that o leaves untaken, a blunder on each of its turns, and x, lost
// until it could block again, leaves o a six on 20 and 22 and gives away its
// own on 24; o completes six on 25.
const longStones = longCells.slice(0, 51);
const longBest: Readonly<Record<number, number | { winIn: number }>> = {
    3: 0.02, 4: 0.05, 5: 0.08, 6: 0.17, 7: 0.05, 8: 0.1, 9: 0.12, 10: 0.15, 11: 0.2, 12: 0.24, 13: 0.28, 14: 0.33,
    15: 0.12, 16: 0.1, 17: 0.08, 18: 0.45, 19: 0.4, 20: 0.22, 21: 0.15, 22: -0.12, 23: { winIn: -2 }, 24: { winIn: -1 }, 25: { winIn: -1 },
};
const longFirstTurn = 3;
const longLastTurn = 25;
const longPositions = longLastTurn - longFirstTurn + 1;

function longPlayed(turn: number): { x: number; y: number }[] {
    return longStones.slice(2 * turn - 1, 2 * turn + 1).map((cell) => ({ x: cell.x, y: cell.y }));
}

// Lines best first, each worse for the mover by a step: on turn 22 the
// third is the turn x played, which hands o the win, and on turn 25 the
// first is o's six.
function longTurn(turn: number, count: number, scale: number): AnalysisTurn {
    const toMove: Side = turn % 2 === 1 ? `o` : `x`;
    const sign = toMove === `x` ? 1 : -1;
    const best = longBest[turn] ?? 0;
    const free = freeCells(longStones.slice(0, 2 * turn - 1));
    const lines = Array.from({ length: count }, (_, rank): AnalysisLine => {
        const cells = [free[rank * 2] ?? { x: 0, y: 0 }, free[rank * 2 + 1] ?? { x: 0, y: 0 }];
        if (turn === 22 && rank === 2) return { cells: longPlayed(22), winIn: -3 };
        if (turn === longLastTurn && rank === 0) return { cells: longPlayed(turn), winIn: -1 };
        if (typeof best !== `number`) return rank === 0 ? { cells, winIn: best.winIn } : { cells, heuristic: -0.4 - 0.1 * rank };
        return { cells, heuristic: Math.round((best * scale - sign * 0.07 * rank) * 100) / 100 };
    });
    return { turn, toMove, lines };
}

function longTurns(upTo: number, count: number, scale = 1): AnalysisTurn[] {
    return Array.from({ length: upTo - longFirstTurn + 1 }, (_, index) => longTurn(longFirstTurn + index, count, scale));
}

// Each bot's view of its own turns: its played turn first, a little
// kinder to itself than kestrel, then two turns it considered.
function longOwn(side: Side, player: string): OwnAnalysis {
    const turns: AnalysisTurn[] = [];
    for (let turn = side === `o` ? 3 : 4; turn <= longLastTurn; turn += 2) {
        const next = longBest[turn + 1] ?? { winIn: side === `o` ? -1 : 1 };
        const free = freeCells(longStones.slice(0, 2 * turn - 1));
        const own: AnalysisLine =
            typeof next === `number`
                ? { cells: longPlayed(turn), heuristic: Math.round((next + (side === `x` ? 0.1 : -0.05)) * 100) / 100 }
                : { cells: longPlayed(turn), winIn: turn === longLastTurn ? next.winIn : ownWinIn(next.winIn, side === `x` ? `o` : `x`) };
        turns.push({
            turn,
            toMove: side,
            lines: [own, { cells: [free[0] ?? { x: 0, y: 0 }, free[1] ?? { x: 0, y: 0 }], heuristic: 0.05 }, { cells: [free[2] ?? { x: 0, y: 0 }, free[3] ?? { x: 0, y: 0 }], heuristic: -0.05 }],
        });
    }
    return { kind: `own`, side, player, values: undeclaredValues, turns };
}

// A forced win the next mover's best line finds counts from the board after that line,
// a turn after the one a played turn describes: one turn more, unless the line is that mover's six.
function ownWinIn(next: number, nextMover: Side): number {
    const nextWins = next > 0 === (nextMover === `x`);
    return nextWins && Math.abs(next) === 1 ? next : next + Math.sign(next);
}

const kestrelRef = { name: `kestrel`, version: `0.9`, ownerName: `tom`, values: winChanceValues };
const readAt = new Date(Date.UTC(2026, 9, 1, 12)).toISOString();

/**
 * long-finished's readings in each state a community reading passes through, and both bots' own views;
 * and one by hextide, an analyzer as well as x's seat, which played in the game it read.
 */
export const longReadings: {
    kestrel: CommunityAnalysis;
    driftwood: CommunityAnalysis;
    hextide: CommunityAnalysis;
    running: CommunityAnalysis;
    queued: CommunityAnalysis;
    failed: CommunityAnalysis;
    own: OwnAnalysis[];
} = {
    kestrel: { kind: `community`, analysisId: `a_6b1f0c3e-2d4a-4e5b-8c6d-7e8f9a0b1c2d`, analyzer: kestrelRef, involved: false, status: `done`, requestedAt: readAt, finishedAt: readAt, progress: { done: longPositions, of: longPositions }, seconds: 2, turns: longTurns(longLastTurn, 3) },
    driftwood: {
        kind: `community`,
        analysisId: `a_7c2a1d4f-3e5b-4f6c-9d7e-8f9a0b1c2d3e`,
        analyzer: { name: `driftwood`, version: null, ownerName: `mika`, values: undeclaredValues },
        involved: false,
        status: `done`,
        requestedAt: readAt,
        finishedAt: readAt,
        progress: { done: longPositions, of: longPositions },
        seconds: 2,
        turns: longTurns(longLastTurn, 2, 0.8),
    },
    hextide: {
        kind: `community`,
        analysisId: `a_5a0e9b2d-1c3f-4d4a-9b5c-6d7e8f9a0b1c`,
        analyzer: { name: `hextide`, version: `2.1`, ownerName: `ana`, values: winChanceValues },
        involved: true,
        status: `done`,
        requestedAt: readAt,
        finishedAt: readAt,
        progress: { done: longPositions, of: longPositions },
        seconds: 2,
        turns: longTurns(longLastTurn, 3),
    },
    running: { kind: `community`, analysisId: `a_8d3b2e5a-4f6c-4a7d-8e8f-9a0b1c2d3e4f`, analyzer: kestrelRef, involved: false, status: `running`, requestedAt: readAt, finishedAt: null, progress: { done: 10, of: longPositions }, seconds: 2, turns: longTurns(12, 3) },
    queued: { kind: `community`, analysisId: `a_8d3b2e5a-4f6c-4a7d-8e8f-9a0b1c2d3e4f`, analyzer: null, involved: false, status: `queued`, requestedAt: readAt, finishedAt: null, queuePosition: 3, progress: { done: 0, of: longPositions }, seconds: 2, turns: [] },
    failed: {
        kind: `community`,
        analysisId: `a_9e4c3f6b-5a7d-4b8e-9f0a-0b1c2d3e4f5a`,
        analyzer: kestrelRef,
        involved: false,
        status: `failed`,
        failure: `timeout`,
        failedTurn: 14,
        requestedAt: readAt,
        finishedAt: readAt,
        progress: { done: 11, of: longPositions },
        seconds: 2,
        turns: [],
    },
    own: [longOwn(`x`, `hextide`), longOwn(`o`, `quietlake`)],
};

/** The positions a whole-game reading of a finished game reads: from the first turn after the opening, and the final board unless a six ended it. */
function positionsOf(snapshot: GameSnapshot): number {
    const firstTurn = (snapshot.openingPlies + 1) / 2;
    const lastTurn = Math.ceil((snapshot.board.cells.length - 1) / 2);
    const six = snapshot.status === `finished` && snapshot.reason === `six-in-a-row`;
    return Math.max(0, lastTurn - firstTurn + (six ? 1 : 2));
}

// The latest results, newest first; the first three have snapshots, so a
// frozen board can show the newest.
const finishedAt = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
export const recentGames: FinishedGameEntry[] = [
    { gameId: `won`, players: facing(`hextide`, 1690), winner: `x`, reason: `six-in-a-row`, timeControl: { mode: `turn`, turnTimeMs: 30_000 }, openingPlies: 1, turns: 12, finishedAt: finishedAt(3), rated: true, voided: false, analyses: 0 },
    { gameId: `five-finished`, players: facing(`sealbot`, 1712), winner: `o`, reason: `surrender`, timeControl: { mode: `turn`, turnTimeMs: 30_000 }, openingPlies: 5, turns: 5, finishedAt: finishedAt(41), rated: true, voided: false, analyses: 0 },
    { gameId: `nine-finished`, players: facing(`sealbot`, 1712), winner: `x`, reason: `timeout`, timeControl: { mode: `turn`, turnTimeMs: 30_000 }, openingPlies: 9, turns: 6, finishedAt: finishedAt(95), rated: true, voided: false, analyses: 0 },
    ...(
        [
            [seat.hextide, seat.sealbot, `o`, `six-in-a-row`],
            [seat.quietlake, seat.driftwood, `x`, `timeout`],
            [seat.ember, seat.hextide, null, `aborted`],
            [seat.sealbot, seat.quietlake, `x`, `six-in-a-row`],
            [seat.driftwood, seat.ember, `o`, `disconnect`],
        ] as const
    ).map(([x, o, winner, reason], index): FinishedGameEntry => ({
        gameId: `past-${String(index)}`,
        players: { x, o },
        winner,
        reason,
        timeControl: { mode: `match`, mainTimeMs: 300_000, incrementMs: 2_000 },
        openingPlies: 1,
        turns: 20 + index,
        finishedAt: finishedAt(180 + 600 * index),
        rated: winner !== null,
        voided: false,
        analyses: 0,
    })),
];

/** The latest results with a deleted player's game and a guest's on top, as the list names them. */
export const keptNames: FinishedGameEntry[] = [
    { gameId: `gone`, players: { x: seat.sealbot, o: seat.gone }, winner: `x`, reason: `six-in-a-row`, timeControl: { mode: `turn`, turnTimeMs: 30_000 }, openingPlies: 1, turns: 14, finishedAt: finishedAt(1), rated: true, voided: false, analyses: 0 },
    { gameId: `guest-finished`, players: { x: { ...seat.sealbot, rating: null }, o: seat.guest }, winner: `o`, reason: `surrender`, timeControl: { mode: `turn`, turnTimeMs: 30_000 }, openingPlies: 1, turns: 9, finishedAt: finishedAt(2), rated: false, voided: false, analyses: 0 },
    { gameId: `practice-finished`, players: { x: { ...seat.quinn, rating: null }, o: seat.quietlakeQuick }, winner: `x`, reason: `six-in-a-row`, timeControl: { mode: `turn`, turnTimeMs: 30_000 }, openingPlies: 1, turns: 11, finishedAt: finishedAt(2.5), rated: false, voided: false, analyses: 0 },
    ...recentGames,
];

/**
 * A long history between two bots, newest first: past the ten pages one
 * filter set reaches, with each side and each result in it.
 */
export function rivalry(count: number): FinishedGameEntry[] {
    return Array.from({ length: count }, (_, index): FinishedGameEntry => {
        const hextideX = index % 2 === 0;
        const winner = index % 7 === 6 ? null : index % 3 === 0 ? (hextideX ? `o` : `x`) : hextideX ? `x` : `o`;
        return {
            gameId: `rival-${String(index)}`,
            players: hextideX ? { x: seat.hextide, o: seat.quietlake } : { x: seat.quietlake, o: seat.hextide },
            winner,
            reason: winner === null ? `aborted` : `six-in-a-row`,
            timeControl: index % 4 === 3 ? { mode: `unlimited` } : { mode: `turn`, turnTimeMs: 10_000 },
            openingPlies: index % 5 === 0 ? 1 : 5,
            turns: 18 + (index % 23),
            finishedAt: finishedAt(240 + 37 * index),
            rated: winner !== null,
            voided: false,
            analyses: 0,
        };
    });
}

const pageSize = 20;

// The finished-games read over a world's games: every filter, the cursor's
// pages up to the cap, the record of a named player, and a refusal for a
// name no seat or listing holds.
function finishedPage(state: World, params: URLSearchParams): { status: 200; body: FinishedGamesPage } | { status: 400 | 404 } {
    const parsed = finishedGamesQuerySchema.safeParse(Object.fromEntries(params));
    if (!parsed.success) return { status: 400 };
    const query = parsed.data;
    const key = (name: string) => name.toLowerCase();
    const known = new Set([
        ...state.finished.flatMap((game) => [key(game.players.x.name), key(game.players.o.name)]),
        ...state.bots.map((bot) => key(bot.name)),
        ...state.leaderboard.map((entry) => key(entry.name)),
    ]);
    if ((query.player !== undefined && !known.has(key(query.player))) || (query.vs !== undefined && !known.has(key(query.vs)))) return { status: 404 };
    const sideOf = (game: FinishedGameEntry, name: string): Side | null =>
        key(game.players.x.name) === key(name) ? `x` : key(game.players.o.name) === key(name) ? `o` : null;
    const matches = state.finished.filter((game) => {
        const side = query.player === undefined ? null : sideOf(game, query.player);
        if (query.player !== undefined && side === null) return false;
        if (query.vs !== undefined && side !== null && sideOf(game, query.vs) !== (side === `x` ? `o` : `x`)) return false;
        const kinds = [game.players.x.kind, game.players.o.kind];
        if (query.kind === `bot-bot` && kinds.some((kind) => kind !== `bot`)) return false;
        if (query.kind === `human-bot` && !kinds.includes(`user`)) return false;
        if (query.result === `none` && game.winner !== null) return false;
        if (query.result === `won` && game.winner !== side) return false;
        if (query.result === `lost` && (game.winner === null || game.winner === side)) return false;
        if (query.side !== undefined && side !== query.side) return false;
        if (query.reason !== undefined && game.reason !== query.reason) return false;
        if (query.clock !== undefined && game.timeControl.mode !== query.clock) return false;
        if (query.opening !== undefined && String(game.openingPlies) !== query.opening) return false;
        if (query.analyzed === `1` && game.analyses === 0) return false;
        if (query.event === `duel` && game.duel === undefined) return false;
        if (query.event === `tournament` && game.tournament === undefined) return false;
        if (query.event === `none` && (game.duel !== undefined || game.tournament !== undefined)) return false;
        if (query.duel !== undefined && game.duel?.id !== query.duel) return false;
        if (query.tournament !== undefined && game.tournament?.id !== query.tournament) return false;
        if (query.round !== undefined && String(game.tournament?.round) !== query.round) return false;
        // A duel named is asked for whole, a test's games among them.
        if (query.tests === undefined && query.duel === undefined && game.test === true) return false;
        return query.before === undefined || Date.parse(game.finishedAt) < Date.parse(`${query.before}T00:00:00Z`);
    });
    const page = query.page === undefined ? 1 : Number(query.page);
    const start = (page - 1) * pageSize;
    const games = matches.slice(start, start + pageSize);
    const body: FinishedGamesPage = { games, page, pages: Math.min(finishedGamesPageCap, Math.ceil(matches.length / pageSize)), total: matches.length };
    if (query.player === undefined) return { status: 200, body };
    const player = query.player;
    // A voided game stays on the page and out of the record, as the server counts it.
    const counted = matches.filter((game) => !game.voided);
    const bySide = (side: Side) => {
        const sat = counted.filter((game) => sideOf(game, player) === side);
        return { games: sat.length, won: sat.filter((game) => game.winner === side).length, lost: sat.filter((game) => game.winner !== null && game.winner !== side).length };
    };
    const asX = bySide(`x`);
    const asO = bySide(`o`);
    const won = asX.won + asO.won;
    const lost = asX.lost + asO.lost;
    return { status: 200, body: { ...body, record: { games: counted.length, won, lost, undecided: counted.length - won - lost, voided: matches.length - counted.length, asX, asO } } };
}

// A bot's settings before its owner set any: its listed text as declared, the duel switch on.
function settingsOf(bot: BotListing): BotSettings {
    return {
        name: bot.name,
        duelsByOthers: true,
        ...(bot.about === undefined ? {} : { declaredAbout: bot.about }),
        ...(bot.repoUrl === undefined ? {} : { declaredRepoUrl: bot.repoUrl }),
    };
}

// The owner's text replaces the stored one, an empty one clearing it.
function withOwnerText(held: BotSettings, changes: { about?: string | undefined; repoUrl?: string | undefined; duelsByOthers?: boolean | undefined }): BotSettings {
    const { about: _about, repoUrl: _repoUrl, ...rest } = held;
    const about = changes.about ?? held.about ?? ``;
    const repoUrl = changes.repoUrl ?? held.repoUrl ?? ``;
    return { ...rest, duelsByOthers: changes.duelsByOthers ?? held.duelsByOthers, ...(about === `` ? {} : { about }), ...(repoUrl === `` ? {} : { repoUrl }) };
}

// The listing shows the owner's text, else the declared one, as the server does.
function shownWith(bot: BotListing, settings: BotSettings): BotListing {
    const { about: _about, repoUrl: _repoUrl, ...rest } = bot;
    const about = settings.about ?? settings.declaredAbout;
    const repoUrl = settings.repoUrl ?? settings.declaredRepoUrl;
    return { ...rest, ...(about === undefined ? {} : { about }), ...(repoUrl === undefined ? {} : { repoUrl }) };
}

export function world(overrides: Partial<World> = {}): World {
    return {
        me: { kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: { username: `quinn.hex`, displayName: `Quinn` }, liveGames: [], analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } },
        leaderboard,
        bots,
        games: structuredClone(games),
        live: liveGames.slice(0, 1),
        finished: recentGames,
        paused: false,
        stall: false,
        broken: false,
        unloadable: null,
        legal: legalDetails,
        legalMissing: [],
        signup: null,
        create: `created`,
        start: `created`,
        guestLimit: false,
        limited: null,
        devAccounts: null,
        reportForm: true,
        // A running tournament reserves its bots on Play, so a world takes one only when it asks.
        tournaments: structuredClone(tournaments.filter((entry) => entry.status !== `running`)),
        analyzers: analyzerBots,
        positions: { kind: `done` },
        asked: [],
        analyses: {},
        requested: [],
        settings: {},
        duels: [],
        duelStates: null,
        duelStart: `created`,
        roundRobinStart: `created`,
        // A world owns its data, so an entry one test makes stays out of the next.
        ...structuredClone(overrides),
    };
}

// The server's rule: the caller's side is present exactly when the
// session holds a seat, which the mock reads as a name match.
function seatOf(snapshot: GameSnapshot, me: Me): Side | undefined {
    if (me === null) return undefined;
    for (const side of [`x`, `o`] as const) {
        const player = snapshot.players[side];
        if (player.kind !== `bot` && player.name === me.name) return side;
    }
    return undefined;
}

function viewOf(snapshot: GameSnapshot, me: Me): GameSnapshot {
    const you = seatOf(snapshot, me);
    return gameSnapshotSchema.parse(you === undefined ? snapshot : { ...snapshot, you });
}

// Playwright fulfills a route with one whole body, so a stream cannot stay
// open: the page gets an EventSource that fetches the mocked stream, hands
// on its events, and then holds, as a quiet live stream would.
function installHeldEventSource(): void {
    class HeldEventSource extends EventTarget {
        static readonly CONNECTING = 0;
        static readonly OPEN = 1;
        static readonly CLOSED = 2;
        readyState = HeldEventSource.CONNECTING;
        onerror: ((event: Event) => void) | null = null;

        constructor(readonly url: string) {
            super();
            void fetch(url, { headers: { accept: `text/event-stream` } }).then(
                async (response) => {
                    if (this.readyState === HeldEventSource.CLOSED) return;
                    if (!response.ok) {
                        this.fail();
                        return;
                    }
                    this.readyState = HeldEventSource.OPEN;
                    for (const frame of (await response.text()).split(`\n\n`)) {
                        const lines = frame.split(`\n`);
                        const type = lines.find((line) => line.startsWith(`event: `))?.slice(7);
                        const data = lines.find((line) => line.startsWith(`data: `))?.slice(6);
                        if (type === undefined || data === undefined || this.readyState === HeldEventSource.CLOSED) continue;
                        this.dispatchEvent(new MessageEvent(type, { data }));
                    }
                },
                () => {
                    this.fail();
                },
            );
        }

        close(): void {
            this.readyState = HeldEventSource.CLOSED;
        }

        fail(): void {
            this.readyState = HeldEventSource.CLOSED;
            this.onerror?.(new Event(`error`));
        }
    }
    Object.defineProperty(window, `EventSource`, { value: HeldEventSource, configurable: true, writable: true });
}

function json(route: Route, status: number, body: unknown): Promise<void> {
    return route.fulfill({ status, contentType: `application/json`, body: JSON.stringify(body) });
}

/** Serve the world at the network layer for every API call the page makes. */
// A player's record agrees with the ladder and the bot list: the rating and
// the games come from there, the split and the opponents are drawn from them.
function recordOf(state: World, name: string): PlayerRecord | null {
    const key = name.toLowerCase();
    const ranked = state.leaderboard.find((entry) => entry.name.toLowerCase() === key);
    const bot = state.bots.find((entry) => entry.name.toLowerCase() === key);
    const me = state.me?.kind === `user` && state.me.name.toLowerCase() === key ? state.me : null;
    const kind = ranked?.kind ?? (bot !== undefined ? `bot` : me !== null ? `human` : null);
    if (kind === null) return null;
    const playerName = ranked?.name ?? bot?.name ?? me?.name ?? name;
    const games = ranked?.games ?? 24;
    const won = Math.round(games * 0.55);
    const undecided = Math.min(2, games - won);
    const lost = games - won - undecided;
    const asXGames = Math.ceil(games / 2);
    const opponents = state.leaderboard.filter((entry) => entry.name !== playerName).slice(0, 5);
    const placings = state.tournaments
        .filter((entry) => entry.status === `finished` && entry.endedAt !== null)
        .flatMap((entry) => {
            const standing = entry.standings.find((line) => line.bot === playerName);
            return standing === undefined || entry.endedAt === null
                ? []
                : [{ tournamentId: entry.id, name: entry.name, rank: standing.rank, entrants: entry.standings.length, points: standing.points, endedAt: entry.endedAt }];
        });
    return playerRecordSchema.parse({
        name: playerName,
        kind,
        rating: ranked?.rating ?? bot?.rating ?? 1000,
        // A provisional player's deviation is above the ranked line, a settled one's near the floor.
        deviation: (bot?.provisional ?? ranked === undefined) ? 140 : 52,
        provisional: bot?.provisional ?? ranked === undefined,
        rank: ranked?.rank ?? null,
        games,
        won,
        lost,
        undecided,
        asX: { games: asXGames, won: Math.ceil(won / 2) },
        asO: { games: games - asXGames, won: Math.floor(won / 2) },
        forfeits: { disconnect: Math.min(1, lost), terminated: 0 },
        opponents: opponents.map((entry, index) => ({ name: entry.name, kind: entry.kind, games: 12 - index * 2, won: 6 - index, lost: 5 - index })),
        firstGameAt: games === 0 ? null : finishedAt(60 * 24 * 200),
        lastGameAt: games === 0 ? null : finishedAt(30),
        ...(kind === `bot` ? { placings } : {}),
    });
}

// A rating walk from the first game's 1500 to the rating now, the deviation
// narrowing as it goes; the first eight games provisional.
function historyOf(record: PlayerRecord, range: RatingRange): RatingPoint[] {
    const days = { '30d': 30, '1y': 200, all: 200 }[range];
    const count = Math.min(record.games, range === `30d` ? 12 : 40);
    return Array.from({ length: count }, (_, index) => {
        const share = count === 1 ? 1 : index / (count - 1);
        const wobble = index === count - 1 ? 0 : Math.round(28 * Math.sin(index * 1.7));
        return {
            gameId: `g-rated-${String(index + 1)}`,
            at: finishedAt(Math.round((1 - share) * days * 24 * 60) + 30),
            rating: Math.round(1500 + (record.rating - 1500) * share ** 0.6) + wobble,
            deviation: Math.max(48, Math.round(350 * 0.9 ** index)),
            provisional: range !== `30d` && index < 8,
        };
    });
}

// The position request as the server answers it: signed-in users only,
// the world's answer, the day's count going down by each reading not kept.
async function answerPosition(route: Route, state: World, request: PositionReadingRequest): Promise<void> {
    state.asked.push(request);
    const me = state.me;
    if (me?.kind !== `user`) {
        await json(route, 401, { error: `no session`, code: `unauthorized` });
        return;
    }
    const answer = state.positions;
    const left = me.analysisLeft.positions;
    const analyzer = analyzerBots.find((bot) => bot.name === request.analyzer) ?? analyzerBots[0];
    const ref = { name: analyzer?.name ?? `kestrel`, version: analyzer?.version ?? null, ownerName: analyzer?.ownerName ?? null, values: analyzer?.analyzer?.values ?? undeclaredValues };
    switch (answer.kind) {
        case `held`:
            return;
        case `refused`:
            await route.fulfill({
                status: answer.status,
                contentType: `application/json`,
                headers: answer.retryAfter === undefined ? {} : { 'retry-after': String(answer.retryAfter) },
                body: JSON.stringify({ error: `refused`, code: answer.code }),
            });
            return;
        case `failed`:
            await json(route, 200, positionReadingSchema.parse({ status: `failed`, analyzer: ref, failure: answer.failure, left }));
            return;
        case `done`: {
            if (answer.queued !== undefined && answer.queued.times > 0) {
                answer.queued.times -= 1;
                await json(route, 200, positionReadingSchema.parse({ status: `queued`, ahead: answer.queued.ahead, ...(answer.queued.chosen === true ? { analyzer: ref } : {}), left }));
                return;
            }
            const cached = answer.cached === true;
            if (!cached && left === 0) {
                const midnight = new Date();
                midnight.setUTCHours(24, 0, 0, 0);
                await route.fulfill({
                    status: 429,
                    contentType: `application/json`,
                    headers: { 'retry-after': String(Math.ceil((midnight.getTime() - Date.now()) / 1000)) },
                    body: JSON.stringify({ error: `the day's readings are spent`, code: `analysis_limit` }),
                });
                return;
            }
            const now = cached ? left : left - 1;
            state.me = { ...me, analysisLeft: { ...me.analysisLeft, positions: now } };
            const cap = analyzer?.analyzer;
            const lines = answer.lines ?? mockLines(request, Math.min(request.lines, cap?.lines ?? 3));
            const reading = {
                status: `done`,
                analyzer: ref,
                seconds: Math.min(request.seconds, cap?.maxSeconds ?? 10),
                elapsedMs: 1830,
                readAt: finishedAt(0),
                cached,
                lines,
                left: now,
            };
            await json(route, 200, positionReadingSchema.parse(reading));
            return;
        }
    }
}

function unloadable(path: string, screen: string | null): boolean {
    const name = screen === null ? undefined : /([^/]+)\.tsx?$/u.exec(screen)?.[1];
    return path === screen || (name !== undefined && new RegExp(`^/assets/${name}-[\\w-]+\\.js$`, `u`).test(path));
}

export async function serve(page: Page, state: World): Promise<void> {
    await page.addInitScript(installHeldEventSource);
    // Vite's shell names no report form, as the proxy's static one does
    // not; the server's names it where the deployment takes reports.
    if (state.reportForm) {
        await page.route((url) => !url.pathname.startsWith(`/@`) && !url.pathname.startsWith(`/api/`) && !/\.\w+$/u.test(url.pathname), async (route) => {
            if (!route.request().isNavigationRequest()) {
                await route.fallback();
                return;
            }
            const response = await route.fetch();
            const body = (await response.text()).replace(`</head>`, `<meta name="${reportFormMetaName}" content="on" /></head>`);
            await route.fulfill({ response, body });
        });
    }
    await page.route((url) => unloadable(url.pathname, state.unloadable), (route) => route.abort());
    await page.route((url) => url.pathname === `/healthz`, (route) =>
        route.fulfill({ status: state.paused ? 503 : 200, contentType: `application/json`, body: `{"ok":true}` }),
    );
    // The deployment's legal folder: the details as the world holds them,
    // and each document from the dev server's templates unless it lacks it.
    await page.route((url) => url.pathname === legalDetailsPath || legalPages.some((page) => url.pathname === legalDocumentPath(page)), async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (state.stall) return;
        if (path === legalDetailsPath) {
            if (state.legal === null) await route.fulfill({ status: 404 });
            else await json(route, 200, legalDetailsSchema.parse(state.legal));
        } else if (state.legalMissing.some((missing) => legalDocumentPath(missing) === path)) {
            await route.fulfill({ status: 404 });
        } else {
            await route.continue();
        }
    });
    // A pathname match, not a glob: the app's own src/api modules would
    // match `**/api/**`.
    await page.route((url) => url.pathname.startsWith(`/api/`), async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname;
        const method = request.method();

        if (state.stall && method === `GET` && path !== `/api/me`) return;
        if (state.broken && method === `GET` && path !== `/api/me`) {
            await json(route, 500, { error: `boom`, code: `internal` });
            return;
        }

        if (state.limited !== null && (method === `GET`) === (state.limited === `reads`) && path !== `/api/me`) {
            await route.fulfill({
                status: 429,
                contentType: `application/json`,
                // A guest session refills one every twenty minutes, the rest within a minute.
                headers: { 'retry-after': path === `/api/auth/guest` ? `1140` : `42` },
                body: JSON.stringify({ error: `rate limit exceeded`, code: `rate_limited` }),
            });
            return;
        }

        if (path === `/api/me` && method === `GET`) {
            await json(route, 200, meSchema.parse(state.me));
            return;
        }
        if (path === `/api/me` && method === `PATCH`) {
            if (state.me?.kind !== `user`) {
                await json(route, 401, { error: `no session`, code: `unauthorized` });
                return;
            }
            const changes = meUpdateRequestSchema.parse(request.postDataJSON());
            state.me = { ...state.me, ...(changes.analysisOptOut === undefined ? {} : { analysisOptOut: changes.analysisOptOut }) };
            await json(route, 200, userMeSchema.parse(state.me));
            return;
        }
        if (path === `/api/analysis/positions` && method === `POST`) {
            await answerPosition(route, state, positionReadingRequestSchema.parse(request.postDataJSON()));
            return;
        }
        if (path === `/api/analysis/check` && method === `POST`) {
            positionCheckRequestSchema.parse(request.postDataJSON());
            await route.fulfill({ status: 204 });
            return;
        }
        const analysesPath = /^\/api\/games\/([^/]+)\/analyses$/u.exec(path);
        if (analysesPath !== null) {
            const id = decodeURIComponent(analysesPath[1] ?? ``);
            const snapshot = state.games[id];
            const listed = state.finished.some((game) => game.gameId === id);
            if (snapshot === undefined && !listed) {
                await json(route, 404, { error: `no such game`, code: `not_found` });
            } else if (snapshot?.status === `in-progress`) {
                await json(route, 409, { error: `the game is live`, code: `game_live` });
            } else if (method === `GET`) {
                await json(route, 200, analysisListSchema.parse(state.analyses[id] ?? { analyses: [], optedOut: false, independentOnline: false }));
            } else if (state.me?.kind !== `user`) {
                await json(route, 401, { error: `no session`, code: `unauthorized` });
            } else {
                const body = analysisRequestSchema.parse(request.postDataJSON() ?? {});
                state.requested.push({ gameId: id, request: body });
                const listed = state.analyses[id] ?? { analyses: [], optedOut: false, independentOnline: false };
                const community = listed.analyses.filter((analysis) => analysis.kind === `community`);
                const named = body.analyzer === undefined ? null : state.analyzers.find((bot) => bot.name === body.analyzer);
                const refusal = listed.optedOut
                    ? { status: 409, code: `opted_out` }
                    : community.filter((analysis) => analysis.status === `done`).length >= analysesPerGame.done
                      ? { status: 409, code: `analysis_full` }
                      : community.some((analysis) => analysis.status === `queued` || analysis.status === `running`)
                        ? { status: 409, code: `analysis_pending` }
                        : state.me.analysisLeft.games === 0
                          ? { status: 429, code: `analysis_limit`, retryAfter: 3_600 }
                          : named === null
                            ? state.analyzers.some((bot) => bot.analyzer?.ready === true)
                                ? null
                                : { status: 409, code: `no_analyzer` }
                            : named?.analyzer?.ready === true
                              ? null
                              : { status: 409, code: `no_analyzer` };
                if (refusal !== null) {
                    await route.fulfill({
                        status: refusal.status,
                        contentType: `application/json`,
                        headers: refusal.retryAfter === undefined ? {} : { 'retry-after': String(refusal.retryAfter) },
                        body: JSON.stringify({ error: `refused`, code: refusal.code }),
                    });
                } else {
                    const of = snapshot === undefined ? 0 : positionsOf(snapshot);
                    const queued = communityAnalysisSchema.parse({
                        kind: `community`,
                        analysisId: `a_0f8d2c4e-1b3a-4c5d-8e9f-0a1b2c3d4e5f`,
                        analyzer: null,
                        involved: false,
                        status: `queued`,
                        requestedAt: finishedAt(0),
                        finishedAt: null,
                        queuePosition: 1,
                        progress: { done: 0, of },
                        seconds: 2,
                        turns: [],
                    });
                    state.analyses[id] = { ...listed, analyses: [...listed.analyses, queued] };
                    state.me = { ...state.me, analysisLeft: { ...state.me.analysisLeft, games: state.me.analysisLeft.games - 1 } };
                    await json(route, 202, queued);
                }
            }
            return;
        }
        if (path === `/api/auth/logout` && method === `POST`) {
            state.me = null;
            await route.fulfill({ status: 204 });
            return;
        }
        if (path === `/api/me` && method === `DELETE` && state.me?.kind === `user`) {
            const body = deleteAccountRequestSchema.parse(request.postDataJSON());
            if (body.name !== state.me.name) {
                await json(route, 400, { error: `the name is not the account's`, code: `name_mismatch` });
            } else if (state.me.liveGames.length > 0) {
                await json(route, 409, { error: `the account is seated in a live game`, code: `in_live_game` });
            } else {
                state.me = null;
                await route.fulfill({ status: 204 });
            }
            return;
        }
        if (path === `/api/reports` && method === `POST`) {
            reportRequestSchema.parse(request.postDataJSON());
            await json(route, 201, { id: 12 });
            return;
        }
        if (path === `/api/me/export` && method === `GET` && state.me?.kind === `user`) {
            const exported = accountExportSchema.parse({
                exportedAt: finishedAt(0),
                account: { id: `u_quinn`, name: state.me.name, discordId: `100000000000000001`, createdAt: finishedAt(60 * 24 * 90), bannedAt: null },
                sessions: [],
                rating: null,
                bots: [],
                games: [],
                tournamentEntries: [],
                challenges: [],
                moderation: [],
            });
            await route.fulfill({
                status: 200,
                contentType: `application/json`,
                headers: { 'content-disposition': `attachment; filename="hexo-arena-${state.me.name}-2026-10-02.json"` },
                body: JSON.stringify(exported),
            });
            return;
        }
        if (path === `/api/auth/guest` && method === `POST`) {
            if (state.guestLimit) {
                await route.fulfill({
                    status: 429,
                    contentType: `application/json`,
                    headers: { 'retry-after': `60` },
                    body: JSON.stringify({ error: `the guest cap is full`, code: `guest_limit` }),
                });
                return;
            }
            state.me = { kind: `guest`, name: `Guest k3f9`, liveGames: [] };
            await json(route, 201, state.me);
            return;
        }
        if (path === `/api/signup`) {
            const held = state.signup;
            if (method === `DELETE`) {
                state.signup = null;
                await route.fulfill({ status: 204 });
            } else if (held === null) {
                await json(route, 410, { error: `no sign-up waits for this cookie`, code: `signup_expired` });
            } else if (method === `GET`) {
                await json(route, 200, signupSchema.parse(held));
            } else if (state.create === `created`) {
                const body = request.postDataJSON() as { name: string };
                state.signup = null;
                state.me = { kind: `user`, name: body.name, rating: 1000, provisional: true, discord: held.discord, liveGames: [], analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } };
                await json(route, 201, { name: body.name });
            } else if (state.create === `failed`) {
                await json(route, 500, { error: `boom`, code: `internal` });
            } else {
                await json(route, state.create === `name_taken` ? 409 : 410, { error: `no`, code: state.create });
            }
            return;
        }
        const playerRead = /^\/api\/players\/([^/]+)(\/rating)?$/u.exec(path);
        if (playerRead !== null && method === `GET`) {
            const record = recordOf(state, decodeURIComponent(playerRead[1] ?? ``));
            if (record === null) await json(route, 404, { error: `no such player`, code: `not_found` });
            else if (playerRead[2] === undefined) await json(route, 200, record);
            else await json(route, 200, historyOf(record, ratingRangeSchema.parse(url.searchParams.get(`range`) ?? `1y`)));
            return;
        }
        if (path === `/api/tournaments` && method === `POST`) {
            const viewer = state.me?.kind === `user` ? state.me.name : null;
            if (viewer === null) {
                await json(route, 401, { error: `no signed-in user`, code: `unauthorized` });
                return;
            }
            const start = state.roundRobinStart;
            if (start !== `created`) {
                await route.fulfill({
                    status: start.status,
                    contentType: `application/json`,
                    headers: start.retryAfter === undefined ? {} : { 'retry-after': String(start.retryAfter) },
                    body: JSON.stringify({ error: `refused`, code: start.code, ...(start.bot === undefined ? {} : { bot: start.bot }) }),
                });
                return;
            }
            const asked = createRoundRobinRequestSchema.parse(request.postDataJSON());
            const field = asked.bots.map((picked) => state.bots.find((listed) => listed.name === picked.name));
            const owners = new Set(field.map((listed) => listed?.ownerName ?? null));
            const created: TournamentDetail = {
                id: `t_newrobin0001`,
                name: `Round robin by ${viewer}`,
                origin: `person`,
                createdBy: viewer,
                rated: false,
                test: owners.size === 1 && !owners.has(null),
                gamesPerPair: asked.gamesPerPair,
                status: `running`,
                startsAt: hoursFromNow(0),
                startedAt: hoursFromNow(0),
                endedAt: null,
                timeControl: asked.timeControl,
                openingPlies: asked.openingPlies,
                maxEntrants: asked.bots.length,
                entries: asked.bots.map((picked, index) => ({ key: index + 1, bot: picked.name, ownerName: field[index]?.ownerName ?? `nobody`, online: true, ratingAtStart: field[index]?.rating ?? 1500, state: `playing` as const })),
                rounds: [],
                standings: asked.bots.map((picked, index) => ({ rank: 1, key: index + 1, bot: picked.name, ownerName: field[index]?.ownerName ?? `nobody`, points: 0, asX: 0, asO: 0, withdrawn: false })),
                live: [],
                waiting: [],
                nextRoundAt: null,
            };
            state.tournaments.push(created);
            await json(route, 201, tournamentDetailSchema.parse(created));
            return;
        }
        if (path === `/api/tournaments` && method === `GET`) {
            const bot = url.searchParams.get(`bot`);
            const viewer = state.me?.kind === `user` ? state.me.name : null;
            const mine = url.searchParams.get(`mine`) === `1`;
            const tests = url.searchParams.get(`kind`) === `test`;
            if (mine && viewer === null) {
                await json(route, 200, { running: [], scheduled: [], past: [] });
                return;
            }
            const kept = state.tournaments.filter(
                (detail) => (!mine || detail.createdBy === viewer || detail.entries.some((entry) => entry.ownerName === viewer)) && (!tests || detail.test),
            );
            const listed = kept.flatMap((detail): TournamentSummary[] => {
                if (bot === null) {
                    // The list of every bot names the signed-in owner's own entry.
                    const own = viewer === null ? undefined : detail.entries.find((entry) => entry.ownerName === viewer);
                    const place = own === undefined ? null : placeOf(detail, own.bot);
                    return [{ ...summaryOf(detail), ...(own === undefined || place === null ? {} : { yours: { bot: own.bot, place } }) }];
                }
                const place = placeOf(detail, bot);
                return place === null ? [] : [{ ...summaryOf(detail), bot: place }];
            });
            await json(
                route,
                200,
                tournamentListSchema.parse({
                    running: listed.filter((entry) => entry.status === `running`).sort((one, two) => Number(one.origin === `person`) - Number(two.origin === `person`)),
                    scheduled: listed.filter((entry) => entry.status === `scheduled`),
                    past: listed.filter((entry) => entry.status !== `running` && entry.status !== `scheduled`),
                    ...(mine
                        ? {
                              quota: {
                                  live: state.tournaments.filter((detail) => detail.createdBy === viewer && detail.status === `running`).length,
                                  today: Math.min(3, state.tournaments.filter((detail) => detail.createdBy === viewer).length),
                              },
                          }
                        : {}),
                }),
            );
            return;
        }
        const tournamentPath = /^\/api\/tournaments\/([^/]+)(\/entry|\/stop|\/withdraw)?$/u.exec(path);
        if (tournamentPath !== null) {
            const detail = state.tournaments.find((entry) => entry.id === tournamentPath[1]);
            if (detail === undefined) {
                await json(route, 404, { error: `no such tournament`, code: `not_found` });
                return;
            }
            if (tournamentPath[2] === undefined) {
                await json(route, 200, tournamentDetailSchema.parse(detail));
                return;
            }
            if (tournamentPath[2] === `/stop`) {
                detail.status = `stopped`;
                detail.endedAt = hoursFromNow(0);
                detail.end = { reason: `creator`, round: 2 };
                detail.waiting = [];
                await json(route, 200, tournamentDetailSchema.parse(detail));
                return;
            }
            if (tournamentPath[2] === `/withdraw`) {
                const { bot } = tournamentWithdrawRequestSchema.parse(request.postDataJSON());
                detail.entries = detail.entries.map((entry) => (entry.bot === bot ? { ...entry, state: `withdrawn` as const, reason: `owner` as const } : entry));
                detail.standings = detail.standings.map((line) => (line.bot === bot ? { ...line, withdrawn: true } : line));
                await json(route, 200, tournamentDetailSchema.parse(detail));
                return;
            }
            const owner = state.me?.kind === `user` ? state.me.name : null;
            if (owner === null) {
                await json(route, 401, { error: `no session`, code: `unauthorized` });
                return;
            }
            detail.entries = detail.entries.filter((entry) => entry.ownerName !== owner);
            if (method === `DELETE`) {
                await route.fulfill({ status: 204 });
                return;
            }
            const { bot } = tournamentEntryRequestSchema.parse(request.postDataJSON());
            const entry = { key: detail.entries.length + 1, bot, ownerName: owner, online: state.bots.find((listed) => listed.name === bot)?.online ?? false, ratingAtStart: null, state: `entered` as const };
            detail.entries.push(entry);
            await json(route, 200, entry);
            return;
        }
        if (path === `/api/leaderboard` && method === `GET`) {
            const query = leaderboardQuerySchema.safeParse(Object.fromEntries(url.searchParams));
            if (!query.success) {
                await json(route, 400, { error: `refused`, code: `bad_request` });
                return;
            }
            const { kind, active } = query.data;
            const since = Date.now() - leaderboardActiveDays * 86_400_000;
            const rows = state.leaderboard
                .filter((entry) => kind === `all` || (kind === `bots`) === (entry.kind === `bot`))
                .filter((entry) => active === `all` || Date.parse(entry.lastPlayedAt) >= since)
                .map((entry, index) => ({ ...entry, rank: index + 1 }));
            await json(route, 200, leaderboardSchema.parse(rows));
            return;
        }
        if (path === `/api/bots` && method === `GET`) {
            const online = url.searchParams.get(`online`) === `1`;
            const analyzers = url.searchParams.get(`analyzer`) === `1`;
            const rows = (analyzers ? state.analyzers : state.bots).filter((bot) => !online || bot.online);
            await json(route, 200, botListingSchema.array().parse(rows));
            return;
        }
        const events = /^\/api\/games\/([^/]+)\/events$/.exec(path);
        if (events !== null) {
            const snapshot = state.games[decodeURIComponent(events[1] ?? ``)];
            if (snapshot === undefined) {
                await json(route, 404, { error: `no such game`, code: `not_found` });
                return;
            }
            const data = JSON.stringify(viewOf(snapshot, state.me));
            await route.fulfill({ status: 200, contentType: `text/event-stream`, body: `event: snapshot\ndata: ${data}\n\n` });
            return;
        }
        if (path === `/api/games/finished` && method === `GET`) {
            const answer = finishedPage(state, url.searchParams);
            if (answer.status === 200) await json(route, 200, finishedGamesPageSchema.parse(answer.body));
            else await json(route, answer.status, { error: `refused`, code: answer.status === 404 ? `not_found` : `bad_request` });
            return;
        }
        const game = /^\/api\/games\/([^/]+)(\/move|\/resign)?$/.exec(path);
        if (game !== null) {
            const id = decodeURIComponent(game[1] ?? ``);
            const snapshot = state.games[id];
            if (snapshot === undefined) {
                await json(route, 404, { error: `no such game`, code: `not_found` });
                return;
            }
            if (game[2] === `/move` && snapshot.status === `in-progress`) {
                const body = request.postDataJSON() as { cells: { x: number; y: number }[] };
                const side = snapshot.toMove;
                snapshot.board.cells.push(...body.cells.map((cell) => ({ ...cell, side })));
                snapshot.toMove = side === `x` ? `o` : `x`;
            }
            if (game[2] === `/resign` && snapshot.status === `in-progress`) {
                state.games[id] = {
                    gameId: snapshot.gameId,
                    players: snapshot.players,
                    openingPlies: snapshot.openingPlies,
                    board: snapshot.board,
                    timeControl: snapshot.timeControl,
                    status: `finished`,
                    winner: seatOf(snapshot, state.me) === `x` ? `o` : `x`,
                    reason: `surrender`,
                    voided: false,
                };
            }
            const answered = state.games[id];
            if (answered !== undefined) await json(route, 200, viewOf(answered, state.me));
            return;
        }
        if (path === `/api/games` && method === `GET`) {
            const tests = url.searchParams.get(`tests`) === `1`;
            await json(route, 200, liveGameEntrySchema.array().parse(state.live.filter((entry) => tests || entry.test !== true)));
            return;
        }
        if (path === `/api/duels/bots` && method === `GET`) {
            await json(route, 200, duelBotStatesSchema.parse(state.duelStates ?? statesOf(state)));
            return;
        }
        if (path === `/api/duels` && method === `GET`) {
            const query = duelListQuerySchema.safeParse(Object.fromEntries(url.searchParams));
            if (!query.success) {
                await json(route, 400, { error: `refused`, code: `bad_request` });
                return;
            }
            const { bot, mine, kind } = query.data;
            const viewer = state.me?.kind === `user` ? state.me.name : null;
            const owners = new Map(state.bots.map((entry) => [entry.name, entry.ownerName]));
            const listed = state.duels
                .filter((duel) => bot === undefined || [duel.first.name, duel.second.name].includes(bot))
                .filter((duel) => mine === undefined || (viewer !== null && (duel.startedBy === viewer || [duel.first.name, duel.second.name].some((name) => owners.get(name) === viewer))))
                .filter((duel) => kind === undefined || duel.kind === kind)
                .map(summaryOfDuel);
            const mineStarted = state.duels.filter((duel) => viewer !== null && duel.startedBy === viewer);
            await json(
                route,
                200,
                duelListSchema.parse({
                    running: listed.filter((duel) => duel.status === `running`),
                    past: listed.filter((duel) => duel.status !== `running`),
                    ...(mine === undefined || viewer === null ? {} : { quota: { live: mineStarted.filter((duel) => duel.status === `running`).length, today: mineStarted.length } }),
                }),
            );
            return;
        }
        const duelRead = /^\/api\/duels\/([^/]+)(\/stop)?$/u.exec(path);
        if (duelRead !== null) {
            const id = decodeURIComponent(duelRead[1] ?? ``);
            const duel = state.duels.find((entry) => entry.id === id);
            if (duel === undefined) {
                await json(route, 404, { error: `no such duel`, code: `not_found` });
                return;
            }
            if (duelRead[2] === `/stop` && method === `POST`) {
                duel.status = `stopped`;
                duel.end = { reason: `starter`, bot: null };
                duel.endedAt = new Date().toISOString().replace(/\.\d{3}Z$/u, `Z`);
                duel.games = duel.games.map((game) => (game.state === `pending` ? { ...game, state: `not_played` } : game));
            }
            await json(route, 200, duelDetailSchema.parse(duel));
            return;
        }
        if (path === `/api/duels` && method === `POST`) {
            const start = state.duelStart;
            if (start !== `created`) {
                await route.fulfill({
                    status: start.status,
                    contentType: `application/json`,
                    headers: start.retryAfter === undefined ? {} : { 'retry-after': String(start.retryAfter) },
                    body: JSON.stringify({ error: `refused`, code: start.code }),
                });
                return;
            }
            const viewer = state.me?.kind === `user` ? state.me.name : null;
            if (viewer === null) {
                await json(route, 401, { error: `no signed-in user`, code: `unauthorized` });
                return;
            }
            const asked = createDuelRequestSchema.parse(request.postDataJSON());
            const find = (name: string) => state.bots.find((entry) => entry.name === name);
            const first = find(asked.first);
            const second = find(asked.second);
            if (first === undefined || second === undefined) {
                await json(route, 404, { error: `no such bot`, code: `not_found` });
                return;
            }
            const refused = duelRefusal(state, viewer, [first, second], asked);
            if (refused !== null) {
                await json(route, refused.status, { error: `refused`, code: refused.code });
                return;
            }
            const levelOf = (bot: BotListing, id: string | undefined) => {
                const level = bot.levels?.list.find((entry) => entry.id === id && entry.id !== bot.levels?.default);
                return level === undefined ? {} : { level: seatLevelOf(level), ratingAtStart: null };
            };
            const duel = duelFixture({
                id: `d_started${String(state.duels.length).padStart(5, `0`)}`,
                first: duelBotOf(first, levelOf(first, asked.levels?.first)),
                second: duelBotOf(second, levelOf(second, asked.levels?.second)),
                kind: first.ownerName === second.ownerName ? `test` : `duel`,
                startedBy: state.me?.kind === `user` ? state.me.name : `quinn`,
                games: asked.games,
                rated: asked.rated,
                timeControl: asked.timeControl,
                openingPlies: asked.openingPlies,
                outcomes: [],
                live: false,
                status: `running`,
            });
            state.duels.push(duel);
            await json(route, 201, duelDetailSchema.parse(duel));
            return;
        }
        if (path === `/api/games` && method === `POST`) {
            const start = state.start;
            if (start !== `created`) {
                // A refused session reads as signed out from then on.
                if (start.status === 401) state.me = null;
                await route.fulfill({
                    status: start.status,
                    contentType: `application/json`,
                    headers: start.retryAfter === undefined ? {} : { 'retry-after': String(start.retryAfter) },
                    body: JSON.stringify({ error: `refused`, code: start.code }),
                });
                return;
            }
            // As the server does, the mark goes on a signed-in person's game at the bot's default level alone, asked unrated or against their own bot.
            const asked = createGameRequestSchema.parse(request.postDataJSON());
            const running = state.games.running;
            if (running !== undefined) {
                const { unratedByChoice: _mark, ...unmarked } = running;
                const own = state.me?.kind === `user` && state.bots.some((entry) => entry.name === asked.bot && entry.ownerName === state.me?.name);
                const chose = state.me?.kind === `user` && asked.level === undefined && (asked.rated === false || own);
                state.games.running = chose ? { ...unmarked, unratedByChoice: true } : unmarked;
                await json(route, 201, viewOf(state.games.running, state.me));
            }
            return;
        }
        const owned = /^\/api\/bots\/([^/]+)\/settings$/.exec(path);
        if (owned !== null) {
            const name = decodeURIComponent(owned[1] ?? ``);
            const listed = state.bots.find((entry) => entry.name === name);
            if (state.me?.kind !== `user` || listed === undefined || listed.ownerName !== state.me.name) {
                await json(route, 404, { error: `no such bot of yours`, code: `not_found` });
                return;
            }
            const held = state.settings[name] ?? settingsOf(listed);
            if (method !== `PATCH`) {
                await json(route, 200, botSettingsSchema.parse(held));
                return;
            }
            const asked = botSettingsUpdateSchema.safeParse(request.postDataJSON());
            if (!asked.success) {
                await json(route, 400, { error: `the request fails validation`, code: `bad_request` });
                return;
            }
            const next = withOwnerText(held, asked.data);
            state.settings[name] = next;
            state.bots = state.bots.map((entry) => (entry.name === name ? shownWith(entry, next) : entry));
            await json(route, 200, botSettingsSchema.parse(next));
            return;
        }
        const token = /^\/api\/bots\/([^/]+)\/token$/.exec(path);
        if (token !== null && method === `POST`) {
            await json(route, 200, { name: decodeURIComponent(token[1] ?? ``), token: `hxo_${`a`.repeat(43)}` });
            return;
        }
        const bot = /^\/api\/bots\/([^/]+)$/.exec(path);
        if (bot !== null && method === `DELETE`) {
            const name = decodeURIComponent(bot[1] ?? ``);
            state.bots = state.bots.filter((entry) => entry.name !== name);
            await route.fulfill({ status: 204 });
            return;
        }
        if (path === `/api/bots` && method === `POST`) {
            const body = request.postDataJSON() as { name: string };
            await json(route, 201, { name: body.name, token: `hxo_${`b`.repeat(43)}` });
            return;
        }
        if (path === `/api/dev/accounts` && method === `GET`) {
            if (state.devAccounts === null) await json(route, 404, { error: `route not found`, code: `not_found` });
            else await json(route, 200, devAccountSchema.array().parse(state.devAccounts));
            return;
        }
        if (path === `/api/dev/login` && method === `POST` && state.devAccounts !== null) {
            const body = request.postDataJSON() as { name?: string };
            // Given a Discord account instead of a name, the server holds a first sign-in.
            if (body.name === undefined) {
                state.signup = signup;
                await route.fulfill({ status: 302, headers: { location: `/welcome` } });
                return;
            }
            const persona = state.devAccounts.find((account) => account.name === body.name);
            if (persona?.banned === true) {
                await json(route, 403, { error: `the account is banned`, code: `banned` });
                return;
            }
            state.me = { kind: `user`, name: body.name, rating: persona?.rating ?? 1000, provisional: persona?.provisional ?? true, discord: null, liveGames: [], analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } };
            await json(route, 200, { name: body.name });
            return;
        }
        await json(route, 404, { error: `unmocked ${method} ${path}`, code: `not_found` });
    });
}
