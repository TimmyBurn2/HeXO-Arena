import { describe, expect, it } from 'vitest';
import {
    accountDeclarationSchema,
    adminRequestSchema,
    analysisCoordLimit,
    analysisLineSchema,
    analysisListSchema,
    analysisPositionsPath,
    analysisRequestSchema,
    analysisStoneCap,
    analysisHeuristicLimit,
    analyzerMaxSecondsCap,
    botAccountSchema,
    botAnalysisSocketPath,
    botDirectoryQuerySchema,
    gameAnalysesPath,
    meUpdateRequestSchema,
    positionCheckRequestSchema,
    positionReadingRequestSchema,
    positionReadingSchema,
    streamEventSchema,
} from '../src';
import { buildOpenApiDocument } from '../src/openapi';

const position = { cells: [{ x: 0, y: 0, side: `x` }], toMove: `o` } as const;
const ask = { ...position, analyzer: null, lines: 3, seconds: 2 } as const;
const kestrel = { name: `kestrel`, version: `0.9`, ownerName: `tom`, values: { scale: 1, cuts: null, meaning: `raw` } };
const line = { cells: [{ x: 1, y: 0 }, { x: 0, y: 1 }], heuristic: 0.12 };

const document = buildOpenApiDocument();

// Reads through local $refs, since where a shape is defined is the document's layout.
function dig(value: unknown, ...keys: string[]): unknown {
    let current = follow(value);
    for (const key of keys) {
        if (typeof current !== `object` || current === null) return undefined;
        current = follow(Reflect.get(current, key) as unknown);
    }
    return current;
}

function follow(value: unknown): unknown {
    if (typeof value !== `object` || value === null) return value;
    const ref: unknown = Reflect.get(value, `$ref`);
    return typeof ref === `string` ? dig(document, ...ref.replace(`#/`, ``).split(`/`)) : value;
}

describe('the analyzer declaration', () => {
    it('reads two seconds and only between games unless the bot says otherwise', () => {
        expect(accountDeclarationSchema.parse({ analyzer: { lines: 2 } }).analyzer).toEqual({ maxSeconds: 2, lines: 2, whilePlaying: false });
        expect(accountDeclarationSchema.parse({ analyzer: { maxSeconds: 10, lines: 3, whilePlaying: true } }).analyzer).toEqual({
            maxSeconds: 10,
            lines: 3,
            whilePlaying: true,
        });
    });

    it('withdraws with null and leaves the stored one alone when absent', () => {
        expect(accountDeclarationSchema.parse({ analyzer: null }).analyzer).toBeNull();
        expect(accountDeclarationSchema.parse({})).not.toHaveProperty(`analyzer`);
    });

    it(`refuses seconds outside 1 to ${String(analyzerMaxSecondsCap)}, lines outside 1 to 3, a missing line count, and unknown keys`, () => {
        for (const analyzer of [
            { lines: 1, maxSeconds: 0 },
            { lines: 1, maxSeconds: analyzerMaxSecondsCap + 1 },
            { lines: 1, maxSeconds: 1.5 },
            { lines: 0 },
            { lines: 4 },
            {},
            { lines: 1, depth: 3 },
        ]) {
            expect(accountDeclarationSchema.safeParse({ analyzer }).success, JSON.stringify(analyzer)).toBe(false);
        }
    });

    it('declares how its heuristic reads: scale 1 and raw when absent, and cuts that judge drops of value only when given', () => {
        const values = (declared: unknown) => accountDeclarationSchema.parse({ analyzer: { lines: 1, values: declared } }).analyzer?.values;
        expect(accountDeclarationSchema.parse({ analyzer: { lines: 1 } }).analyzer).not.toHaveProperty(`values`);
        expect(values({})).toEqual({ scale: 1, meaning: `raw` });
        expect(values({ scale: 1000 })).toEqual({ scale: 1000, meaning: `raw` });
        const cuts = { inaccuracy: 0.1, mistake: 0.2, blunder: 0.3 };
        expect(values({ cuts, meaning: `expected` })).toEqual({ scale: 1, cuts, meaning: `expected` });
        expect(values({ scale: 0.5, cuts: { inaccuracy: 0.05, mistake: 1, blunder: 2 } })).toEqual({ scale: 0.5, cuts: { inaccuracy: 0.05, mistake: 1, blunder: 2 }, meaning: `raw` });
    });

    it(`refuses a scale outside above 0 to ${String(analysisHeuristicLimit)}, cuts outside above 0 to 2 or not rising, another meaning, and unknown keys`, () => {
        for (const declared of [
            { scale: 0 },
            { scale: -1 },
            { scale: analysisHeuristicLimit * 2 },
            { cuts: { inaccuracy: 0, mistake: 0.2, blunder: 0.3 } },
            { cuts: { inaccuracy: 0.1, mistake: 0.2, blunder: 2.5 } },
            { cuts: { inaccuracy: 0.2, mistake: 0.2, blunder: 0.3 } },
            { cuts: { inaccuracy: 0.3, mistake: 0.2, blunder: 0.1 } },
            { cuts: { inaccuracy: 0.1, mistake: 0.2 } },
            { cuts: { inaccuracy: 0.1, mistake: 0.2, blunder: 0.3, great: 0.5 } },
            { scale: 1, shape: `tanh` },
            { meaning: `winning chances` },
            { meaning: null },
            null,
        ]) {
            expect(accountDeclarationSchema.safeParse({ analyzer: { lines: 1, values: declared } }).success, JSON.stringify(declared)).toBe(false);
        }
    });

    it('reads back on the account as stored, with whether the session is open, or null', () => {
        const account = { name: `kestrel`, rating: 1500, provisional: true, levels: null };
        const analyzer = { maxSeconds: 2, lines: 3, whilePlaying: false, values: { scale: 1, cuts: { inaccuracy: 0.1, mistake: 0.2, blunder: 0.3 }, meaning: `expected` }, ready: false };
        expect(botAccountSchema.parse({ ...account, analyzer }).analyzer).toEqual(analyzer);
        expect(botAccountSchema.parse({ ...account, analyzer: null }).analyzer).toBeNull();
        expect(botAccountSchema.safeParse(account).success).toBe(false);
        const { values: _omitted, ...withoutValues } = analyzer;
        expect(botAccountSchema.safeParse({ ...account, analyzer: withoutValues }).success).toBe(false);
        const { meaning: _unsaid, ...withoutMeaning } = analyzer.values;
        expect(botAccountSchema.safeParse({ ...account, analyzer: { ...analyzer, values: withoutMeaning } }).success).toBe(false);
    });

    it('narrows the directory to analyzers with analyzer=1 and nothing else', () => {
        expect(botDirectoryQuerySchema.parse({ analyzer: `1` })).toEqual({ analyzer: `1` });
        expect(botDirectoryQuerySchema.safeParse({ analyzer: `true` }).success).toBe(false);
    });
});

