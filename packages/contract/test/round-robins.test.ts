import { describe, expect, it } from 'vitest';
import {
    createTournamentRequestSchema,
    defaultOpeningPlies,
    defaultTournamentGamesPerPair,
    gamesPerBot,
    gamesPerPairFits,
    gameTournamentSchema,
    personTournamentName,
    duelCutReasons,
    estimateSchema,
    tournamentBotGamesMax,
    tournamentBotStateSchema,
    tournamentBotsMax,
    tournamentBotsMin,
    tournamentDailyCap,
    tournamentCutReasons,
    tournamentDetailSchema,
    tournamentEndReasonSchema,
    tournamentIdSchema,
    tournamentFormatOf,
    tournamentGameCounts,
    tournamentGamesMax,
    tournamentListSchema,
    tournamentLiveCap,
    tournamentMeta,
    tournamentPairingSchema,
    tournamentPerBotCap,
    tournamentStopReasons,
    tournamentTestGameCounts,
    type TournamentSummary,
} from '../src';

const turn = (seconds: number) => ({ mode: `turn` as const, turnTimeMs: seconds * 1_000 });
const three = [{ name: `hextide` }, { name: `quietlake` }, { name: `pebble` }];
const request = { bots: three, timeControl: turn(10) };

describe('createTournamentRequestSchema', () => {
    it('plays one opening a pair from five plies unless asked otherwise', () => {
        const parsed = createTournamentRequestSchema.parse(request);
        expect(parsed.gamesPerPair).toBe(defaultTournamentGamesPerPair);
        expect(defaultTournamentGamesPerPair).toBe(2);
        expect(parsed.openingPlies).toBe(defaultOpeningPlies);
    });

    it('takes 2 to 8 distinct bots, each at a declared level or its default', () => {
        const bots = (count: number) => Array.from({ length: count }, (_, index) => ({ name: `bot${String(index)}` }));
        expect([tournamentBotsMin, tournamentBotsMax]).toEqual([2, 8]);
        for (const count of [2, 3, 8]) expect(createTournamentRequestSchema.safeParse({ ...request, bots: bots(count) }).success, String(count)).toBe(true);
        for (const count of [1, 9]) expect(createTournamentRequestSchema.safeParse({ ...request, bots: bots(count) }).success, String(count)).toBe(false);
        expect(createTournamentRequestSchema.safeParse({ ...request, bots: [...three, { name: `HexTide` }] }).success).toBe(false);
        expect(createTournamentRequestSchema.safeParse({ ...request, bots: [{ name: `hextide`, level: `club` }, ...three.slice(1)] }).success).toBe(true);
        expect(createTournamentRequestSchema.safeParse({ ...request, bots: [{ name: `hextide`, level: `Club!` }, ...three.slice(1)] }).success).toBe(false);
        expect(createTournamentRequestSchema.safeParse({ ...request, bots: [{ name: `hextide`, side: `x` }, ...three.slice(1)] }).success).toBe(false);
    });

    it('takes a single game or one to five openings a pair, a test 20, 30, or 50 games as well, and nothing else', () => {
        expect(tournamentGameCounts).toEqual([1, 2, 4, 6, 8, 10]);
        expect(tournamentTestGameCounts).toEqual([1, 2, 4, 6, 8, 10, 20, 30, 50]);
        for (const gamesPerPair of tournamentTestGameCounts) expect(createTournamentRequestSchema.safeParse({ ...request, gamesPerPair }).success, String(gamesPerPair)).toBe(true);
        for (const gamesPerPair of [0, 3, 12, 40, 100]) expect(createTournamentRequestSchema.safeParse({ ...request, gamesPerPair }).success, String(gamesPerPair)).toBe(false);
    });

    it('allows a 1-ply opening only at a single game or one opening a pair, and a scheduled clock alone', () => {
        expect(createTournamentRequestSchema.safeParse({ ...request, openingPlies: 1 }).success).toBe(true);
        expect(createTournamentRequestSchema.safeParse({ ...request, openingPlies: 1, gamesPerPair: 1 }).success).toBe(true);
        expect(createTournamentRequestSchema.safeParse({ ...request, openingPlies: 1, gamesPerPair: 4 }).success).toBe(false);
        expect(createTournamentRequestSchema.safeParse({ ...request, timeControl: turn(60) }).success).toBe(true);
        expect(createTournamentRequestSchema.safeParse({ ...request, timeControl: turn(61) }).success).toBe(false);
        expect(createTournamentRequestSchema.safeParse({ ...request, timeControl: { mode: `unlimited` } }).success).toBe(false);
        expect(createTournamentRequestSchema.safeParse({ ...request, timeControl: { mode: `match`, mainTimeMs: 600_000, incrementMs: 10_000 } }).success).toBe(true);
    });

    it('holds a person to 2 running and 10 a day, and a bot to 2 running, of any size', () => {
        expect([tournamentLiveCap, tournamentDailyCap, tournamentPerBotCap]).toEqual([2, 10, 2]);
    });
});

