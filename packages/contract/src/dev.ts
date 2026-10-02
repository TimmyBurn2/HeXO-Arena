import { z } from 'zod';
import { provisionalSchema, ratingSchema } from './leaderboard';

// Development only: the server registers these routes only under DEV_LOGIN,
// and the generated document never names them.

export const devAccountsPath = `/api/dev/accounts`;

/** The accounts `pnpm dev:seed` builds, each with the state it is there to show. */
export const devPersonas = [
    { name: `ana`, purpose: `At the bot cap: hextide, pebble, lantern, cinder, and tarn` },
    { name: `bruno`, purpose: `About 10 rated games, no bots` },
    { name: `cleo`, purpose: `Brand new, nothing played` },
    { name: `dmitri`, purpose: `1 provisional bot, quietlake` },
    { name: `eve`, purpose: `Banned after 2 games` },
] as const;

export const devAccountBotSchema = z.object({
    name: z.string(),
    rating: ratingSchema,
    provisional: provisionalSchema,
    // Finished games against other bots, which the seed tops up to its plan.
    vsBots: z.number().int().min(0),
});
export type DevAccountBot = z.infer<typeof devAccountBotSchema>;

// A seeded persona as it stands now; `games` counts its finished games as a
// human, whatever their result.
export const devAccountSchema = z.object({
    name: z.string(),
    purpose: z.string(),
    rating: ratingSchema,
    provisional: provisionalSchema,
    banned: z.boolean(),
    games: z.number().int().min(0),
    bots: z.array(devAccountBotSchema),
});
export type DevAccount = z.infer<typeof devAccountSchema>;