describe('the analysis session line', () => {
    it('parses as a stream event carrying the socket and its token', () => {
        const event = { type: `analysisSession`, engine: { socketUrl: botAnalysisSocketPath, token: `has_token` } };
        expect(streamEventSchema.parse(event)).toEqual(event);
        expect(streamEventSchema.safeParse({ type: `analysisSession` }).success).toBe(false);
    });
});

describe('a position request', () => {
    it(`takes 1 to ${String(analysisStoneCap)} stones, each within ${String(analysisCoordLimit)} of the origin`, () => {
        expect(positionReadingRequestSchema.safeParse(ask).success).toBe(true);
        expect(positionReadingRequestSchema.safeParse({ ...ask, cells: [] }).success).toBe(false);
        const many = Array.from({ length: analysisStoneCap + 1 }, (_, x) => ({ x, y: 0, side: `x` as const }));
        expect(positionReadingRequestSchema.safeParse({ ...ask, cells: many }).success).toBe(false);
        expect(positionReadingRequestSchema.safeParse({ ...ask, cells: many.slice(0, analysisStoneCap).map((cell) => ({ ...cell, x: cell.x - 200 })) }).success).toBe(true);
        for (const cell of [
            { x: analysisCoordLimit + 1, y: 0, side: `x` },
            { x: 0, y: -analysisCoordLimit - 1, side: `o` },
        ]) {
            expect(positionReadingRequestSchema.safeParse({ ...ask, cells: [cell] }).success, JSON.stringify(cell)).toBe(false);
        }
    });

    it('asks for 1, 2, or 5 seconds and 1 to 3 lines, of a named analyzer or any', () => {
        for (const seconds of [1, 2, 5]) expect(positionReadingRequestSchema.safeParse({ ...ask, seconds }).success).toBe(true);
        for (const seconds of [0, 3, 10]) expect(positionReadingRequestSchema.safeParse({ ...ask, seconds }).success).toBe(false);
        for (const lines of [0, 4]) expect(positionReadingRequestSchema.safeParse({ ...ask, lines }).success).toBe(false);
        expect(positionReadingRequestSchema.parse({ ...ask, analyzer: `kestrel` }).analyzer).toBe(`kestrel`);
        expect(positionReadingRequestSchema.safeParse({ ...ask, analyzer: `not a name` }).success).toBe(false);
    });

    it('checks the position alone against live games', () => {
        expect(positionCheckRequestSchema.parse(position)).toEqual(position);
        expect(positionCheckRequestSchema.safeParse({ cells: position.cells }).success).toBe(false);
    });
});

describe('a line', () => {
    it('holds two cells and a heuristic, a forced win, or both', () => {
        expect(analysisLineSchema.parse(line)).toEqual(line);
        expect(analysisLineSchema.parse({ cells: line.cells, winIn: -3 }).winIn).toBe(-3);
        expect(analysisLineSchema.safeParse({ cells: line.cells }).success).toBe(false);
        expect(analysisLineSchema.safeParse({ ...line, cells: [{ x: 1, y: 0 }] }).success).toBe(false);
    });

    it('never claims a win in zero turns or past a thousand', () => {
        for (const winIn of [0, 1001, -1001, 1.5]) {
            expect(analysisLineSchema.safeParse({ cells: line.cells, winIn }).success, String(winIn)).toBe(false);
        }
    });
});