describe('why a tournament ends early', () => {
    it('names every stop and cut reason, a duel of old\'s among them, once', () => {
        const named = [...tournamentStopReasons, ...tournamentCutReasons, ...duelCutReasons];
        expect([...tournamentEndReasonSchema.options].sort()).toEqual([...new Set(named)].sort());
        expect(tournamentStopReasons).toEqual([`creator`, `operator`, `banned`, `deleted`]);
    });
});

describe('a test\'s estimate', () => {
    it('counts up to a test\'s most games a bot, a side the first or the rest', () => {
        const estimate = { games: 70, points: { first: 35.5, second: 34.5 }, rating: 5, low: null, high: null, chance: 0.5, favored: `first`, verdict: `too_close`, narrowed: null };
        expect(estimateSchema.safeParse(estimate).success).toBe(true);
        expect(estimateSchema.safeParse({ ...estimate, games: tournamentBotGamesMax.test + 1 }).success).toBe(false);
        expect(estimateSchema.safeParse({ ...estimate, favored: `third` }).success).toBe(false);
    });
});

describe('the games a field plays', () => {
    it('lets no bot play past 30 games, or 70 in a test', () => {
        expect(tournamentBotGamesMax).toEqual({ event: 30, test: 70 });
        expect(gamesPerBot(5, 6)).toBe(24);
        expect(gamesPerPairFits(2, 10, false)).toBe(true);
        expect(gamesPerPairFits(2, 20, false)).toBe(false);
        expect(gamesPerPairFits(2, 50, true)).toBe(true);
        expect(gamesPerPairFits(5, 6, false)).toBe(true);
        expect(gamesPerPairFits(5, 8, false)).toBe(false);
        expect(gamesPerPairFits(8, 10, true)).toBe(true);
        expect(gamesPerPairFits(4, 30, true)).toBe(false);
        expect(gamesPerPairFits(4, 20, true)).toBe(true);
        expect(gamesPerPairFits(3, 3, true)).toBe(false);
    });

    it('bounds one tournament\'s games by its longest field, eight bots at ten games a pair', () => {
        expect(tournamentGamesMax).toBe(280);
    });
});

