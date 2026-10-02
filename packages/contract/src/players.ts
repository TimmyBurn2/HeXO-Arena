import { z } from 'zod';
import { provisionalSchema, ratingSchema } from './leaderboard';
import { pageTitle, siteName, type PageMeta } from './meta';

export const playerPath = `/api/players/{name}`;
export const ratingHistoryPath = `/api/players/{name}/rating`;

/** Rated games a rating history holds at most, the newest. */
export const ratingHistoryCap = 500;

/** The opponents a record names, most played first. */
export const playerOpponentsCap = 5;

/** The finished tournaments a bot's record names, newest first. */
export const playerPlacingsCap = 10;

// Every reader of one player's record or history within this window gets
// the one body serialized for it.
export const playerRecordMemoMs = 5_000;

export const ratingRangeSchema = z.enum([`30d`, `1y`, `all`]);
export type RatingRange = z.infer<typeof ratingRangeSchema>;

export const ratingHistoryQuerySchema = z.strictObject({
    range: ratingRangeSchema.default(`1y`).meta({ param: { description: `How far back: 30 days, a year, or all; a year when absent.` } }),
});

const count = z.number().int().min(0);
const time = z.iso.datetime();

export const playerRecordSchema = z
    .object({
        name: z.string(),
        kind: z.enum([`bot`, `human`]),
        rating: ratingSchema,
        provisional: provisionalSchema,
        rank: z.number().int().min(1).nullable().meta({ description: `The place on the ladder of the last 30 days, or null off it.` }),
        games: count,
        won: count,
        lost: count,
        undecided: count.meta({ description: `Games that reached a cap with no winner.` }),
        asX: z.object({ games: count, won: count }),
        asO: z.object({ games: count, won: count }),
        forfeits: z
            .object({ disconnect: count, terminated: count })
            .meta({ description: `Games lost by a stream that stayed closed, and by an illegal move.` }),
        opponents: z
            .array(z.object({ name: z.string(), kind: z.enum([`bot`, `human`]), games: count, won: count, lost: count }))
            .max(playerOpponentsCap)
            .meta({ description: `The opponents met most, with the player's wins and losses against each.` }),
        firstGameAt: time.nullable(),
        lastGameAt: time.nullable(),
        placings: z
            .array(z.object({ tournamentId: z.string(), name: z.string(), rank: z.number().int().min(1), entrants: count, points: count, endedAt: time }))
            .max(playerPlacingsCap)
            .optional()
            .meta({ description: `A bot's finished tournaments, newest first, with its place in each.` }),
    })
    .meta({ id: `PlayerRecord`, description: `Every finished game the player sat in counts, aborted and voided games aside.` });
export type PlayerRecord = z.infer<typeof playerRecordSchema>;

export const ratingPointSchema = z
    .object({
        gameId: z.string(),
        at: time,
        rating: ratingSchema,
        deviation: count,
        provisional: provisionalSchema,
    })
    .meta({ id: `RatingPoint`, description: `The rating and its deviation after one rated game.` });
export type RatingPoint = z.infer<typeof ratingPointSchema>;

export const ratingHistorySchema = z.array(ratingPointSchema).max(ratingHistoryCap).meta({ id: `RatingHistory`, description: `Oldest first.` });

/** A human player's page meta, from the record when it is known. */
export function playerMeta(name: string, record?: PlayerRecord): PageMeta {
    if (record === undefined) return { title: pageTitle(name), description: `A player on ${siteName}` };
    const rating = `${String(record.rating)}${record.provisional ? ` (provisional)` : ``}`;
    const games = `${String(record.games)} ${record.games === 1 ? `game` : `games`}`;
    return { title: pageTitle(name), description: `HeXO player, rated ${rating}; ${games}, ${String(record.won)} won` };
}
