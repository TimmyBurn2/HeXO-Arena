import { z } from 'zod';
import { gamePlayersSchema } from './games';
import { rankableDeviation } from './leaderboard';
import { nameKeyOf, nameMaxLength } from './names';
import { finishReasonSchema, openingPliesSchema, sideSchema, timeControlSchema } from './stream';

export const finishedGamesPath = `/api/games/finished`;

/** Finished games one page holds, newest first. */
export const finishedGamesPageSize = 20;

/** Pages one filter set reaches; older games are a `before` date away. */
export const finishedGamesPageCap = 10;

// Every reader of the same query within this window gets the one body
// serialized for it.
export const finishedGamesMemoMs = 5_000;

// A page number from 1 to the cap, written without a leading zero, so
// every spelling of one page is one query.
const pagePattern = /^(?:[1-9]|10)$/;

const playerName = z.string().min(1).max(nameMaxLength);

export const finishedGamesQuerySchema = z
    .strictObject({
        player: playerName.optional().meta({ param: { description: `A player's name, matched case-folded, in either seat.` } }),
        vs: playerName.optional().meta({ param: { description: `The opponent's name; needs player.` } }),
        kind: z
            .enum([`bot-bot`, `human-bot`, `guest-bot`])
            .optional()
            .meta({ param: { description: `Who sat: two bots, a signed-in human and a bot, or a guest and a bot.` } }),
        result: z
            .enum([`won`, `lost`, `none`])
            .optional()
            .meta({ param: { description: `won and lost are the player's results and need player; none is a game without a winner.` } }),
        side: sideSchema.optional().meta({ param: { description: `The player's side; needs player.` } }),
        // The bare values, so the parameter does not repeat the component's description.
        reason: z.enum(finishReasonSchema.options).optional().meta({ param: { description: `How the game ended.` } }),
        clock: z.enum([`turn`, `match`, `unlimited`]).optional().meta({ param: { description: `The time control's mode.` } }),
        opening: z.enum([`1`, `3`, `5`, `7`, `9`]).optional().meta({ param: { description: `The opening's plies.` } }),
        before: z.iso.date().optional().meta({ param: { description: `Only games finished before this UTC date, YYYY-MM-DD.` } }),
        page: z
            .string()
            .regex(pagePattern)
            .optional()
            .meta({ param: { description: `The page, from 1 to ${String(finishedGamesPageCap)}; the first when absent.` } }),
    })
    .refine((query) => query.player !== undefined || (query.vs === undefined && query.side === undefined && query.result !== `won` && query.result !== `lost`), {
        message: `vs, side, won, and lost need player`,
    })
    .refine((query) => query.player === undefined || query.vs === undefined || nameKeyOf(query.player) !== nameKeyOf(query.vs), {
        message: `vs names a player other than player`,
    });
export type FinishedGamesQuery = z.infer<typeof finishedGamesQuerySchema>;

export const finishedGameEntrySchema = z
    .object({
        gameId: z.string(),
        players: gamePlayersSchema,
        winner: sideSchema.nullable(),
        reason: finishReasonSchema,
        timeControl: timeControlSchema,
        openingPlies: openingPliesSchema,
        turns: z.number().int().min(0).meta({ description: `Turns on the board at the finish, the opening's included.` }),
        finishedAt: z.iso.datetime(),
        rated: z.boolean().meta({ description: `False for a game without a winner, a voided one, and a guest's.` }),
        voided: z.boolean().meta({ description: `Taken out by the operator: still listed, and counted in no record and no rating.` }),
    })
    .meta({
        id: `FinishedGameEntry`,
        description: [
            `A finished game as the history lists it.`,
            `Each seat's rating is the one it stood at before this result, and provisional says whether its deviation was above ${String(rankableDeviation)} after it.`,
        ].join(` `),
    });
export type FinishedGameEntry = z.infer<typeof finishedGameEntrySchema>;

const countSchema = z.number().int().min(0);

const sideRecordSchema = z.object({ games: countSchema, won: countSchema, lost: countSchema });

export const finishedGamesRecordSchema = z
    .object({
        games: countSchema,
        won: countSchema,
        lost: countSchema,
        undecided: countSchema.meta({ description: `Games that ended without a winner.` }),
        voided: countSchema.meta({ description: `Voided games the filters select, which no other count holds.` }),
        asX: sideRecordSchema,
        asO: sideRecordSchema,
    })
    .meta({
        id: `FinishedGamesRecord`,
        description: `The named player's record over every game the filters select but voided ones, past the page cap: wins, losses, and games without a winner, in all and by side; and how many voided games it leaves out.`,
    });
export type FinishedGamesRecord = z.infer<typeof finishedGamesRecordSchema>;

export const finishedGamesPageSchema = z
    .object({
        games: z.array(finishedGameEntrySchema).max(finishedGamesPageSize),
        page: z.number().int().min(1).max(finishedGamesPageCap),
        pages: z
            .number()
            .int()
            .min(0)
            .max(finishedGamesPageCap)
            .meta({ description: `The pages the filters reach, at most ${String(finishedGamesPageCap)}; 0 when no game matches.` }),
        total: countSchema.meta({ description: `Every game the filters select, past the page cap, voided ones included.` }),
        record: finishedGamesRecordSchema.optional().meta({ description: `Present when the query names a player.` }),
    })
    .meta({ id: `FinishedGamesPage`, description: `A page past the last one the filters reach lists no game.` });
export type FinishedGamesPage = z.infer<typeof finishedGamesPageSchema>;
