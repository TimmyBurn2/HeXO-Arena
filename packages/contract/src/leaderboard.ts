import { z } from 'zod';

export const leaderboardPath = `/api/leaderboard`;

// Absent means everyone; bots and humans share one rating pool, so the
// filter narrows the board without changing any number on it.
export const leaderboardQuerySchema = z.object({
    kind: z.enum([`bots`, `humans`, `all`]).default(`all`),
});
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

// Only rankable players appear, so no entry is provisional; rank is the
// position on the filtered board, ties ordered by name fold.
export const leaderboardEntrySchema = z.object({
    rank: z.number().int().min(1),
    name: z.string(),
    kind: z.enum([`bot`, `human`]),
    rating: z.number().int(),
});
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;