describe('a reading', () => {
    it('is done with its analyzer and lines, queued with what is ahead, or failed with why', () => {
        const done = { status: `done`, analyzer: kestrel, seconds: 2, elapsedMs: 1830, readAt: `2026-10-02T10:00:00Z`, cached: false, lines: [line], left: 212 };
        expect(positionReadingSchema.parse(done)).toEqual(done);
        expect(positionReadingSchema.parse({ status: `queued`, ahead: 2, left: 212 })).toEqual({ status: `queued`, ahead: 2, left: 212 });
        expect(positionReadingSchema.parse({ status: `queued`, ahead: 0, analyzer: kestrel, left: 212 })).toMatchObject({ analyzer: kestrel });
        const failed = { status: `failed`, analyzer: kestrel, failure: `inconsistent`, left: 212 };
        expect(positionReadingSchema.parse(failed)).toEqual(failed);
        expect(positionReadingSchema.safeParse({ ...done, lines: [] }).success).toBe(false);
        expect(positionReadingSchema.safeParse({ ...failed, failure: `lazy` }).success).toBe(false);
    });
});

describe('a game reading', () => {
    const community = {
        kind: `community`,
        analysisId: `a_1`,
        analyzer: null,
        involved: false,
        status: `queued`,
        requestedAt: `2026-10-02T10:00:00Z`,
        finishedAt: null,
        queuePosition: 2,
        progress: { done: 0, of: 40 },
        seconds: 2,
        turns: [],
    };

    it('lists community readings, each marked whether its analyzer\'s owner played, each bot seat\'s own view, an opt-out, and whether an independent analyzer is online', () => {
        const own = { kind: `own`, side: `x`, player: `hextide`, values: { scale: 1, cuts: null, meaning: `raw` }, turns: [{ turn: 4, toMove: `x`, lines: [line] }] };
        const list = { analyses: [community, own], optedOut: false, independentOnline: true };
        expect(analysisListSchema.parse(list)).toEqual(list);
        expect(analysisListSchema.safeParse({ analyses: [], optedOut: false }).success).toBe(false);
        expect(analysisListSchema.safeParse({ ...list, analyses: [{ ...own, kind: `peer` }] }).success).toBe(false);
        const { involved: _involved, ...unmarked } = community;
        expect(analysisListSchema.safeParse({ ...list, analyses: [unmarked] }).success).toBe(false);
    });

    it('may name an analyzer or leave it to any', () => {
        expect(analysisRequestSchema.parse({})).toEqual({});
        expect(analysisRequestSchema.parse({ analyzer: `kestrel` })).toEqual({ analyzer: `kestrel` });
    });
});

describe('the opt-out', () => {
    it('is the one setting a user changes, and an unknown key is refused', () => {
        expect(meUpdateRequestSchema.parse({ analysisOptOut: true })).toEqual({ analysisOptOut: true });
        expect(meUpdateRequestSchema.safeParse({ name: `other` }).success).toBe(false);
    });
});

describe('the operator', () => {
    it('deletes a reading by id with a reason', () => {
        const id = `a_0f8d2c4e-1b3a-4c5d-8e9f-0a1b2c3d4e5f`;
        expect(adminRequestSchema.parse({ op: `delete-analysis`, id, reason: `lied about wins` })).toEqual({ op: `delete-analysis`, id, reason: `lied about wins` });
        expect(adminRequestSchema.safeParse({ op: `delete-analysis`, id: `g_0f8d2c4e-1b3a-4c5d-8e9f-0a1b2c3d4e5f`, reason: `x` }).success).toBe(false);
        expect(adminRequestSchema.safeParse({ op: `delete-analysis`, id }).success).toBe(false);
    });
});

describe('the analysis operations in the document', () => {
    it('lets a signed-in user ask for positions and games, and anyone read a game\'s readings', () => {
        expect(dig(document, `paths`, analysisPositionsPath, `post`, `operationId`)).toBe(`requestPositionReading`);
        expect(dig(document, `paths`, analysisPositionsPath, `post`, `security`)).toEqual([{ sessionCookie: [] }]);
        expect(dig(document, `paths`, gameAnalysesPath, `post`, `operationId`)).toBe(`requestAnalysis`);
        expect(dig(document, `paths`, gameAnalysesPath, `get`, `security`)).toEqual([]);
    });

    it('names each refusal a position request meets', () => {
        const codes = (status: string) => dig(document, `paths`, analysisPositionsPath, `post`, `responses`, status, `content`, `application/json`, `schema`, `properties`, `code`, `enum`);
        expect(codes(`409`)).toEqual([`live_position`, `seated`, `no_analyzer`, `superseded`]);
        expect(codes(`429`)).toEqual([`analysis_limit`, `analysis_busy`, `rate_limited`]);
    });

    it('documents the analysis socket with its token on the bot surface', () => {
        const socket = dig(document, `paths`, botAnalysisSocketPath, `get`);
        expect(dig(socket, `operationId`)).toBe(`openAnalysisSession`);
        expect(dig(socket, `responses`, `101`)).toBeDefined();
        expect(dig(socket, `responses`, `401`)).toBeDefined();
    });
});
