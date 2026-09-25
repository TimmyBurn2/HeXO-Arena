import { z } from 'zod';

// Axial hex coordinates; integers, unbounded, first stone at the origin.
// Shared with the web for board rendering.
export const axialCoordSchema = z.object({
    x: z.number().int(),
    y: z.number().int(),
});
export type AxialCoord = z.infer<typeof axialCoordSchema>;

// The two seat colors; player 0 always places the opening stone.
export const playerColorSchema = z.union([z.literal(0), z.literal(1)]);
export type PlayerColor = z.infer<typeof playerColorSchema>;

export const boardCellSchema = axialCoordSchema.extend({
    player: playerColorSchema,
});
export type BoardCell = z.infer<typeof boardCellSchema>;

// A full position on the wire: stones only, everything else is derived.
export const boardSnapshotSchema = z.object({
    cells: z.array(boardCellSchema),
});
export type BoardSnapshot = z.infer<typeof boardSnapshotSchema>;

// A win is reported as exactly six cells: the window through the last
// placed stone, clamped to the run.
export const winLineSchema = z.object({
    player: playerColorSchema,
    cells: z.array(axialCoordSchema).length(6),
});
export type WinLine = z.infer<typeof winLineSchema>;
