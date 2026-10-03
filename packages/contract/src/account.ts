import { z } from 'zod';
import { analysisStatusSchema, analyzerValuesSchema } from './analysis';
import { acceptsSchema, botClientSchema } from './api';
import { axialCoordSchema } from './board';
import { gameCellSchema, unratedByChoiceSchema } from './games';
import { levelsSchema, seatLevelSchema } from './levels';
import { nameMaxLength } from './names';
import { duelKindSchema, duelStatusSchema } from './duels';
import { finishReasonSchema, firstPlayerSchema, openingPliesSchema, sideSchema, timeControlSchema, challengeStatusSchema } from './stream';
import { tournamentEntryReasonSchema, tournamentEntryStateSchema } from './tournaments';

/** The signed-in account's data, every row tied to it, as one download. */
export const meExportPath = `/api/me/export`;

/**
 * A deletion names the account's public name as the person typed it, so
 * no stray request or replayed click deletes an account.
 */
export const deleteAccountRequestSchema = z
    .strictObject({ name: z.string().max(nameMaxLength).meta({ description: `The account's public name, exactly as it reads.` }) })
    .meta({ id: `DeleteAccountRequest` });
export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;

// The typed name is not the account's.
export const accountNameMismatchErrorCodes = [`name_mismatch`] as const;

// A person seated in a live game finishes or resigns it first: deleting
// would end it, and ending it unrated would be an escape from a lost position.
export const accountInGameErrorCodes = [`in_live_game`] as const;

const time = z.iso.datetime();

const exportedSeatSchema = z
    .object({
        name: z.string(),
        kind: z.enum([`bot`, `user`, `guest`]),
        yours: z.boolean().meta({ description: `True for the account itself and for its own bots.` }),
        level: seatLevelSchema.optional(),
    })
    .meta({ id: `ExportedSeat` });

const exportedRatingSchema = z.object({ rating: z.number(), deviation: z.number(), volatility: z.number() }).meta({ id: `ExportedRating` });

/**
 * Everything stored about one account: the account and the Discord
 * identity it keeps, its sessions' times and Discord names, its rating,
 * its bots, every game it or its bots played with their moves, its
 * tournament entries, the duels and tests it started, its bots' challenges, and the
 * moderation records naming it or its bots.
 * Never a token, a token's hash, or a sign-in's state.
 */
export const accountExportSchema = z
    .object({
        exportedAt: time,
        account: z.object({
            id: z.string(),
            name: z.string(),
            discordId: z.string(),
            createdAt: time,
            bannedAt: time.nullable(),
            analysisOptOut: z.boolean(),
        }),
        sessions: z.array(
            z.object({
                createdAt: time,
                expiresAt: time,
                discordUsername: z.string().nullable(),
                discordDisplayName: z.string().nullable(),
            }),
        ),
        rating: exportedRatingSchema.nullable().meta({ description: `Null until a rated game.` }),
        bots: z.array(
            z.object({
                id: z.string(),
                name: z.string(),
                createdAt: time,
                about: z.string().nullable(),
                version: z.string().nullable(),
                repoUrl: z.string().nullable(),
                ownerAbout: z.string().nullable().meta({ description: `The owner's text from the website; about and repoUrl are as the bot declared them.` }),
                ownerRepoUrl: z.string().nullable(),
                client: botClientSchema.nullable(),
                accepts: acceptsSchema.nullable(),
                levels: levelsSchema.nullable(),
                analyzer: z.object({ maxSeconds: z.number().int(), lines: z.number().int(), whilePlaying: z.boolean(), values: analyzerValuesSchema }).nullable(),
                delistedAt: time.nullable(),
                deletedAt: time.nullable(),
                rating: exportedRatingSchema.nullable(),
            }),
        ),
        games: z.array(
            z.object({
                id: z.string(),
                players: z.object({ x: exportedSeatSchema, o: exportedSeatSchema }),
                timeControl: timeControlSchema,
                openingPlies: openingPliesSchema,
                opening: z.array(gameCellSchema),
                moves: z.array(z.object({ side: sideSchema, cells: z.array(axialCoordSchema).length(2), at: time })),
                winner: sideSchema.nullable(),
                reason: finishReasonSchema.nullable(),
                createdAt: time,
                finishedAt: time.nullable(),
                voided: z.boolean(),
                unratedByChoice: unratedByChoiceSchema.optional(),
                ratings: z.array(z.object({ side: sideSchema, before: z.number(), after: z.number(), deviationAfter: z.number() })),
            }),
        ),
        tournamentEntries: z.array(
            z.object({
                tournamentId: z.string(),
                tournament: z.string(),
                bot: z.string(),
                state: tournamentEntryStateSchema,
                reason: tournamentEntryReasonSchema.nullable(),
                ratingAtStart: z.number().nullable(),
                enteredAt: time,
            }),
        ),
        duels: z
            .array(
                z.object({
                    id: z.string(),
                    first: z.string(),
                    second: z.string(),
                    games: z.number().int(),
                    kind: duelKindSchema,
                    rated: z.boolean(),
                    status: duelStatusSchema,
                    createdAt: time,
                    endedAt: time.nullable(),
                }),
            )
            .meta({ description: `Duels and tests the account started.` }),
        challenges: z.array(
            z.object({
                id: z.string(),
                challenger: z.string(),
                challenged: z.string(),
                timeControl: timeControlSchema,
                openingPlies: openingPliesSchema,
                firstPlayer: firstPlayerSchema,
                status: challengeStatusSchema,
                gameId: z.string().nullable(),
                createdAt: time,
                decidedAt: time.nullable(),
            }),
        ),
        analyses: z
            .array(z.object({ id: z.string(), gameId: z.string(), status: analysisStatusSchema, requestedAt: time }))
            .meta({ description: `Whole-game readings the account asked for.` }),
        moderation: z.array(z.object({ action: z.string(), target: z.string().nullable(), reason: z.string(), at: time })),
    })
    .meta({
        id: `AccountExport`,
        description: `Every row tied to the account: names of other players read as the site shows them. Never a token, a token's hash, or a sign-in's state.`,
    });
export type AccountExport = z.infer<typeof accountExportSchema>;
