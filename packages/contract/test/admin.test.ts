import { describe, expect, it } from 'vitest';
import { adminReasonSchema, adminRequestSchema, adminResponseSchema } from '../src';

describe('adminRequestSchema', () => {
    it('takes a status request and nothing beside it', () => {
        expect(adminRequestSchema.parse({ op: `status` })).toEqual({ op: `status` });
        expect(adminRequestSchema.safeParse({ op: `status`, extra: 1 }).success).toBe(false);
        expect(adminRequestSchema.safeParse({ op: `reset-rating` }).success).toBe(false);
    });

    it('wants a reason on every mutation', () => {
        expect(adminRequestSchema.safeParse({ op: `pause`, reason: `incident` }).success).toBe(true);
        expect(adminRequestSchema.safeParse({ op: `pause` }).success).toBe(false);
        expect(adminRequestSchema.safeParse({ op: `resume`, reason: `` }).success).toBe(false);
    });

    it('aborts by exactly one of a well-formed game id and a bot name', () => {
        const gameId = `g_0b7a3c1e-2f4d-4a5b-8c6d-7e8f9a0b1c2d`;
        expect(adminRequestSchema.safeParse({ op: `abort-game`, gameId, reason: `r` }).success).toBe(true);
        expect(adminRequestSchema.safeParse({ op: `abort-game`, bot: `alpha`, reason: `r` }).success).toBe(true);
        expect(adminRequestSchema.safeParse({ op: `abort-game`, gameId, bot: `alpha`, reason: `r` }).success).toBe(false);
        expect(adminRequestSchema.safeParse({ op: `abort-game`, reason: `r` }).success).toBe(false);
        expect(adminRequestSchema.safeParse({ op: `abort-game`, gameId: `g_nope`, reason: `r` }).success).toBe(false);
    });

    it('excludes game ids and player names from a recompute, none by default', () => {
        expect(adminRequestSchema.parse({ op: `recompute-ratings`, reason: `r` })).toEqual({
            op: `recompute-ratings`,
            exclude: [],
            reason: `r`,
        });
        const exclude = [`g_0b7a3c1e-2f4d-4a5b-8c6d-7e8f9a0b1c2d`, `alpha`];
        expect(adminRequestSchema.safeParse({ op: `recompute-ratings`, exclude, reason: `r` }).success).toBe(true);
        expect(adminRequestSchema.safeParse({ op: `recompute-ratings`, exclude: [`g_x y`], reason: `r` }).success).toBe(false);
    });

    it('targets bots by a name that passes the name rules', () => {
        expect(adminRequestSchema.safeParse({ op: `delist-bot`, name: `alpha`, reason: `r` }).success).toBe(true);
        expect(adminRequestSchema.safeParse({ op: `delete-user`, name: `ann`, reason: `r` }).success).toBe(true);
        expect(adminRequestSchema.safeParse({ op: `relist-bot`, name: `9lives`, reason: `r` }).success).toBe(false);
        expect(adminRequestSchema.safeParse({ op: `delist-bot`, name: `a`.repeat(31), reason: `r` }).success).toBe(false);
    });
});

describe('adminReasonSchema', () => {
    it('wants a reason with content, at most 500 chars', () => {
        expect(adminReasonSchema.parse(`  spam  `)).toBe(`spam`);
        expect(adminReasonSchema.safeParse(`   `).success).toBe(false);
        expect(adminReasonSchema.safeParse(`a`.repeat(501)).success).toBe(false);
    });
});

describe('adminResponseSchema', () => {
    it('closes the error codes', () => {
        expect(adminResponseSchema.safeParse({ kind: `error`, error: `x`, code: `not_found` }).success).toBe(true);
        expect(adminResponseSchema.safeParse({ kind: `error`, error: `x`, code: `teapot` }).success).toBe(false);
    });
});
