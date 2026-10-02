import type { Page, Route } from '@playwright/test';
import {
    accountExportSchema,
    deleteAccountRequestSchema,
    reportRequestSchema,
    botListingSchema,
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
    tournamentListSchema,
    type BotListing,
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
    // How a game start answers: the running game, or a refusal.
    start: `created` | { status: number; code: string; retryAfter?: number };
    // Whether minting a guest session finds the guest limit full.
    guestLimit: boolean;
    // Every data read, or every write, refused as rate-limited, with the wait its limit names.
    limited: `reads` | `writes` | null;
    // The tournaments by id, which the list reads too.
    tournaments: TournamentDetail[];
    // The dev server's seeded personas; null answers as every other server does, not found.
    devAccounts: DevAccount[] | null;
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
    { name: `sealbot`, ownerName: `bruno`, online: true, openForChallenges: true, rating: 1712, provisional: false, liveGames: 4, levels: null, accepts: { turnMs: [5000, 60000], match: true, unlimited: false } },
    { name: `hextide`, ownerName: `ana`, online: true, openForChallenges: true, rating: 1690, provisional: false, liveGames: 1, levels: strengths, accepts: { turnMs: [5000, 60000], match: true, unlimited: false } },
    { name: `devbot-b`, ownerName: `devowner-b`, online: true, openForChallenges: true, rating: 1538, provisional: false, liveGames: 0, levels: null, accepts: full },
    { name: `devbot-a`, ownerName: `devowner-a`, online: true, openForChallenges: true, rating: 1520, provisional: false, liveGames: 2, levels: null, accepts: full },
    { name: `devbot-c`, ownerName: `devowner-c`, online: true, openForChallenges: true, rating: 1514, provisional: false, liveGames: 0, levels: null, accepts: full },
    { name: `quietlake`, ownerName: `dmitri`, online: true, openForChallenges: true, rating: 1420, provisional: true, liveGames: 0, levels: null, accepts: { turnMs: [10000, 60000], match: false, unlimited: false } },
    { name: `pebble`, ownerName: `ana`, online: true, openForChallenges: false, rating: 1388, provisional: true, liveGames: 0, levels: null, accepts: { turnMs: [5000, 30000], match: false, unlimited: true } },
    { name: `lantern`, ownerName: `ana`, online: false, openForChallenges: false, rating: 1500, provisional: true, liveGames: 0, levels: null },
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
        about: `A clean-room HeXO engine with a rotation opener.`,
        version: `0.3.1`,
        repoUrl: `https://github.com/quinn/sealbot`,
        accepts: { turnMs: [5000, 60000], match: true, unlimited: true },
    },
    {
        name: `hextide`,
        ownerName: `ana`,
        online: true,
        openForChallenges: false,
        rating: 1690,
        provisional: false,
        liveGames: 0,
        levels: null,
        version: `2.0.0`,
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
    status: `running`,
    startsAt: hoursFromNow(-1),
    startedAt: hoursFromNow(-1),
    endedAt: null,
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

function summaryOf(detail: TournamentDetail): TournamentSummary {
    const top = detail.standings[0];
    return {
        id: detail.id,
        name: detail.name,
        status: detail.status,
        startsAt: detail.startsAt,
        timeControl: detail.timeControl,
        openingPlies: detail.openingPlies,
        entrants: detail.startedAt === null ? detail.entries.length : detail.standings.length,
        maxEntrants: detail.maxEntrants,
        winner: detail.status === `finished` && top !== undefined ? { name: top.bot, ownerName: top.ownerName } : null,
        round: detail.status === `running` ? { current: 1 + detail.rounds.findIndex((round) => round.pairings.some((pairing) => pairing.games.some((game) => game.outcome === `pending` || game.outcome === `live`))), of: detail.rounds.length } : null,
    };
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

// The latest results, newest first; the first three have snapshots, so a
// frozen board can show the newest.
const finishedAt = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
export const recentGames: FinishedGameEntry[] = [
    { gameId: `won`, players: facing(`hextide`, 1690), winner: `x`, reason: `six-in-a-row`, timeControl: { mode: `turn`, turnTimeMs: 30_000 }, openingPlies: 1, turns: 12, finishedAt: finishedAt(3), rated: true, voided: false },
    { gameId: `five-finished`, players: facing(`sealbot`, 1712), winner: `o`, reason: `surrender`, timeControl: { mode: `turn`, turnTimeMs: 30_000 }, openingPlies: 5, turns: 5, finishedAt: finishedAt(41), rated: true, voided: false },
    { gameId: `nine-finished`, players: facing(`sealbot`, 1712), winner: `x`, reason: `timeout`, timeControl: { mode: `turn`, turnTimeMs: 30_000 }, openingPlies: 9, turns: 6, finishedAt: finishedAt(95), rated: true, voided: false },
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
    })),
];

