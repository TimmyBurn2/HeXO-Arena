import { describe, expect, it } from 'vitest';
import {
    createRoundRobinRequestSchema,
    defaultOpeningPlies,
    defaultRoundRobinGamesPerPair,
    duelBotStateSchema,
    gameTournamentSchema,
    roundRobinDailyCap,
    roundRobinGamesPerPair,
    roundRobinLiveCap,
    roundRobinMaxBots,
    roundRobinName,
    roundRobinTestGamesPerPair,
    tournamentDetailSchema,
    tournamentListSchema,
    tournamentMeta,
    tournamentMinPresent,
    tournamentPairingSchema,
    type TournamentSummary,
} from '../src';

const turn = (seconds: number) => ({ mode: `turn` as const, turnTimeMs: seconds * 1_000 });
const three = [{ name: `hextide` }, { name: `quietlake` }, { name: `pebble` }];
const request = { bots: three, timeControl: turn(10) };

describe('createRoundRobinRequestSchema', () => {
    it('plays one opening a pair from five plies unless asked otherwise', () => {
        const parsed = createRoundRobinRequestSchema.parse(request);
        expect(parsed.gamesPerPair).toBe(defaultRoundRobinGamesPerPair);
        expect(defaultRoundRobinGamesPerPair).toBe(2);
        expect(parsed.openingPlies).toBe(defaultOpeningPlies);
    });

    it('takes 3 to 8 distinct bots, each at a declared level or its default', () => {
        const bots = (count: number) => Array.from({ length: count }, (_, index) => ({ name: `bot${String(index)}` }));
        expect([tournamentMinPresent, roundRobinMaxBots]).toEqual([3, 8]);
        for (const count of [3, 8]) expect(createRoundRobinRequestSchema.safeParse({ ...request, bots: bots(count) }).success, String(count)).toBe(true);
        for (const count of [2, 9]) expect(createRoundRobinRequestSchema.safeParse({ ...request, bots: bots(count) }).success, String(count)).toBe(false);
        expect(createRoundRobinRequestSchema.safeParse({ ...request, bots: [...three, { name: `HexTide` }] }).success).toBe(false);
        expect(createRoundRobinRequestSchema.safeParse({ ...request, bots: [{ name: `hextide`, level: `club` }, ...three.slice(1)] }).success).toBe(true);
        expect(createRoundRobinRequestSchema.safeParse({ ...request, bots: [{ name: `hextide`, level: `Club!` }, ...three.slice(1)] }).success).toBe(false);
        expect(createRoundRobinRequestSchema.safeParse({ ...request, bots: [{ name: `hextide`, side: `x` }, ...three.slice(1)] }).success).toBe(false);
    });

    it('takes 2 or 4 games a pair, a test 6 or 10 as well, and nothing else', () => {
        expect(roundRobinGamesPerPair).toEqual([2, 4]);
        expect(roundRobinTestGamesPerPair).toEqual([2, 4, 6, 10]);
        for (const gamesPerPair of [2, 4, 6, 10]) expect(createRoundRobinRequestSchema.safeParse({ ...request, gamesPerPair }).success, String(gamesPerPair)).toBe(true);
        for (const gamesPerPair of [1, 3, 8, 12]) expect(createRoundRobinRequestSchema.safeParse({ ...request, gamesPerPair }).success, String(gamesPerPair)).toBe(false);
    });

    it('allows a 1-ply opening only at one opening a pair, and a scheduled clock alone', () => {
        expect(createRoundRobinRequestSchema.safeParse({ ...request, openingPlies: 1 }).success).toBe(true);
        expect(createRoundRobinRequestSchema.safeParse({ ...request, openingPlies: 1, gamesPerPair: 4 }).success).toBe(false);
        expect(createRoundRobinRequestSchema.safeParse({ ...request, timeControl: turn(60) }).success).toBe(true);
        expect(createRoundRobinRequestSchema.safeParse({ ...request, timeControl: turn(61) }).success).toBe(false);
        expect(createRoundRobinRequestSchema.safeParse({ ...request, timeControl: { mode: `unlimited` } }).success).toBe(false);
        expect(createRoundRobinRequestSchema.safeParse({ ...request, timeControl: { mode: `match`, mainTimeMs: 600_000, incrementMs: 10_000 } }).success).toBe(true);
    });

    it('holds a person to 1 running and 3 a day', () => {
        expect([roundRobinLiveCap, roundRobinDailyCap]).toEqual([1, 3]);
    });
});

describe('a round robin as the site reads it', () => {
    it('names a person\'s round robin for them alone', () => {
        expect(roundRobinName(`bruno`)).toBe(`Round robin by bruno`);
    });

    it('holds a pair\'s games for every opening it plays, two to ten', () => {
        const bot = (key: number) => ({ key, name: `bot${String(key)}` });
        const game = { x: 1, gameId: null, outcome: `pending`, point: null, missing: [] };
        const pairing = (count: number) => ({ first: bot(1), second: bot(2), games: Array.from({ length: count }, () => game) });
        for (const count of [2, 4, 10]) expect(tournamentPairingSchema.safeParse(pairing(count)).success, String(count)).toBe(true);
        for (const count of [1, 12]) expect(tournamentPairingSchema.safeParse(pairing(count)).success, String(count)).toBe(false);
    });

    it('numbers a game within its pair\'s openings and names who set the round robin up', () => {
        const line = { id: `t_abcdefghjkmn`, name: `Round robin by bruno`, round: 3, game: 1, leg: 4, of: 10, createdBy: `bruno` };
        expect(gameTournamentSchema.parse(line)).toEqual(line);
        expect(gameTournamentSchema.safeParse({ ...line, leg: 6 }).success).toBe(false);
        expect(gameTournamentSchema.safeParse({ ...line, game: 3 }).success).toBe(false);
    });

    it('lists every running tournament, and counts a caller\'s round robins when it names them', () => {
        expect(tournamentListSchema.parse({ running: [], scheduled: [], past: [], quota: { live: 1, today: 3 } }).quota).toEqual({ live: 1, today: 3 });
        expect(tournamentListSchema.safeParse({ running: null, scheduled: [], past: [] }).success).toBe(false);
        expect(tournamentListSchema.safeParse({ running: [], scheduled: [], past: [], quota: { live: 2, today: 0 } }).success).toBe(false);
    });

    it('counts a bot\'s round robins beside its duels, at most two together', () => {
        expect(duelBotStateSchema.parse({ name: `pebble`, duelsByOthers: true, dueling: [`hextide`], roundRobins: 1 }).roundRobins).toBe(1);
        expect(duelBotStateSchema.safeParse({ name: `pebble`, duelsByOthers: true, dueling: [], roundRobins: 3 }).success).toBe(false);
    });

    it('says why a round robin ended early, where its waits stand, and a test\'s estimates', () => {
        const shape = tournamentDetailSchema.shape;
        expect(shape.end.safeParse({ reason: `creator`, round: 3 }).success).toBe(true);
        expect(shape.end.safeParse({ reason: `starter`, round: 3 }).success).toBe(false);
        expect(shape.waiting.safeParse([{ key: 2, until: `2026-10-04T12:00:42Z` }]).success).toBe(true);
        expect(shape.status.safeParse(`stopped`).success).toBe(true);
    });
});

describe('tournamentMeta', () => {
    const summary = (changes: Partial<TournamentSummary>): TournamentSummary => ({
        id: `t_abcdefghjkmn`,
        name: `Round robin by bruno`,
        origin: `person`,
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
});
