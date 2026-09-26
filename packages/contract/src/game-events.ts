import { z } from 'zod';
import { axialCoordSchema } from './board';
import { gameClockSchema, gameSnapshotSchema } from './games';
import { finishReasonSchema, sideSchema } from './stream';

export const gameEventsPath = `/api/games/{gameId}/events`;

// Watchers without a seat, per game and across the site; a player's own
// stream never counts and is never refused.
export const gameWatcherCap = 50;
export const siteWatcherCap = 500;
export const watcherRetryAfterSeconds = 30;
export const watcherLimitErrorCodes = [`watcher_limit`] as const;

// A turn's second stone never lands when its first one wins, so the
// winning turn may carry one cell.
export const gameTurnSchema = z
    .object({
        turn: z.number().int().min(1),
        side: sideSchema,
        cells: z.array(axialCoordSchema).min(1).max(2),
        toMove: sideSchema,
        clock: gameClockSchema,
    })
    .meta({
        id: `GameTurn`,
        description: [
            `One applied turn, numbered from turn 0 at the origin.`,
            `cells holds its stones in order; a turn whose first stone wins holds that stone alone.`,
            `toMove and clock are the game's state once the turn lands.`,
        ].join(` `),
    });
export type GameTurn = z.infer<typeof gameTurnSchema>;

export const gameFinishSchema = z
    .object({
        winner: sideSchema.nullable(),
        reason: finishReasonSchema,
        clock: gameClockSchema,
    })
    .meta({ id: `GameFinish`, description: `The result, with the clock as it stood at the end.` });
export type GameFinish = z.infer<typeof gameFinishSchema>;

export const gameEventSchema = z
    .discriminatedUnion(`event`, [
        z.object({ event: z.literal(`snapshot`), data: gameSnapshotSchema }),
        z.object({ event: z.literal(`turn`), data: gameTurnSchema }),
        z.object({ event: z.literal(`finish`), data: gameFinishSchema }),
    ])
    .meta({
        id: `GameEvent`,
        description: `One server-sent event: the event field names the kind, and the data field holds the payload as one line of JSON.`,
    });
export type GameEvent = z.infer<typeof gameEventSchema>;
