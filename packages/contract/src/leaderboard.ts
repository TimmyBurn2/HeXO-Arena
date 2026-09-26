import { z } from 'zod';

export const leaderboardPath = `/api/leaderboard`;

// A player ranks once the rating deviation is at or below this, and is
// provisional above it.
export const rankableDeviation = 75;

// Named, so every rating in the document points at one definition.
export const ratingSchema = z
    .number()
    .int()
    .meta({ id: `Rating`, description: `The Glicko-2 rating, rounded to a whole point.` });

export const provisionalSchema = z.boolean().meta({
    id: `Provisional`,
    description: `True while the rating deviation is above ${String(rankableDeviation)}.`,
});

// Absent means everyone; bots and humans share one rating pool, so the
// filter narrows the board without changing any number on it.
export const leaderboardQuerySchema = z.object({
    kind: z.enum([`bots`, `humans`, `all`]).default(`all`),
});
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

// Only rankable players appear, so no entry is provisional.
export const leaderboardEntrySchema = z
    .object({
        rank: z.number().int().min(1).meta({ description: `The position on the filtered board.` }),
        name: z.string(),
        kind: z.enum([`bot`, `human`]),
        rating: ratingSchema,
    })
    .meta({ id: `LeaderboardEntry` });
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;
