import { describe, expect, it } from 'vitest';
import {
    duelExportPath,
    duelGamesMax,
    gameExportGlobalLimit,
    gameExportLimit,
    tournamentExportPath,
    tournamentGamesMax,
    tournamentListQuerySchema,
    tournamentSummarySchema,
    tournamentsPath,
} from '../src';
import { buildOpenApiDocument } from '../src/openapi';

const document = buildOpenApiDocument();

describe('the game exports in the document', () => {
    it.each([
        [duelExportPath, `exportDuel`],
        [tournamentExportPath, `exportTournament`],
    ])('%s is a public read answering a zip attachment, its own rate limit, or not_found', (path, operationId) => {
        const operation = document.paths[path]?.get;
        expect(operation?.operationId).toBe(operationId);
        expect(operation?.security).toEqual([]);
        expect(Object.keys(operation?.responses ?? {}).sort()).toEqual([`200`, `404`, `429`]);
        const zip = document.components?.responses?.[`GameExport`];
        expect(zip !== undefined && `content` in zip ? Object.keys(zip.content ?? {}) : []).toEqual([`application/zip`]);
        expect(zip !== undefined && `headers` in zip ? Object.keys(zip.headers ?? {}) : []).toEqual([`Content-Disposition`]);
        expect(operation?.responses[`429`]).toEqual({ $ref: `#/components/responses/ExportLimited` });
    });

    it('bounds an export by the most games a duel or a tournament plays', () => {
        expect(duelGamesMax).toBe(50);
        expect(tournamentGamesMax).toBe(132);
        expect(gameExportLimit.burst).toBeLessThan(gameExportGlobalLimit.burst);
    });
});

describe('the tournament list for one bot', () => {
    it('takes a bot name and lets any other parameter pass, as the list did before it read one', () => {
        expect(tournamentListQuerySchema.parse({ bot: `hextide` })).toEqual({ bot: `hextide` });
        expect(tournamentListQuerySchema.parse({ page: `2` })).toEqual({});
        expect(tournamentListQuerySchema.safeParse({ bot: `` }).success).toBe(false);
        const names = (document.paths[tournamentsPath]?.get?.parameters ?? []).map((parameter) => (`name` in parameter ? parameter.name : ``));
        expect(names).toEqual([`bot`]);
    });

    it('carries the bot\'s entry and place on each summary, and when the tournament ended', () => {
        const summary = {
            id: `t_autumnrobin1`,
            name: `Autumn round robin`,
            status: `finished`,
            startsAt: `2026-10-01T18:00:00Z`,
            timeControl: { mode: `turn`, turnTimeMs: 10_000 },
            openingPlies: 5,
            entrants: 6,
            maxEntrants: 12,
            winner: { name: `hextide`, ownerName: `ana` },
            round: null,
            endedAt: `2026-10-01T19:12:40Z`,
            bot: { state: `withdrawn`, reason: `missed`, rank: 6, points: 1 },
        };
        expect(tournamentSummarySchema.parse(summary)).toEqual(summary);
        expect(tournamentSummarySchema.parse({ ...summary, bot: { state: `absent`, rank: null, points: null } }).bot).toEqual({ state: `absent`, rank: null, points: null });
        expect(tournamentSummarySchema.safeParse({ ...summary, bot: { state: `won`, rank: 1, points: 9 } }).success).toBe(false);
    });

    it('carries the caller\'s own bot and its place, which a list for a signed-in owner adds', () => {
        const summary = {
            id: `t_autumnrobin1`,
            name: `Autumn round robin`,
            status: `running`,
            startsAt: `2026-10-01T18:00:00Z`,
            timeControl: { mode: `turn`, turnTimeMs: 10_000 },
            openingPlies: 5,
            entrants: 4,
            maxEntrants: 12,
            winner: null,
            round: { current: 2, of: 3 },
            yours: { bot: `hextide`, place: { state: `playing`, rank: 1, points: 3 } },
        };
        expect(tournamentSummarySchema.parse(summary)).toEqual(summary);
        expect(tournamentSummarySchema.parse({ ...summary, yours: { bot: `deleted bot`, deleted: true, place: { state: `entered`, rank: null, points: null } } }).yours?.deleted).toBe(true);
        expect(tournamentSummarySchema.safeParse({ ...summary, yours: { place: { state: `playing`, rank: 1, points: 3 } } }).success).toBe(false);
        expect(document.paths[tournamentsPath]?.get?.security).toEqual([{ sessionCookie: [] }, {}]);
    });
});
