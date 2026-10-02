import { z } from 'zod';

// The per-move engine exchange: the htttx stateless v1-alpha schema set,
// in axial q,r coordinates (+q right, +r top-right); x always places first.
// Field names, optionality, and bounds follow the vendored spec verbatim;
// converting to the engine's x,y is the server's job.
export const htttxSideSchema = z.enum([`x`, `o`]);
export type HtttxSide = z.infer<typeof htttxSideSchema>;

export const htttxCoordSchema = z.object({
    q: z.number().int(),
    r: z.number().int(),
});
export type HtttxCoord = z.infer<typeof htttxCoordSchema>;

export const htttxCellSchema = z.object({
    q: z.number().int(),
    r: z.number().int(),
    p: htttxSideSchema,
});
export type HtttxCell = z.infer<typeof htttxCellSchema>;

export const htttxBoardSchema = z
    .object({
        to_move: htttxSideSchema,
        cells: z.array(htttxCellSchema),
    })
    .meta({ id: `Board` });
export type HtttxBoard = z.infer<typeof htttxBoardSchema>;

// Seconds, not milliseconds; a fraction is honest and needs no rounding
// policy. Absent when the clock mode is unlimited.
export const htttxTimeLimitSchema = z.number().min(0);

export const htttxMoveRequestSchema = z
    .object({
        board: htttxBoardSchema,
        time_limit: htttxTimeLimitSchema.optional(),
        request_id: z.number().int().min(0).optional(),
    })
    .meta({ id: `MoveRequest` });
export type HtttxMoveRequest = z.infer<typeof htttxMoveRequestSchema>;

export const htttxPositionEvaluationSchema = z.object({
    heuristic: z.number().optional(),
    win_in: z.number().int().optional(),
});
export type HtttxPositionEvaluation = z.infer<typeof htttxPositionEvaluationSchema>;

// A chosen move is exactly two placements; the platform judges legality
// against the board, the turn, and the outstanding request.
export const htttxMoveOptionSchema = z.object({
    pieces: z.array(htttxCoordSchema).length(2),
    evaluation: htttxPositionEvaluationSchema.optional(),
});
export type HtttxMoveOption = z.infer<typeof htttxMoveOptionSchema>;

export const htttxMoveResponseSchema = z.object({
    move: htttxMoveOptionSchema,
    considerations: z.array(htttxMoveOptionSchema).optional(),
    request_id: z.number().int().min(0).optional(),
});
export type HtttxMoveResponse = z.infer<typeof htttxMoveResponseSchema>;

// The basic_websocket v1-alpha packets, same axial q,r. The server plays the
// htttx client role and the bot the bot role, fixed by packet direction.
// The setup board carries stones only; whose move it is travels on the
// move_request packet.
export const htttxPlayedMoveSchema = z.object({
    side: htttxSideSchema,
    pieces: z.array(htttxCoordSchema).length(2),
});
export type HtttxPlayedMove = z.infer<typeof htttxPlayedMoveSchema>;

export const bwsHeartbeatPacketSchema = z.object({
    type: z.literal(`heartbeat`),
    waiting: z.boolean(),
});
export type BwsHeartbeatPacket = z.infer<typeof bwsHeartbeatPacketSchema>;

export const bwsSetupPacketSchema = z.object({
    type: z.literal(`setup`),
    board: z.object({ cells: z.array(htttxCellSchema) }),
});
export type BwsSetupPacket = z.infer<typeof bwsSetupPacketSchema>;

export const bwsMoveRequestPacketSchema = z.object({
    type: z.literal(`move_request`),
    side: htttxSideSchema,
    previous: z.array(htttxPlayedMoveSchema),
    move_time_limit: htttxTimeLimitSchema.optional(),
    request_id: z.number().int().min(0).optional(),
});
export type BwsMoveRequestPacket = z.infer<typeof bwsMoveRequestPacketSchema>;

// The only packet a bot may send on our engine sessions: evaluations are
// never requested, so eval_response is not part of the accepted inbound set.
export const bwsMoveResponsePacketSchema = z.object({
    type: z.literal(`move_response`),
    move: htttxMoveOptionSchema,
    considerations: z.array(htttxMoveOptionSchema).optional(),
    request_id: z.number().int().min(0).optional(),
});
export type BwsMoveResponsePacket = z.infer<typeof bwsMoveResponsePacketSchema>;
