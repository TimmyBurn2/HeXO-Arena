import { z } from 'zod';

// The per-move engine exchange: the htttx stateless v1-alpha schema set,
// in axial q,r coordinates (+q right, +r top-right); x always places first.
export const htttxSideSchema = z.enum([`x`, `o`]);
export type HtttxSide = z.infer<typeof htttxSideSchema>;

export const htttxCoordSchema = z.object({
    q: z.number().int(),
    r: z.number().int(),
});
export type HtttxCoord = z.infer<typeof htttxCoordSchema>;

export const htttxBoardSchema = z.object({
    to_move: htttxSideSchema,
    cells: z.array(
        z.object({
            q: z.number().int(),
            r: z.number().int(),
            p: htttxSideSchema,
        }),
    ),
});
export type HtttxBoard = z.infer<typeof htttxBoardSchema>;

export const htttxMoveRequestSchema = z.object({
    board: htttxBoardSchema,
    time_limit: z.number().min(0).optional(),
    request_id: z.number().int().min(0).optional(),
});
export type HtttxMoveRequest = z.infer<typeof htttxMoveRequestSchema>;
