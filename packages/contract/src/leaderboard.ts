import { z } from 'zod';

export const leaderboardPath = `/api/leaderboard`;

// A player ranks once the rating deviation is at or below this, and is
// provisional above it.
export const rankableDeviation = 75;

/** The rating a human starts at, before any rated game. */
export const humanSeedRating = 1000;

// Named, so every rating in the document points at one definition.
export const ratingSchema = z
    .number()
    .int()
    .meta({ id: `Rating`, description: `The Glicko-2 rating, rounded to a whole point.` });

export const provisionalSchema = z.boolean().meta({
    id: `Provisional`,
    description: `True while the rating deviation is above ${String(rankableDeviation)}.`,
});

/** The days within which a player's latest rated game keeps them on the default board. */
export const leaderboardActiveDays = 30;

/** The most entries one board lists. */
export const leaderboardCap = 500;

// Absent means everyone, active in the last 30 days; bots and humans share
// one rating pool, so either filter narrows the board without changing any
// number on it.
export const leaderboardQuerySchema = z.object({
    kind: z.enum([`bots`, `humans`, `all`]).default(`all`),
    active: z.enum([`30d`, `all`]).default(`30d`),
});
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

// Only rankable players appear, so no entry is provisional.
const entryFields = {
    rank: z.number().int().min(1),
    name: z.string(),
    rating: ratingSchema,
    games: z.number().int().min(1),
    lastPlayedAt: z.iso.datetime(),
};

export const leaderboardBotSchema = z
    .object({ ...entryFields, kind: z.literal(`bot`), ownerName: z.string().nullable(), online: z.boolean() })
    .meta({ id: `LeaderboardBot`, description: `A bot carries its owner and presence as the bot list has them.` });

export const leaderboardHumanSchema = z.object({ ...entryFields, kind: z.literal(`human`) }).meta({ id: `LeaderboardHuman` });

export const leaderboardEntrySchema = z.discriminatedUnion(`kind`, [leaderboardBotSchema, leaderboardHumanSchema]).meta({
    id: `LeaderboardEntry`,
    description: `rank is the position on the filtered board, games the rated games the player has played, and lastPlayedAt when the latest of them finished.`,
});
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

export const leaderboardSchema = z.array(leaderboardEntrySchema).max(leaderboardCap);