/** The latest results with a deleted player's game and a guest's on top, as the list names them. */
export const keptNames: FinishedGameEntry[] = [
    { gameId: `gone`, players: { x: seat.sealbot, o: seat.gone }, winner: `x`, reason: `six-in-a-row`, timeControl: { mode: `turn`, turnTimeMs: 30_000 }, openingPlies: 1, turns: 14, finishedAt: finishedAt(1), rated: true, voided: false },
    { gameId: `guest-finished`, players: { x: { ...seat.sealbot, rating: null }, o: seat.guest }, winner: `o`, reason: `surrender`, timeControl: { mode: `turn`, turnTimeMs: 30_000 }, openingPlies: 1, turns: 9, finishedAt: finishedAt(2), rated: false, voided: false },
    { gameId: `practice-finished`, players: { x: { ...seat.quinn, rating: null }, o: seat.quietlakeQuick }, winner: `x`, reason: `six-in-a-row`, timeControl: { mode: `turn`, turnTimeMs: 30_000 }, openingPlies: 1, turns: 11, finishedAt: finishedAt(2.5), rated: false, voided: false },
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

export function world(overrides: Partial<World> = {}): World {
    return {
        me: { kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: { username: `quinn.hex`, displayName: `Quinn` }, liveGames: [] },
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
        // A running tournament reserves its bots on Play, so a world takes one only when it asks.
        tournaments: structuredClone(tournaments.filter((entry) => entry.status !== `running`)),
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

function unloadable(path: string, screen: string | null): boolean {
    const name = screen === null ? undefined : /([^/]+)\.tsx?$/u.exec(screen)?.[1];
    return path === screen || (name !== undefined && new RegExp(`^/assets/${name}-[\\w-]+\\.js$`, `u`).test(path));
}

export async function serve(page: Page, state: World): Promise<void> {
    await page.addInitScript(installHeldEventSource);
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
                state.me = { kind: `user`, name: body.name, rating: 1000, provisional: true, discord: held.discord, liveGames: [] };
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
        if (path === `/api/tournaments` && method === `GET`) {
            const listed = state.tournaments.map(summaryOf);
            await json(
                route,
                200,
                tournamentListSchema.parse({
                    running: listed.find((entry) => entry.status === `running`) ?? null,
                    scheduled: listed.filter((entry) => entry.status === `scheduled`),
                    past: listed.filter((entry) => entry.status !== `running` && entry.status !== `scheduled`),
                }),
            );
            return;
        }
        const tournamentPath = /^\/api\/tournaments\/([^/]+)(\/entry)?$/u.exec(path);
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
            const rows = state.bots.filter((bot) => !online || bot.online);
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
            await json(route, 200, liveGameEntrySchema.array().parse(state.live));
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
            if (state.games.running !== undefined) await json(route, 201, viewOf(state.games.running, state.me));
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
            state.me = { kind: `user`, name: body.name, rating: persona?.rating ?? 1000, provisional: persona?.provisional ?? true, discord: null, liveGames: [] };
            await json(route, 200, { name: body.name });
            return;
        }
        await json(route, 404, { error: `unmocked ${method} ${path}`, code: `not_found` });
    });
}