describe('a tournament a person set up as the site reads it', () => {
    it('names it for its creator by its format, a duel at two bots alone', () => {
        expect(personTournamentName(`bruno`, `round_robin`)).toBe(`Round robin by bruno`);
        expect(personTournamentName(`bruno`, `duel`)).toBe(`Duel by bruno`);
        expect(tournamentFormatOf({ origin: `person`, maxEntrants: 2 })).toBe(`duel`);
        expect(tournamentFormatOf({ origin: `person`, maxEntrants: 3 })).toBe(`round_robin`);
        expect(tournamentFormatOf({ origin: `operator`, maxEntrants: 12 })).toBe(`round_robin`);
    });

    it('holds a pair\'s games for every opening it plays, a single game to fifty', () => {
        const bot = (key: number) => ({ key, name: `bot${String(key)}` });
        const game = { x: 1, gameId: null, outcome: `pending`, point: null, missing: [], reason: null, turns: null };
        const pairing = (count: number) => ({ first: bot(1), second: bot(2), games: Array.from({ length: count }, () => game) });
        for (const count of [1, 2, 4, 10, 50]) expect(tournamentPairingSchema.safeParse(pairing(count)).success, String(count)).toBe(true);
        for (const count of [0, 52]) expect(tournamentPairingSchema.safeParse(pairing(count)).success, String(count)).toBe(false);
    });

    it('numbers a game within its pair\'s games, says its format, and names who set it up', () => {
        const line = { id: `t_abcdefghjkmn`, name: `Round robin by bruno`, format: `round_robin`, round: 3, game: 7, of: 10, createdBy: `bruno` };
        expect(gameTournamentSchema.parse(line)).toEqual(line);
        expect(gameTournamentSchema.safeParse({ ...line, id: `d_abcdefghjkmn`, game: 50, of: 50, format: `duel` }).success).toBe(true);
        expect(gameTournamentSchema.safeParse({ ...line, game: 51 }).success).toBe(false);
        expect(gameTournamentSchema.safeParse({ ...line, game: 0 }).success).toBe(false);
        expect(gameTournamentSchema.safeParse({ ...line, of: undefined }).success).toBe(false);
        expect(gameTournamentSchema.safeParse({ ...line, format: `league` }).success).toBe(false);
    });

    it('reads a tournament by its t_ id, or a duel kept from the duels of old by its d_ id', () => {
        expect(tournamentIdSchema.safeParse(`t_abcdefghjkmn`).success).toBe(true);
        expect(tournamentIdSchema.safeParse(`d_abcdefghjkmn`).success).toBe(true);
        expect(tournamentIdSchema.safeParse(`s_abcdefghjkmn`).success).toBe(false);
        expect(tournamentIdSchema.safeParse(`d_abcdefghjkm`).success).toBe(false);
    });

    it('lists every running tournament, and counts a caller\'s duels and round robins when it names them', () => {
        expect(tournamentListSchema.parse({ running: [], scheduled: [], past: [], quota: { live: 2, today: 10 } }).quota).toEqual({ live: 2, today: 10 });
        expect(tournamentListSchema.safeParse({ running: null, scheduled: [], past: [] }).success).toBe(false);
        expect(tournamentListSchema.safeParse({ running: [], scheduled: [], past: [], quota: { live: 3, today: 0 } }).success).toBe(false);
        expect(tournamentListSchema.safeParse({ running: [], scheduled: [], past: [], quota: { live: 0, today: 11 } }).success).toBe(false);
    });

    it('counts a bot\'s running duels and round robins together, at most two', () => {
        expect(tournamentBotStateSchema.parse({ name: `pebble`, duelsByOthers: true, running: 2 }).running).toBe(2);
        expect(tournamentBotStateSchema.safeParse({ name: `pebble`, duelsByOthers: true, running: 3 }).success).toBe(false);
        expect(tournamentBotStateSchema.safeParse({ name: `pebble`, duelsByOthers: true, dueling: [], roundRobins: 1 }).success).toBe(false);
    });

    it('says why a tournament ended early and the bot whose leaving cut it short, where its waits stand, and a test\'s estimates', () => {
        const shape = tournamentDetailSchema.shape;
        expect(shape.end.safeParse({ reason: `creator`, round: 3 }).success).toBe(true);
        expect(shape.end.safeParse({ reason: `missed`, round: 1, bot: { key: 2, name: `cinder` } }).success).toBe(true);
        expect(shape.end.safeParse({ reason: `starter`, round: 3 }).success).toBe(false);
        expect(shape.end.safeParse({ reason: `offline`, round: 1, bot: { key: 1, name: `cinder` } }).success).toBe(true);
        expect(shape.status.safeParse(`cut_short`).success).toBe(true);
        expect(shape.waiting.safeParse([{ key: 2, until: `2026-10-04T12:00:42Z` }]).success).toBe(true);
        expect(shape.status.safeParse(`stopped`).success).toBe(true);
    });
});

describe('tournamentMeta', () => {
    const summary = (changes: Partial<TournamentSummary>): TournamentSummary => ({
        id: `t_abcdefghjkmn`,
        name: `Round robin by bruno`,
        origin: `person`,
        format: `round_robin`,
        createdBy: `bruno`,
        rated: false,
        test: false,
        gamesPerPair: 2,
        status: `running`,
        startsAt: `2026-10-04T12:00:00Z`,
        timeControl: turn(10),
        openingPlies: 5,
        entrants: 6,
        maxEntrants: 6,
        winner: null,
        round: { current: 3, of: 5 },
        ...changes,
    });

    it('describes a person\'s round robin by its creator, its round, and its tag', () => {
        expect(tournamentMeta(summary({}))).toEqual({
            title: `Round robin by bruno - HeXO Arena`,
            description: `Bot round robin of 6 bots set up by bruno; round 3 of 5 live; unrated`,
        });
        expect(tournamentMeta(summary({ test: true, status: `finished`, round: null, winner: { name: `hextide`, ownerName: `ana` } })).description).toBe(
            `Bot test of 6 bots set up by bruno; hextide won; test`,
        );
        expect(tournamentMeta(summary({ status: `stopped`, round: null })).description).toBe(`Bot round robin of 6 bots set up by bruno; stopped; unrated`);
    });

    it('names a duel by its two bots, its length, and its score', () => {
        const game = { x: 1, gameId: null, outcome: `pending` as const, point: null, missing: [], reason: null, turns: null };
        const pair = { first: { key: 1, name: `devbot-b`, points: 4 }, second: { key: 2, name: `devbot-c`, points: 2 }, games: [game] };
        const duel = summary({ name: `Duel by bruno`, format: `duel`, gamesPerPair: 10, entrants: 2, maxEntrants: 2, round: { current: 1, of: 1 }, pair });
        expect(tournamentMeta(duel)).toEqual({
            title: `devbot-b vs devbot-c - HeXO Arena`,
            description: `Bot duel of 10 games between two bots, set up by bruno; running; devbot-b leads 4-2; unrated`,
        });
        expect(tournamentMeta({ ...duel, status: `cut_short`, round: null }).description).toBe(`Bot duel of 10 games between two bots, set up by bruno; cut short at 4-2; unrated`);
    });
});
