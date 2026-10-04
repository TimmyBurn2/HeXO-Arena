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
    voided: false,
    analyses: 0,
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
            analyzed: `1`,
            event: `duel`,
            page: `3`,
        });
        expect(parsed).toMatchObject({ player: `hextide`, opening: `5`, event: `duel`, page: `3` });
    });

    it('takes games of a duel, of a tournament, or of neither, with no player needed', () => {
        for (const event of [`duel`, `tournament`, `none`] as const) expect(finishedGamesQuerySchema.parse({ event })).toEqual({ event });
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
        [{ analyzed: `true` }],
        [{ opening: `2` }],
        [{ clock: `blitz` }],
        [{ before: `2026-13-01` }],
        [{ before: `yesterday` }],
        [{ page: `0` }],
        [{ page: `11` }],
        [{ page: `02` }],
        [{ page: `2.5` }],
        [{ cursor: `2.40` }],
        [{ event: `series` }],
    ])('refuses %j', (filters) => {
        expect(finishedGamesQuerySchema.safeParse(filters).success).toBe(false);
    });
});

describe('finishedGamesPageSchema', () => {
    it('holds a page of entries, its number, the pages the filters reach, and every game they select', () => {
        const page = { games: Array.from({ length: finishedGamesPageSize }, () => entry), page: 3, pages: 7, total: 134 };
        expect(finishedGamesPageSchema.parse(page)).toEqual(page);
        expect(finishedGamesPageSchema.safeParse({ ...page, games: [...page.games, entry] }).success).toBe(false);
        expect(finishedGamesPageSchema.safeParse({ ...page, page: finishedGamesPageCap + 1 }).success).toBe(false);
        expect(finishedGamesPageSchema.safeParse({ ...page, pages: finishedGamesPageCap + 1 }).success).toBe(false);
        expect(finishedGamesPageSchema.parse({ games: [], page: 1, pages: 0, total: 0 })).toEqual({ games: [], page: 1, pages: 0, total: 0 });
        expect(finishedGamesPageSchema.safeParse({ ...page, total: -1 }).success).toBe(false);
    });

    it('carries the record of the player named, counted past the cap and split by side', () => {
        const record = { games: 41, won: 24, lost: 15, undecided: 2, voided: 0, asX: { games: 21, won: 14, lost: 6 }, asO: { games: 20, won: 10, lost: 9 } };
        const page = { games: [entry], page: 1, pages: 3, total: 41, record };
        expect(finishedGamesPageSchema.parse(page)).toEqual(page);
        expect(finishedGamesPageSchema.safeParse({ ...page, record: { ...record, won: -1 } }).success).toBe(false);
        expect(finishedGamesPageSchema.safeParse({ ...page, record: { ...record, asO: { games: 20, won: 10 } } }).success).toBe(false);
    });

    it('names the tournament a game belongs to, its round, and which of the pairing\'s two games it is', () => {
        const tournament = { id: `t_autumnrobin1`, name: `Autumn round robin`, round: 2, game: 1 };
        expect(finishedGameEntrySchema.parse({ ...entry, tournament }).tournament).toEqual(tournament);
        expect(finishedGameEntrySchema.safeParse({ ...entry, tournament: { ...tournament, game: 3 } }).success).toBe(false);
    });

    it('counts the finished community readings of a game, at most two', () => {
        expect(finishedGameEntrySchema.parse({ ...entry, analyses: 2 }).analyses).toBe(2);
        expect(finishedGameEntrySchema.safeParse({ ...entry, analyses: 3 }).success).toBe(false);
        const { analyses: _omitted, ...uncounted } = entry;
        expect(finishedGameEntrySchema.safeParse(uncounted).success).toBe(false);
    });
});

describe('listFinishedGames in the document', () => {
    it('is a public read with every filter as a query parameter', () => {
        const document = buildOpenApiDocument();
        const operation = document.paths[finishedGamesPath]?.get;
        expect(operation?.operationId).toBe(`listFinishedGames`);
        expect(operation?.security).toEqual([]);
        const names = (operation?.parameters ?? []).map((parameter) => (`name` in parameter ? parameter.name : ``));
        expect(names.sort()).toEqual([`analyzed`, `before`, `clock`, `event`, `kind`, `opening`, `page`, `player`, `reason`, `result`, `side`, `tests`, `vs`]);
        expect(Object.keys(operation?.responses ?? {}).sort()).toEqual([`200`, `400`, `404`, `429`]);
    });
});
