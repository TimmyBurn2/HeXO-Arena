import { describe, expect, it } from 'vitest';
import {
    bwsMoveRequestPacketSchema,
    bwsMoveResponsePacketSchema,
    bwsSetupPacketSchema,
    htttxMoveRequestSchema,
    htttxMoveResponseSchema,
} from '../src/htttx';

describe('vendored htttx schemas', () => {
    it('accepts the stateless move request and response examples from the spec', () => {
        const request = {
            board: {
                to_move: `o`,
                cells: [{ q: 0, r: 0, p: `x` }],
            },
            time_limit: 5,
            request_id: 1,
        };
        expect(htttxMoveRequestSchema.parse(request)).toEqual(request);
        const response = {
            move: { pieces: [{ q: 1, r: 0 }, { q: -1, r: 1 }] },
            request_id: 1,
        };
        expect(htttxMoveResponseSchema.parse(response)).toEqual(response);
    });

    it('accepts a fractional time limit, which is seconds not milliseconds', () => {
        expect(htttxMoveRequestSchema.parse({ board: { to_move: `x`, cells: [] }, time_limit: 4.512 })).toMatchObject({
            time_limit: 4.512,
        });
    });

    it('rejects a move that is not exactly two placements', () => {
        const one = { move: { pieces: [{ q: 1, r: 0 }] } };
        expect(htttxMoveResponseSchema.safeParse(one).success).toBe(false);
        const three = {
            move: { pieces: [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }] },
        };
        expect(htttxMoveResponseSchema.safeParse(three).success).toBe(false);
    });

    it('accepts the basic_websocket packets the server sends and receives', () => {
        const setup = {
            type: `setup`,
            board: { cells: [{ q: 0, r: 0, p: `x` }] },
        };
        expect(bwsSetupPacketSchema.parse(setup)).toEqual(setup);
        const request = {
            type: `move_request`,
            side: `o`,
            previous: [{ side: `o`, pieces: [{ q: 1, r: 0 }, { q: 2, r: 0 }] }],
            move_time_limit: 5,
            request_id: 3,
        };
        expect(bwsMoveRequestPacketSchema.parse(request)).toEqual(request);
        const answer = {
            type: `move_response`,
            move: { pieces: [{ q: 1, r: 0 }, { q: -1, r: 1 }], evaluation: { win_in: 2 } },
            request_id: 3,
        };
        expect(bwsMoveResponsePacketSchema.parse(answer)).toEqual(answer);
    });

    it('drops unknown packet discriminators instead of guessing at them', () => {
        expect(bwsMoveResponsePacketSchema.safeParse({ type: `eval_response`, evaluation: {} }).success).toBe(false);
        expect(bwsMoveRequestPacketSchema.safeParse({ type: `config`, depth: 4 }).success).toBe(false);
    });
});
