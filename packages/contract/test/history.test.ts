import { describe, expect, it } from 'vitest';
import {
    finishedGameEntrySchema,
    finishedGamesPageCap,
    finishedGamesPageSchema,
    finishedGamesPageSize,
    finishedGamesPath,
    finishedGamesQuerySchema,
} from '../src/history';
import { buildOpenApiDocument } from '../src/openapi';

const entry = {
    gameId: `g_1`,
    players: {
        x: { name: `hextide`, rating: 1712, provisional: true, kind: `bot` },
        o: { name: `bruno`, rating: 905, provisional: true, kind: `user` },
    },
    winner: `x`,
    reason: `six-in-a-row`,
    timeControl: { mode: `turn`, turnTimeMs: 20_000 },
    openingPlies: 5,
    turns: 31,
    finishedAt: `2026-10-01T08:49:13Z`,
    rated: true,
};

describe('finishedGamesQuerySchema', () => {
    it('takes every filter together', () => {
        const parsed = finishedGamesQuerySchema.parse({
            player: `hextide`,
            vs: `quietlake`,
            kind: `bot-bot`,
            result: `won`,
            side: `x`,
            reason: `six-in-a-row`,
            clock: `turn`,
            opening: `5`,
            before: `2026-10-01`,
            cursor: `2.381`,
        });
        expect(parsed).toMatchObject({ player: `hextide`, opening: `5`, cursor: `2.381` });
    });

    it.each([
        [{ vs: `quietlake` }],
        [{ result: `won` }],
        [{ result: `lost` }],
        [{ side: `o` }],
        [{ player: `hextide`, vs: `HexTide` }],
    ])('refuses %j, which needs a player or names one twice', (filters) => {
        expect(finishedGamesQuerySchema.safeParse(filters).success).toBe(false);
    });

    it('takes a game without a winner with no player', () => {
        expect(finishedGamesQuerySchema.parse({ result: `none` })).toEqual({ result: `none` });
    });

    it.each([
        [{ analysed: `1` }],
        [{ opening: `2` }],
        [{ clock: `blitz` }],
        [{ before: `2026-13-01` }],
        [{ before: `yesterday` }],
        [{ cursor: `1.20` }],
        [{ cursor: `11.20` }],
        [{ cursor: `2.0` }],
        [{ cursor: `abc` }],
    ])('refuses %j', (filters) => {
        expect(finishedGamesQuerySchema.safeParse(filters).success).toBe(false);
    });
});

describe('finishedGamesPageSchema', () => {
    it('holds a page of entries, its next and previous cursors, and its number', () => {
        const page = { games: Array.from({ length: finishedGamesPageSize }, () => entry), next: `4.381`, previous: `2.425`, page: 3 };
        expect(finishedGamesPageSchema.parse(page)).toEqual(page);
        expect(finishedGamesPageSchema.safeParse({ ...page, games: [...page.games, entry] }).success).toBe(false);
        expect(finishedGamesPageSchema.safeParse({ ...page, previous: `1.425` }).success).toBe(false);
        expect(finishedGamesPageSchema.safeParse({ games: [], next: null, previous: null, page: finishedGamesPageCap + 1 }).success).toBe(false);
    });

    it('carries the record of the player named, counted past the cap and split by side', () => {
        const record = { games: 41, won: 24, lost: 15, undecided: 2, asX: { games: 21, won: 14, lost: 6 }, asO: { games: 20, won: 10, lost: 9 } };
        const page = { games: [entry], next: null, previous: null, page: 1, record };
        expect(finishedGamesPageSchema.parse(page)).toEqual(page);
        expect(finishedGamesPageSchema.safeParse({ ...page, record: { ...record, won: -1 } }).success).toBe(false);
        expect(finishedGamesPageSchema.safeParse({ ...page, record: { ...record, asO: { games: 20, won: 10 } } }).success).toBe(false);
    });

    it('carries no analysis count yet', () => {
        expect(finishedGameEntrySchema.parse({ ...entry, analyses: 1 })).not.toHaveProperty(`analyses`);
    });
});

describe('listFinishedGames in the document', () => {
    it('is a public read with every filter as a query parameter', () => {
        const document = buildOpenApiDocument();
        const operation = document.paths[finishedGamesPath]?.get;
        expect(operation?.operationId).toBe(`listFinishedGames`);
        expect(operation?.security).toEqual([]);
        const names = (operation?.parameters ?? []).map((parameter) => (`name` in parameter ? parameter.name : ``));
        expect(names.sort()).toEqual([`before`, `clock`, `cursor`, `kind`, `opening`, `player`, `reason`, `result`, `side`, `vs`]);
        expect(Object.keys(operation?.responses ?? {}).sort()).toEqual([`200`, `400`, `404`, `429`]);
    });
});
