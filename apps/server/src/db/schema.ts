import { check, foreignKey, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql, type SQL } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import {
    analysisFailureSchema,
    analysisHeuristicLimit,
    analysisLinesMax,
    analysisStatusSchema,
    analysisWinInLimit,
    analyzerMaxSecondsCap,
    botAboutMaxLength,
    botRepoUrlMaxLength,
    botVersionMaxLength,
    challengeStatusSchema,
    discordNameMaxLength,
    duelCutReasons,
    finishReasonSchema,
    firstPlayerSchema,
    nextPathMaxLength,
    sideSchema,
    tournamentBotGamesMax,
    tournamentBotsMax,
    tournamentBotsMin,
    tournamentCutReasons,
    tournamentGameCounts,
    tournamentLegsMax,
    tournamentLiveCap,
    tournamentStopReasons,
    tournamentTestGameCounts,
    requestBodyLimitBytes,
    reportDetailsMaxLength,
    reportEmailMaxLength,
    reportNameMaxLength,
    reportReasons,
    reportSubjectMaxLength,
    signupAttemptCap,
    tournamentOriginSchema,
    tournamentEndReasonSchema,
    tournamentStatusSchema,
    valueCutMax,
} from '@hexo-arena/contract';

// An enum column's values, from the contract schema whose type its reads
// take; the column's check, not this list, holds what is stored.
function valuesOf<T extends string>(schema: { readonly options: readonly T[] }): [T, ...T[]] {
    const [first, ...rest] = schema.options;
    if (first === undefined) throw new Error(`an enum column takes one value at least`);
    return [first, ...rest];
}

const sides = valuesOf(sideSchema);

// One global namespace shared by users and bots: a SQLite unique index
// cannot span two tables, so the fold key is reserved here first and both
// tables reference it.
export const nameReservations = sqliteTable(`name_reservations`, {
    nameKey: text(`name_key`).primaryKey(),
});

export const users = sqliteTable(
    `users`,
    {
        id: text(`id`).primaryKey(),
        discordId: text(`discord_id`).notNull().unique(),
        name: text(`name`).notNull(),
        nameKey: text(`name_key`)
            .notNull()
            .unique()
            .references(() => nameReservations.nameKey),
        bannedAt: integer(`banned_at`),
        // Set when the user is forgotten but their games are kept: the row then
        // carries a deleted-<n> placeholder name and no Discord identity.
        deletedAt: integer(`deleted_at`),
        createdAt: integer(`created_at`).notNull(),
        // 1 keeps every game the user played out of public analysis.
        analysisOptOut: integer(`analysis_opt_out`).notNull().default(0),
    },
    (table) => [check(`users_analysis_opt_out_check`, sql`${table.analysisOptOut} in (0, 1)`)],
);

// Bounds from the contract, written into the checks as literals.
const nameMax = sql.raw(String(discordNameMaxLength));
const nextMax = sql.raw(String(nextPathMaxLength));

// The Discord names ride on the session, not the user: they are shown to
// the person alone, refreshed by each sign-in, and gone with the session.
export const sessions = sqliteTable(
    `sessions`,
    {
        id: text(`id`).primaryKey(),
        tokenHash: text(`token_hash`).notNull().unique(),
        userId: text(`user_id`)
            .notNull()
            .references(() => users.id, { onDelete: `cascade` }),
        createdAt: integer(`created_at`).notNull(),
        expiresAt: integer(`expires_at`).notNull(),
        discordUsername: text(`discord_username`),
        discordDisplayName: text(`discord_display_name`),
    },
    (table) => [
        index(`sessions_user_id_idx`).on(table.userId),
        check(
            `sessions_discord_username_check`,
            sql`${table.discordUsername} is null or length(${table.discordUsername}) between 1 and ${nameMax}`,
        ),
        check(
            `sessions_discord_display_name_check`,
            sql`${table.discordDisplayName} is null or (${table.discordUsername} is not null and length(${table.discordDisplayName}) between 1 and ${nameMax})`,
        ),
    ],
);

// Single-use CSRF binding for the OAuth redirect; state and nonce travel
// as one parameter because Discord echoes only state, and the row keeps
// the path the sign-in returns to.
export const authStates = sqliteTable(
    `auth_states`,
    {
        state: text(`state`).primaryKey(),
        nonce: text(`nonce`).notNull(),
        expiresAt: integer(`expires_at`).notNull(),
        next: text(`next`).notNull().default(`/`),
    },
    (table) => [check(`auth_states_next_check`, sql`length(${table.next}) between 1 and ${nextMax} and substr(${table.next}, 1, 1) = '/'`)],
);

// A first sign-in waiting for its public name: the Discord account and the
// return path, behind the hash of the signup cookie, until the account is
// created, the sign-up is dropped, or it expires. One per Discord account,
// so a newer sign-in replaces an older one.
export const pendingSignups = sqliteTable(
    `pending_signups`,
    {
        tokenHash: text(`token_hash`).primaryKey(),
        discordId: text(`discord_id`).notNull().unique(),
        discordUsername: text(`discord_username`).notNull(),
        discordDisplayName: text(`discord_display_name`),
        next: text(`next`).notNull(),
        attempts: integer(`attempts`).notNull().default(0),
        expiresAt: integer(`expires_at`).notNull(),
    },
    (table) => [
        check(`pending_signups_discord_id_check`, sql`length(${table.discordId}) between 1 and 64`),
        check(`pending_signups_discord_username_check`, sql`length(${table.discordUsername}) between 1 and ${nameMax}`),
        check(
            `pending_signups_discord_display_name_check`,
            sql`${table.discordDisplayName} is null or length(${table.discordDisplayName}) between 1 and ${nameMax}`,
        ),
        check(`pending_signups_next_check`, sql`length(${table.next}) between 1 and ${nextMax} and substr(${table.next}, 1, 1) = '/'`),
        check(`pending_signups_attempts_check`, sql`${table.attempts} between 0 and ${sql.raw(String(signupAttemptCap))}`),
    ],
);

const analyzerSecondsMax = sql.raw(String(analyzerMaxSecondsCap));
const linesMax = sql.raw(String(analysisLinesMax));
const winInMax = sql.raw(String(analysisWinInLimit));
const heuristicMax = sql.raw(String(analysisHeuristicLimit));

const cutMax = sql.raw(String(valueCutMax));

// How an analyzer declared its heuristic reads: a scale and a meaning, set
// together and null where it declared none, and three cuts set together,
// rising, only beside a scale; a row with a `holder` sets a scale only beside it.
const valuesChecks = (
    name: string,
    table: { scale: AnySQLiteColumn; inaccuracy: AnySQLiteColumn; mistake: AnySQLiteColumn; blunder: AnySQLiteColumn; meaning: AnySQLiteColumn },
    holder?: AnySQLiteColumn,
) => [
    check(`${name}_meaning_check`, sql`(${table.meaning} is null) = (${table.scale} is null) and coalesce(${table.meaning}, 'raw') in ('expected', 'raw')`),
    check(
        `${name}_scale_check`,
        holder === undefined
            ? sql`${table.scale} is null or (${table.scale} > 0 and ${table.scale} <= ${heuristicMax})`
            : sql`${table.scale} is null or (${holder} is not null and ${table.scale} > 0 and ${table.scale} <= ${heuristicMax})`,
    ),
    check(
        `${name}_cuts_check`,
        sql`(${table.inaccuracy} is null) = (${table.mistake} is null) and (${table.mistake} is null) = (${table.blunder} is null) and (${table.blunder} is null or (${table.scale} is not null and ${table.inaccuracy} > 0 and ${table.inaccuracy} < ${table.mistake} and ${table.mistake} < ${table.blunder} and ${table.blunder} <= ${cutMax}))`,
    ),
];

// A line read at a position: two cells and the evaluation of the board after them, one value at least.
const lineChecks = (name: string, table: { heuristic: AnySQLiteColumn; winIn: AnySQLiteColumn; rank: AnySQLiteColumn }) => [
    check(`${name}_rank_check`, sql`${table.rank} between 0 and ${sql.raw(String(analysisLinesMax - 1))}`),
    check(`${name}_value_check`, sql`${table.heuristic} is not null or ${table.winIn} is not null`),
    check(`${name}_heuristic_check`, sql`${table.heuristic} is null or abs(${table.heuristic}) <= ${heuristicMax}`),
    check(`${name}_win_in_check`, sql`${table.winIn} is null or (${table.winIn} <> 0 and abs(${table.winIn}) <= ${winInMax})`),
];

// A stored level is a json object, held to a bound: a declaration's levels
// never outgrow the body that carried them, and a game seat keeps one
// level without its about, well under a kilobyte.
const levelsMax = sql.raw(String(requestBodyLimitBytes));
const seatLevelMax = sql.raw(`1024`);
const jsonObject = (column: AnySQLiteColumn, max: SQL) =>
    sql`${column} is null or (json_valid(${column}) and substr(${column}, 1, 1) = '{' and length(${column}) <= ${max})`;

// The scope column exists from day one so adding scopes later is not a
// breaking change; v0 mints `bot:play` only.
// The declaration columns are bot-written only (PATCH /api/bot/account);
// null means never declared, and an empty string clears back to null.
export const bots = sqliteTable(
    `bots`,
    {
        id: text(`id`).primaryKey(),
        ownerId: text(`owner_id`)
            .notNull()
            .references(() => users.id, { onDelete: `cascade` }),
        name: text(`name`).notNull(),
        nameKey: text(`name_key`)
            .notNull()
            .unique()
            .references(() => nameReservations.nameKey),
        tokenHash: text(`token_hash`).notNull().unique(),
        scope: text(`scope`).notNull(),
        createdAt: integer(`created_at`).notNull(),
        about: text(`about`),
        version: text(`version`),
        repoUrl: text(`repo_url`),
        accepts: text(`accepts`),
        levels: text(`levels`),
        // The analyzer the bot declared, all three set or all three null,
        // and how its heuristic reads, set only beside them.
        analyzerMaxSeconds: integer(`analyzer_max_seconds`),
        analyzerLines: integer(`analyzer_lines`),
        analyzerWhilePlaying: integer(`analyzer_while_playing`),
        analyzerScale: real(`analyzer_scale`),
        analyzerCutInaccuracy: real(`analyzer_cut_inaccuracy`),
        analyzerCutMistake: real(`analyzer_cut_mistake`),
        analyzerCutBlunder: real(`analyzer_cut_blunder`),
        analyzerMeaning: text(`analyzer_meaning`),
        delistedAt: integer(`delisted_at`),
        // Set when a bot with rated games is deleted: the row stays so the
        // game log stays whole, under a deleted-<n> placeholder name.
        deletedAt: integer(`deleted_at`),
        // The owner's switch, on the site alone: 0 keeps the duels and round
        // robins this bot plays to those its owner sets up.
        duelsByOthers: integer(`duels_by_others`).notNull().default(1),
        // The owner's text and source link, set on the site, each shown in
        // place of what the bot declares.
        ownerAbout: text(`owner_about`),
        ownerRepoUrl: text(`owner_repo_url`),
        // The client the bot's stream last opened with, read from its
        // User-Agent, and when: hexo-bridge with its release, or other.
        // The header itself is never kept.
        clientKind: text(`client_kind`),
        clientVersion: text(`client_version`),
        clientAt: integer(`client_at`),
    },
    (table) => [
        index(`bots_owner_id_idx`).on(table.ownerId),
        // A tournament entry names the bot with its owner, held to this pair.
        uniqueIndex(`bots_id_owner_idx`).on(table.id, table.ownerId),
        check(`bots_scope_check`, sql`${table.scope} in ('bot:play')`),
        check(`bots_duels_by_others_check`, sql`${table.duelsByOthers} in (0, 1)`),
        check(`bots_owner_about_check`, sql`${table.ownerAbout} is null or length(${table.ownerAbout}) between 1 and ${sql.raw(String(botAboutMaxLength))}`),
        check(
            `bots_owner_repo_url_check`,
            sql`${table.ownerRepoUrl} is null or (length(${table.ownerRepoUrl}) <= ${sql.raw(String(botRepoUrlMaxLength))} and (lower(substr(${table.ownerRepoUrl}, 1, 7)) = 'http://' or lower(substr(${table.ownerRepoUrl}, 1, 8)) = 'https://'))`,
        ),
        // Three dot-separated runs of digits, as a hexo-bridge release reads.
        check(
            `bots_client_version_check`,
            sql`${table.clientVersion} is null or (length(${table.clientVersion}) <= 14 and ${table.clientVersion} glob '[0-9]*.[0-9]*.[0-9]*' and ${table.clientVersion} glob '*[0-9]' and ${table.clientVersion} not glob '*[^0-9.]*' and ${table.clientVersion} not glob '*..*' and ${table.clientVersion} not glob '*.*.*.*')`,
        ),
        check(
            `bots_client_check`,
            sql`(${table.clientKind} is null or ${table.clientKind} in ('hexo-bridge', 'other')) and (${table.clientKind} is null) = (${table.clientAt} is null) and (coalesce(${table.clientKind}, '') = 'hexo-bridge') = (${table.clientVersion} is not null)`,
        ),
        check(`bots_levels_check`, jsonObject(table.levels, levelsMax)),
        check(`bots_analyzer_max_seconds_check`, sql`${table.analyzerMaxSeconds} is null or ${table.analyzerMaxSeconds} between 1 and ${analyzerSecondsMax}`),
        check(`bots_analyzer_lines_check`, sql`${table.analyzerLines} is null or ${table.analyzerLines} between 1 and ${linesMax}`),
        check(
            `bots_analyzer_check`,
            sql`(${table.analyzerWhilePlaying} is null or ${table.analyzerWhilePlaying} in (0, 1)) and (${table.analyzerMaxSeconds} is null) = (${table.analyzerLines} is null) and (${table.analyzerLines} is null) = (${table.analyzerWhilePlaying} is null)`,
        ),
        ...valuesChecks(
            `bots_analyzer`,
            { scale: table.analyzerScale, inaccuracy: table.analyzerCutInaccuracy, mistake: table.analyzerCutMistake, blunder: table.analyzerCutBlunder, meaning: table.analyzerMeaning },
            table.analyzerLines,
        ),
    ],
);

// The opening position including the origin stone is placed at creation
// and cannot be derived, so it lives here as json; the two-placement turns
// the players made live in moves. A game is in progress exactly while
// finished_at is null; finish_seq numbers finishes in the order they
// happened, which finished_at cannot, since two games share a second.
// A game seats two players in one row: a human game
// sets the human's id, the facing bot, and the human's side; a guest game
// sets the guest's random label in place of the id, and nothing else of
// the guest; a bot-vs-bot game sets the challenger, the challenged bot,
// and the challenger's side.
// The seats constraint pins exactly one of the three groups.
// A bot seat played at a level other than its bot's default keeps that
// level as declared at creation, by side; no person's seat has one.
// unrated_by_choice is 1 on a game carrying the unrated mark, as the
// contract's unratedByChoiceSchema defines it.
// test is 1 on a game one person holds on both sides, as it began: their
// own bot against them, or two of their bots; such a game is never rated.
export const games = sqliteTable(
    `games`,
    {
        id: text(`id`).primaryKey(),
        userId: text(`user_id`).references(() => users.id, { onDelete: `cascade` }),
        botId: text(`bot_id`).references(() => bots.id, { onDelete: `cascade` }),
        userSide: text(`user_side`, { enum: sides }),
        guestName: text(`guest_name`),
        challengerBotId: text(`challenger_bot_id`).references(() => bots.id, {
            onDelete: `cascade`,
        }),
        destBotId: text(`dest_bot_id`).references(() => bots.id, { onDelete: `cascade` }),
        challengerSide: text(`challenger_side`, { enum: sides }),
        xLevel: text(`x_level`),
        oLevel: text(`o_level`),
        unratedByChoice: integer(`unrated_by_choice`).notNull().default(0),
        test: integer(`test`).notNull().default(0),
        timeControl: text(`time_control`).notNull(),
        openingCells: text(`opening_cells`).notNull(),
        winner: text(`winner`, { enum: sides }),
        finishReason: text(`finish_reason`, { enum: valuesOf(finishReasonSchema) }),
        createdAt: integer(`created_at`).notNull(),
        finishedAt: integer(`finished_at`),
        finishSeq: integer(`finish_seq`),
        // A voided game stays in the log but never counts toward a rating.
        voidedAt: integer(`voided_at`),
        // A tournament game names its pairing and which of the pairing's two
        // games it is; a game the drain cut replays under the same pair.
        pairingId: text(`pairing_id`).references((): AnySQLiteColumn => tournamentPairings.id, { onDelete: `cascade` }),
        pairingGame: integer(`pairing_game`),
    },
    (table) => [
        uniqueIndex(`games_finish_seq_idx`).on(table.finishSeq),
        // The history reads newest first through one index per filter: each
        // seat column leads one with the finish order, which also serves
        // its foreign key, and every other filter has one of its own.
        index(`games_user_finish_idx`).on(table.userId, table.finishSeq),
        index(`games_bot_finish_idx`).on(table.botId, table.finishSeq),
        index(`games_challenger_finish_idx`).on(table.challengerBotId, table.finishSeq),
        index(`games_dest_finish_idx`).on(table.destBotId, table.finishSeq),
        index(`games_human_finish_idx`).on(table.finishSeq).where(sql`${table.userId} is not null`),
        index(`games_guests_finish_idx`).on(table.finishSeq).where(sql`${table.guestName} is not null`),
        index(`games_bots_finish_idx`).on(table.finishSeq).where(sql`${table.challengerBotId} is not null`),
        // Lists leave tests out unless asked, so the unfiltered list reads its own index.
        index(`games_shown_finish_idx`).on(table.finishSeq).where(sql`${table.test} = 0`),
        index(`games_undecided_finish_idx`).on(table.finishSeq).where(sql`${table.winner} is null`),
        index(`games_reason_finish_idx`).on(table.finishReason, table.finishSeq),
        index(`games_clock_finish_idx`).on(sql`${table.timeControl} ->> '$.mode'`, table.finishSeq),
        index(`games_opening_finish_idx`).on(sql`json_array_length(${table.openingCells})`, table.finishSeq),
        index(`games_finished_at_idx`).on(table.finishedAt),
        // A tournament's games, or games of none, newest first.
        // The unary plus on games of none keeps the planner from reading
        // a null through the pairing index and sorting every hit.
        index(`games_tournament_finish_idx`).on(table.finishSeq).where(sql`${table.pairingId} is not null`),
        index(`games_no_event_finish_idx`).on(table.finishSeq).where(sql`+${table.pairingId} is null`),
        index(`games_pairing_idx`).on(table.pairingId, table.pairingGame),
        // A null makes an in-list unknown, which a check lets pass, so the
        // nullable values these checks pin are coalesced first.
        check(
            `games_pairing_check`,
            sql`(${table.pairingId} is null and ${table.pairingGame} is null) or (${table.pairingId} is not null and coalesce(${table.pairingGame}, 0) in (1, 2) and ${table.challengerBotId} is not null)`,
        ),
        // The label a guest session is minted with, and nothing that could find the guest again.
        check(`games_guest_name_check`, sql`${table.guestName} is null or ${table.guestName} glob 'Guest [a-z0-9][a-z0-9][a-z0-9][a-z0-9]'`),
        check(
            `games_user_side_check`,
            sql`${table.userSide} is null or ${table.userSide} in ('x', 'o')`,
        ),
        check(`games_x_level_check`, jsonObject(table.xLevel, seatLevelMax)),
        check(`games_o_level_check`, jsonObject(table.oLevel, seatLevelMax)),
        check(
            `games_level_seat_check`,
            sql`${table.userSide} is null or (case ${table.userSide} when 'x' then ${table.xLevel} else ${table.oLevel} end) is null`,
        ),
        // A guest owns no bot, and a test is never rated.
        check(
            `games_test_check`,
            sql`${table.test} in (0, 1) and (${table.test} = 0 or (${table.guestName} is null and (${table.unratedByChoice} = 1 or ${table.xLevel} is not null or ${table.oLevel} is not null)))`,
        ),
        check(
            `games_unrated_by_choice_check`,
            sql`${table.unratedByChoice} in (0, 1) and (${table.unratedByChoice} = 0 or ${table.pairingId} is not null or (${table.xLevel} is null and ${table.oLevel} is null and (${table.userId} is not null or ${table.challengerBotId} is not null)))`,
        ),
        check(
            `games_challenger_side_check`,
            sql`${table.challengerSide} is null or ${table.challengerSide} in ('x', 'o')`,
        ),
        check(
            `games_winner_check`,
            sql`${table.winner} is null or ${table.winner} in ('x', 'o')`,
        ),
        check(
            `games_finish_reason_check`,
            sql`${table.finishReason} is null or ${table.finishReason} in ('aborted', 'disconnect', 'surrender', 'timeout', 'terminated', 'six-in-a-row')`,
        ),
        check(
            `games_finish_pair_check`,
            sql`(${table.finishedAt} is null) = (${table.finishReason} is null)`,
        ),
        check(
            `games_finish_seq_check`,
            sql`(${table.finishedAt} is null) = (${table.finishSeq} is null)`,
        ),
        check(
            `games_seats_check`,
            sql`(
                ${table.userId} is not null and ${table.guestName} is null and ${table.botId} is not null and ${table.userSide} is not null
                and ${table.challengerBotId} is null and ${table.destBotId} is null and ${table.challengerSide} is null
            ) or (
                ${table.userId} is null and ${table.guestName} is not null and ${table.botId} is not null and ${table.userSide} is not null
                and ${table.challengerBotId} is null and ${table.destBotId} is null and ${table.challengerSide} is null
            ) or (
                ${table.userId} is null and ${table.guestName} is null and ${table.botId} is null and ${table.userSide} is null
                and ${table.challengerBotId} is not null and ${table.destBotId} is not null and ${table.challengerSide} is not null
                and ${table.challengerBotId} <> ${table.destBotId}
            )`,
        ),
    ],
);

// One row per completed player turn, seq rising from 1; replaying the
// opening cells plus these rows in seq order reproduces the whole game.
export const moves = sqliteTable(
    `moves`,
    {
        gameId: text(`game_id`)
            .notNull()
            .references(() => games.id, { onDelete: `cascade` }),
        seq: integer(`seq`).notNull(),
        side: text(`side`, { enum: sides }).notNull(),
        firstX: integer(`first_x`).notNull(),
        firstY: integer(`first_y`).notNull(),
        secondX: integer(`second_x`).notNull(),
        secondY: integer(`second_y`).notNull(),
        createdAt: integer(`created_at`).notNull(),
    },
    (table) => [
        primaryKey({ columns: [table.gameId, table.seq] }),
        check(`moves_side_check`, sql`${table.side} in ('x', 'o')`),
        check(`moves_seq_check`, sql`${table.seq} >= 1`),
    ],
);

// A bot's own evaluation of a turn it played, rank 0, and of up to two
// turns it considered, ranks 1 and 2, best first; published once the game
// has finished.
export const ownLines = sqliteTable(
    `own_lines`,
    {
        gameId: text(`game_id`).notNull(),
        seq: integer(`seq`).notNull(),
        rank: integer(`rank`).notNull(),
        firstX: integer(`first_x`).notNull(),
        firstY: integer(`first_y`).notNull(),
        secondX: integer(`second_x`).notNull(),
        secondY: integer(`second_y`).notNull(),
        heuristic: real(`heuristic`),
        winIn: integer(`win_in`),
    },
    (table) => [
        primaryKey({ columns: [table.gameId, table.seq, table.rank] }),
        foreignKey({ columns: [table.gameId, table.seq], foreignColumns: [moves.gameId, moves.seq] }).onDelete(`cascade`),
        ...lineChecks(`own_lines`, table),
    ],
);

// How a bot seat's heuristic read in a game, as its analyzer declaration
// stood when the seat first published an evaluation, so a later declaration
// never rereads the game; null values mean it declared none.
export const ownValues = sqliteTable(
    `own_values`,
    {
        gameId: text(`game_id`)
            .notNull()
            .references(() => games.id, { onDelete: `cascade` }),
        side: text(`side`, { enum: sides }).notNull(),
        scale: real(`scale`),
        cutInaccuracy: real(`cut_inaccuracy`),
        cutMistake: real(`cut_mistake`),
        cutBlunder: real(`cut_blunder`),
        meaning: text(`meaning`),
    },
    (table) => [
        primaryKey({ columns: [table.gameId, table.side] }),
        check(`own_values_side_check`, sql`${table.side} in ('x', 'o')`),
        ...valuesChecks(`own_values`, { scale: table.scale, inaccuracy: table.cutInaccuracy, mistake: table.cutMistake, blunder: table.cutBlunder, meaning: table.meaning }),
    ],
);

// A whole finished game read by a community analyzer on request. The
// analyzer is set once one takes the request, and its version and values are
// the ones it declared then; lines are written only when the reading is done.
// A requester's account may go while the reading stays.
// A reading goes with its game, and with the analyzer that read or was named for it.
export const analyses = sqliteTable(
    `analyses`,
    {
        id: text(`id`).primaryKey(),
        gameId: text(`game_id`)
            .notNull()
            .references(() => games.id, { onDelete: `cascade` }),
        analyzerBotId: text(`analyzer_bot_id`).references(() => bots.id, { onDelete: `cascade` }),
        analyzerVersion: text(`analyzer_version`),
        analyzerScale: real(`analyzer_scale`),
        analyzerCutInaccuracy: real(`analyzer_cut_inaccuracy`),
        analyzerCutMistake: real(`analyzer_cut_mistake`),
        analyzerCutBlunder: real(`analyzer_cut_blunder`),
        analyzerMeaning: text(`analyzer_meaning`),
        // Whether the analyzer's owner sat in the game, as it was when the analyzer took it.
        involved: integer(`involved`).notNull().default(0),
        // The analyzer the requester named, if any; only it may take the request.
        namedBotId: text(`named_bot_id`).references(() => bots.id, { onDelete: `cascade` }),
        requestedBy: text(`requested_by`).references(() => users.id, { onDelete: `set null` }),
        status: text(`status`, { enum: valuesOf(analysisStatusSchema) }).notNull(),
        failure: text(`failure`, { enum: valuesOf(analysisFailureSchema) }),
        failedTurn: integer(`failed_turn`),
        seconds: integer(`seconds`).notNull(),
        createdAt: integer(`created_at`).notNull(),
        startedAt: integer(`started_at`),
        finishedAt: integer(`finished_at`),
    },
    (table) => [
        index(`analyses_game_id_idx`).on(table.gameId),
        index(`analyses_analyzer_bot_id_idx`).on(table.analyzerBotId),
        index(`analyses_named_bot_id_idx`).on(table.namedBotId),
        // Leads with the foreign key, and serves the count of a user's requests a day.
        index(`analyses_requested_by_created_idx`).on(table.requestedBy, table.createdAt),
        // One analyzer reads one game once, failures aside.
        uniqueIndex(`analyses_game_analyzer_idx`).on(table.gameId, table.analyzerBotId).where(sql`${table.status} <> 'failed'`),
        check(`analyses_status_check`, sql`${table.status} in ('queued', 'running', 'done', 'failed')`),
        check(
            `analyses_failure_check`,
            sql`(${table.status} = 'failed') = (${table.failure} is not null) and coalesce(${table.failure}, 'timeout') in ('timeout', 'illegal', 'no_evaluation', 'inconsistent', 'disconnect', 'protocol', 'expired')`,
        ),
        check(`analyses_failed_turn_check`, sql`${table.failedTurn} is null or (${table.failedTurn} >= 1 and ${table.status} = 'failed')`),
        // A request no analyzer took ends as expired, with none.
        check(`analyses_analyzer_check`, sql`((${table.status} = 'queued') = (${table.analyzerBotId} is null)) or (${table.status} = 'failed' and ${table.analyzerBotId} is null)`),
        check(`analyses_version_check`, sql`${table.analyzerVersion} is null or length(${table.analyzerVersion}) <= 64`),
        check(`analyses_involved_check`, sql`${table.involved} in (0, 1) and (${table.involved} = 0 or ${table.analyzerBotId} is not null)`),
        check(`analyses_seconds_check`, sql`${table.seconds} between 1 and ${analyzerSecondsMax}`),
        check(`analyses_finished_check`, sql`(${table.status} in ('done', 'failed')) = (${table.finishedAt} is not null)`),
        ...valuesChecks(
            `analyses_analyzer`,
            { scale: table.analyzerScale, inaccuracy: table.analyzerCutInaccuracy, mistake: table.analyzerCutMistake, blunder: table.analyzerCutBlunder, meaning: table.analyzerMeaning },
            table.analyzerBotId,
        ),
    ],
);

// A finished reading's lines at the position before each turn, best first.
export const analysisLines = sqliteTable(
    `analysis_lines`,
    {
        analysisId: text(`analysis_id`)
            .notNull()
            .references(() => analyses.id, { onDelete: `cascade` }),
        turn: integer(`turn`).notNull(),
        rank: integer(`rank`).notNull(),
        firstX: integer(`first_x`).notNull(),
        firstY: integer(`first_y`).notNull(),
        secondX: integer(`second_x`).notNull(),
        secondY: integer(`second_y`).notNull(),
        heuristic: real(`heuristic`),
        winIn: integer(`win_in`),
    },
    (table) => [primaryKey({ columns: [table.analysisId, table.turn, table.rank] }), check(`analysis_lines_turn_check`, sql`${table.turn} >= 1`), ...lineChecks(`analysis_lines`, table)],
);

// One challenge per client request id, scoped to the challenger: the
// unique pair carries the idempotency, and the row outlives its decision
// so a replayed request id answers with the stored outcome. `created`
// means pending; `decided_at` is null exactly then, and `game_id` is set
// exactly on acceptance.
export const challenges = sqliteTable(
    `challenges`,
    {
        id: text(`id`).primaryKey(),
        challengerBotId: text(`challenger_bot_id`)
            .notNull()
            .references(() => bots.id, { onDelete: `cascade` }),
        destBotId: text(`dest_bot_id`)
            .notNull()
            .references(() => bots.id, { onDelete: `cascade` }),
        requestKey: text(`request_key`).notNull(),
        timeControl: text(`time_control`).notNull(),
        openingPlies: integer(`opening_plies`).notNull(),
        firstPlayer: text(`first_player`, { enum: valuesOf(firstPlayerSchema) }).notNull(),
        status: text(`status`, { enum: valuesOf(challengeStatusSchema) }).notNull(),
        gameId: text(`game_id`).references(() => games.id, { onDelete: `cascade` }),
        createdAt: integer(`created_at`).notNull(),
        decidedAt: integer(`decided_at`),
    },
    (table) => [
        uniqueIndex(`challenges_challenger_request_idx`).on(table.challengerBotId, table.requestKey),
        // Leads with the foreign key, and serves the count of a bot's challenges a day.
        index(`challenges_challenger_created_idx`).on(table.challengerBotId, table.createdAt),
        index(`challenges_dest_bot_id_idx`).on(table.destBotId),
        index(`challenges_game_id_idx`).on(table.gameId),
        check(
            `challenges_status_check`,
            sql`${table.status} in ('created', 'accepted', 'declined', 'canceled', 'expired')`,
        ),
        check(
            `challenges_first_player_check`,
            sql`${table.firstPlayer} in ('challenger', 'challenged', 'random')`,
        ),
        check(
            `challenges_opening_check`,
            sql`${table.openingPlies} in (1, 3, 5, 7, 9)`,
        ),
        check(`challenges_pair_check`, sql`${table.challengerBotId} <> ${table.destBotId}`),
        check(
            `challenges_decided_check`,
            sql`(${table.status} = 'created') = (${table.decidedAt} is null)`,
        ),
        check(
            `challenges_game_check`,
            sql`(${table.status} = 'accepted') = (${table.gameId} is not null)`,
        ),
    ],
);

// A cache of the game log folded in finish order: a player without a rated
// game has no row and reads as the seed for their kind, so a recompute
// rebuilds the table from the fold alone. The bounds mirror the rating
// policy; a row outside them is a bug, not a rating.
export const ratings = sqliteTable(
    `ratings`,
    {
        userId: text(`user_id`).references(() => users.id, { onDelete: `cascade` }),
        botId: text(`bot_id`).references(() => bots.id, { onDelete: `cascade` }),
        rating: real(`rating`).notNull(),
        deviation: real(`deviation`).notNull(),
        volatility: real(`volatility`).notNull(),
    },
    (table) => [
        uniqueIndex(`ratings_user_id_idx`).on(table.userId),
        uniqueIndex(`ratings_bot_id_idx`).on(table.botId),
        check(`ratings_player_check`, sql`(${table.userId} is null) <> (${table.botId} is null)`),
        check(`ratings_rating_check`, sql`${table.rating} >= 400`),
        check(`ratings_deviation_check`, sql`${table.deviation} >= 45 and ${table.deviation} <= 500`),
        check(`ratings_volatility_check`, sql`${table.volatility} > 0 and ${table.volatility} <= 0.1`),
    ],
);

// A cache of the fold beside the ratings: both sides' ratings around every
// finished game, written in the transaction that records the finish, so a
// history row reads the rating a player stood at. A game that rates nobody,
// unrated or voided, carries after equal to before; a recompute rebuilds
// the table from the log.
export const gameRatings = sqliteTable(
    `game_ratings`,
    {
        gameId: text(`game_id`)
            .notNull()
            .references(() => games.id, { onDelete: `cascade` }),
        side: text(`side`, { enum: sides }).notNull(),
        ratingBefore: real(`rating_before`).notNull(),
        ratingAfter: real(`rating_after`).notNull(),
        deviationAfter: real(`deviation_after`).notNull(),
    },
    (table) => [
        primaryKey({ columns: [table.gameId, table.side] }),
        check(`game_ratings_side_check`, sql`${table.side} in ('x', 'o')`),
        check(`game_ratings_rating_check`, sql`${table.ratingBefore} >= 400 and ${table.ratingAfter} >= 400`),
        check(`game_ratings_deviation_check`, sql`${table.deviationAfter} >= 45 and ${table.deviationAfter} <= 500`),
    ],
);

// A single row, created on first write; no row reads as running.
export const siteState = sqliteTable(
    `site_state`,
    {
        id: integer(`id`).primaryKey(),
        pausedAt: integer(`paused_at`),
        // Every boot claims the next generation and a draining process moves
        // it past its own, so a live game whose process no longer holds the
        // stored generation was interrupted by a shutdown.
        generation: integer(`generation`).notNull().default(0),
    },
    (table) => [check(`site_state_single_row_check`, sql`${table.id} = 1`)],
);

// The audit of every admin mutation, written by the process that applied
// it. Targets are names as they stood, not foreign keys, so a row outlives
// the user or bot it names.
export const adminActions = sqliteTable(
    `admin_actions`,
    {
        id: integer(`id`).primaryKey({ autoIncrement: true }),
        actor: text(`actor`).notNull(),
        action: text(`action`).notNull(),
        target: text(`target`),
        reason: text(`reason`).notNull(),
        at: integer(`at`).notNull(),
    },
    // duel-stop names the stops of the duels of old, which older rows keep.
    (table) => [
        check(
            `admin_actions_action_check`,
            sql`${table.action} in ('pause', 'resume', 'ban-user', 'unban-user', 'delete-user', 'delist-bot', 'relist-bot', 'revoke-bot', 'abort-game', 'recompute-ratings', 'tournament-create', 'tournament-cancel', 'tournament-schedule-add', 'tournament-schedule-remove', 'report-close', 'delete-analysis', 'duel-stop')`,
        ),
        check(`admin_actions_reason_check`, sql`length(${table.reason}) > 0`),
    ],
);

// A weekly rule the operator set: the scheduler creates the tournament
// starting on its weekday (0 is Monday) at its UTC minute,
// days_ahead days before that start.
// One rule per weekly slot, since a second tournament starting at the same
// moment would only queue behind the running one.
export const tournamentRules = sqliteTable(
    `tournament_rules`,
    {
        id: integer(`id`).primaryKey({ autoIncrement: true }),
        weekday: integer(`weekday`).notNull(),
        minuteOfDay: integer(`minute_of_day`).notNull(),
        namePattern: text(`name_pattern`).notNull(),
        timeControl: text(`time_control`).notNull(),
        openingPlies: integer(`opening_plies`).notNull(),
        maxEntrants: integer(`max_entrants`).notNull(),
        daysAhead: integer(`days_ahead`).notNull(),
        createdAt: integer(`created_at`).notNull(),
    },
    (table) => [
        uniqueIndex(`tournament_rules_slot_idx`).on(table.weekday, table.minuteOfDay),
        check(`tournament_rules_weekday_check`, sql`${table.weekday} between 0 and 6`),
        check(`tournament_rules_minute_check`, sql`${table.minuteOfDay} between 0 and 1439`),
        // The name each start gets, with its date written in, holds to the tournament name bounds.
        check(
            `tournament_rules_name_check`,
            sql`length(replace(${table.namePattern}, '{date}', 'YYYY-MM-DD')) between 3 and 40 and ${table.namePattern} not glob '*[^ -~]*'`,
        ),
        check(`tournament_rules_opening_check`, sql`${table.openingPlies} in (1, 3, 5, 7, 9)`),
        check(`tournament_rules_max_check`, sql`${table.maxEntrants} between 3 and 12`),
        check(`tournament_rules_days_check`, sql`${table.daysAhead} between 1 and 14`),
    ],
);

const quoted = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(`, `));

// A round robin the operator scheduled, or a duel or round robin a person
// set up from bots they picked. The operator's waits scheduled until its
// start, then runs, or is called off when too few bots are connected; a
// person's runs from the moment it is set up, never rated, and is named
// for its creator, so it holds no name of its own. Either may be canceled
// by the operator; a person's may be stopped, by its creator or as their
// account goes, or cut short once fewer than two bots still play, which
// end_reason says, end_bot_id naming the bot whose leaving cut it short.
// A duel kept from the duels of old holds its d_ id and its ending: stopped
// by the operator, or cut short for a reason only those duels had; it is
// the one person's tournament that may be rated.
// ended_at is set exactly once it is over.
// A weekly rule's tournament names its rule, unique per start,
// so no restart or clock step creates a week twice;
// the tournament outlives the rule.
// test is 1 on a person's tournament of their own bots alone, the one
// kind that plays past ten games a pair; no bot plays more games in one
// than its cap, which the field size and the count stored here bound.
// A person's takes one of their live slots, so a partial unique index
// holds them to that many running at once; (id, origin) is unique so an
// entry's key carries its origin, and (id, games_per_pair) so a
// pairing's carries the count its legs keep to.
export const tournaments = sqliteTable(
    `tournaments`,
    {
        id: text(`id`).primaryKey(),
        name: text(`name`),
        status: text(`status`, { enum: valuesOf(tournamentStatusSchema) }).notNull(),
        startsAt: integer(`starts_at`).notNull(),
        timeControl: text(`time_control`).notNull(),
        openingPlies: integer(`opening_plies`).notNull(),
        maxEntrants: integer(`max_entrants`).notNull(),
        createdAt: integer(`created_at`).notNull(),
        startedAt: integer(`started_at`),
        endedAt: integer(`ended_at`),
        ruleId: integer(`rule_id`).references(() => tournamentRules.id, { onDelete: `set null` }),
        origin: text(`origin`, { enum: valuesOf(tournamentOriginSchema) }).notNull().default(`operator`),
        createdBy: text(`created_by`).references(() => users.id, { onDelete: `set null` }),
        rated: integer(`rated`).notNull().default(1),
        test: integer(`test`).notNull().default(0),
        gamesPerPair: integer(`games_per_pair`).notNull().default(2),
        endReason: text(`end_reason`, { enum: valuesOf(tournamentEndReasonSchema) }),
        endBotId: text(`end_bot_id`).references(() => bots.id, { onDelete: `set null` }),
        liveSlot: integer(`live_slot`),
    },
    (table) => [
        index(`tournaments_status_starts_idx`).on(table.status, table.startsAt),
        uniqueIndex(`tournaments_rule_starts_idx`).on(table.ruleId, table.startsAt),
        uniqueIndex(`tournaments_id_origin_idx`).on(table.id, table.origin),
        uniqueIndex(`tournaments_id_games_idx`).on(table.id, table.gamesPerPair),
        // Leads with the foreign key, and serves the count of a person's tournaments a day.
        index(`tournaments_created_by_idx`).on(table.createdBy, table.createdAt),
        uniqueIndex(`tournaments_live_slot_idx`).on(table.createdBy, table.liveSlot).where(sql`${table.status} = 'running'`),
        index(`tournaments_end_bot_idx`).on(table.endBotId),
        check(`tournaments_status_check`, sql`${table.status} in ('scheduled', 'running', 'finished', 'called_off', 'canceled', 'stopped', 'cut_short')`),
        check(
            `tournaments_name_check`,
            sql`(${table.origin} = 'operator') = (${table.name} is not null) and (${table.name} is null or (length(${table.name}) between 3 and 40 and ${table.name} not glob '*[^ -~]*'))`,
        ),
        check(`tournaments_opening_check`, sql`${table.openingPlies} in (1, 3, 5, 7, 9)`),
        check(
            `tournaments_max_check`,
            sql`${table.maxEntrants} between ${sql.raw(String(tournamentBotsMin))} and 12 and ((${table.origin} = 'operator' and ${table.maxEntrants} >= 3) or (${table.origin} = 'person' and ${table.maxEntrants} <= ${sql.raw(String(tournamentBotsMax))}))`,
        ),
        check(
            `tournaments_started_check`,
            sql`${table.status} = 'canceled' or (${table.status} in ('running', 'finished', 'stopped', 'cut_short')) = (${table.startedAt} is not null)`,
        ),
        check(`tournaments_ended_check`, sql`(${table.status} in ('finished', 'called_off', 'canceled', 'stopped', 'cut_short')) = (${table.endedAt} is not null)`),
        // A person's starts as it is set up, and only it is stopped or cut short.
        check(
            `tournaments_origin_check`,
            sql`(${table.origin} = 'operator' and ${table.createdBy} is null and ${table.status} not in ('stopped', 'cut_short')) or (${table.origin} = 'person' and ${table.ruleId} is null and ${table.status} not in ('scheduled', 'called_off'))`,
        ),
        // Nothing one person picks every bot of is rated; a duel rated under the duels of old stays so, over.
        check(
            `tournaments_rated_check`,
            sql`${table.rated} in (0, 1) and ((${table.origin} = 'operator' and ${table.rated} = 1) or (${table.origin} = 'person' and (${table.rated} = 0 or (${table.maxEntrants} = 2 and ${table.status} in ('finished', 'stopped', 'cut_short')))))`,
        ),
        check(`tournaments_test_check`, sql`${table.test} in (0, 1) and (${table.test} = 0 or ${table.origin} = 'person')`),
        check(
            `tournaments_games_per_pair_check`,
            sql`${table.gamesPerPair} in (${sql.raw(tournamentTestGameCounts.join(`, `))}) and (${table.gamesPerPair} <= ${sql.raw(String(Math.max(...tournamentGameCounts)))} or ${table.test} = 1) and (${table.origin} = 'person' or ${table.gamesPerPair} = 2) and (${table.openingPlies} > 1 or ${table.gamesPerPair} <= 2) and (${table.maxEntrants} - 1) * ${table.gamesPerPair} <= (case ${table.test} when 1 then ${sql.raw(String(tournamentBotGamesMax.test))} else ${sql.raw(String(tournamentBotGamesMax.event))} end)`,
        ),
        check(
            `tournaments_end_check`,
            sql`(${table.status} in ('stopped', 'cut_short')) = (${table.endReason} is not null) and (${table.status} <> 'stopped' or ${table.endReason} in (${quoted(tournamentStopReasons)})) and (${table.status} <> 'cut_short' or ${table.endReason} in (${quoted(tournamentCutReasons)}) or (${table.maxEntrants} = 2 and ${table.endReason} in (${quoted(duelCutReasons)})))`,
        ),
        check(`tournaments_end_bot_check`, sql`${table.endBotId} is null or ${table.status} = 'cut_short'`),
        check(
            `tournaments_live_slot_check`,
            sql`(${table.origin} = 'operator') = (${table.liveSlot} is null) and (${table.liveSlot} is null or ${table.liveSlot} between 1 and ${sql.raw(String(tournamentLiveCap))})`,
        ),
    ],
);

// One bot per owner per tournament in the operator's, which owners enter;
// a person's picks any bots. An operator's entry is entered while the
// tournament waits; at the start it plays, is absent, or is left out, and
// a playing bot may later be withdrawn; left out and withdrawn say why.
// A person's entries play from the start and may be withdrawn, by the
// bot's owner too, and keep the seat they were named in, the first named
// first. origin is the tournament's, held to it by the key, so the
// one-per-owner index can leave a person's out.
// A level is the bot's declared level as it stood at the start, null at
// its default; the version is the bot's then, null where it declared none.
export const tournamentEntries = sqliteTable(
    `tournament_entries`,
    {
        tournamentId: text(`tournament_id`).notNull(),
        botId: text(`bot_id`).notNull(),
        ownerId: text(`owner_id`).notNull(),
        state: text(`state`).notNull().default(`entered`),
        reason: text(`reason`),
        ratingAtStart: real(`rating_at_start`),
        enteredAt: integer(`entered_at`).notNull(),
        origin: text(`origin`).notNull().default(`operator`),
        level: text(`level`),
        version: text(`version`),
        seat: integer(`seat`),
    },
    (table) => [
        primaryKey({ columns: [table.tournamentId, table.botId] }),
        uniqueIndex(`tournament_entries_owner_idx`).on(table.tournamentId, table.ownerId).where(sql`${table.origin} = 'operator'`),
        uniqueIndex(`tournament_entries_seat_idx`).on(table.tournamentId, table.seat),
        index(`tournament_entries_bot_idx`).on(table.botId, table.ownerId),
        index(`tournament_entries_owner_id_idx`).on(table.ownerId),
        foreignKey({ columns: [table.tournamentId, table.origin], foreignColumns: [tournaments.id, tournaments.origin] }).onDelete(`cascade`),
        foreignKey({ columns: [table.botId, table.ownerId], foreignColumns: [bots.id, bots.ownerId] }).onDelete(`cascade`),
        foreignKey({ columns: [table.ownerId], foreignColumns: [users.id] }).onDelete(`cascade`),
        check(
            `tournament_entries_state_check`,
            sql`${table.state} in ('entered', 'playing', 'absent', 'left_out', 'withdrawn') and (${table.origin} = 'operator' or ${table.state} in ('playing', 'withdrawn'))`,
        ),
        check(
            `tournament_entries_reason_check`,
            sql`(${table.state} = 'left_out' and coalesce(${table.reason}, '') in ('daily_cap', 'clock')) or (${table.state} = 'withdrawn' and (coalesce(${table.reason}, '') in ('missed', 'banned', 'delisted', 'deleted') or (${table.origin} = 'person' and coalesce(${table.reason}, '') in ('owner', 'refused', 'tournament')))) or (${table.state} not in ('left_out', 'withdrawn') and ${table.reason} is null)`,
        ),
        check(`tournament_entries_rating_check`, sql`${table.ratingAtStart} is null or ${table.ratingAtStart} >= 400`),
        check(`tournament_entries_level_check`, sql`(${jsonObject(table.level, seatLevelMax)}) and (${table.level} is null or ${table.origin} = 'person')`),
        check(`tournament_entries_version_check`, sql`${table.version} is null or length(${table.version}) between 1 and ${sql.raw(String(botVersionMaxLength))}`),
        check(
            `tournament_entries_seat_check`,
            sql`(${table.origin} = 'operator') = (${table.seat} is null) and (${table.seat} is null or ${table.seat} between 1 and ${sql.raw(String(tournamentBotsMax))})`,
        ),
    ],
);

// One meeting of two bots in a round over one opening: two games, the
// first bot playing x in game 1 and the second in game 2; or, where a pair
// plays a single game, game 1 alone, its second slot none. A pair that
// plays several openings meets in one row per opening, its leg, each
// played once the one before is over; the count it keeps to is the
// tournament's, held to it by the key. Each game's state says how it went;
// its seat names the winner of a played game, the bot that missed a
// no-show, or the bot withdrawn from a forfeit, both for the last two
// when neither came.
export const tournamentPairings = sqliteTable(
    `tournament_pairings`,
    {
        id: text(`id`).primaryKey(),
        tournamentId: text(`tournament_id`).notNull(),
        round: integer(`round`).notNull(),
        firstBotId: text(`first_bot_id`)
            .notNull()
            .references(() => bots.id, { onDelete: `cascade` }),
        secondBotId: text(`second_bot_id`)
            .notNull()
            .references(() => bots.id, { onDelete: `cascade` }),
        openingCells: text(`opening_cells`),
        game1: text(`game1`).notNull().default(`pending`),
        game1Seat: text(`game1_seat`),
        game2: text(`game2`).notNull().default(`pending`),
        game2Seat: text(`game2_seat`),
        leg: integer(`leg`).notNull().default(1),
        gamesPerPair: integer(`games_per_pair`).notNull(),
    },
    (table) => [
        // Leads with the tournament, which serves its foreign key.
        index(`tournament_pairings_round_idx`).on(table.tournamentId, table.round),
        uniqueIndex(`tournament_pairings_leg_idx`).on(table.tournamentId, table.firstBotId, table.secondBotId, table.leg),
        foreignKey({ columns: [table.tournamentId, table.gamesPerPair], foreignColumns: [tournaments.id, tournaments.gamesPerPair] }).onDelete(`cascade`),
        check(
            `tournament_pairings_leg_check`,
            sql`${table.leg} between 1 and ${sql.raw(String(tournamentLegsMax))} and ${table.leg} <= max(1, ${table.gamesPerPair} / 2)`,
        ),
        index(`tournament_pairings_first_idx`).on(table.firstBotId),
        index(`tournament_pairings_second_idx`).on(table.secondBotId),
        check(`tournament_pairings_round_check`, sql`${table.round} >= 1`),
        check(`tournament_pairings_pair_check`, sql`${table.firstBotId} <> ${table.secondBotId}`),
        check(
            `tournament_pairings_game1_check`,
            sql`(${table.game1} in ('pending', 'live', 'not_played', 'aborted') and ${table.game1Seat} is null) or (${table.game1} = 'played' and (${table.game1Seat} is null or ${table.game1Seat} in ('first', 'second'))) or (${table.game1} in ('no_show', 'forfeit') and coalesce(${table.game1Seat}, '') in ('first', 'second', 'both'))`,
        ),
        check(
            `tournament_pairings_game2_check`,
            sql`(${table.game2} in ('pending', 'live', 'not_played', 'aborted', 'none') and ${table.game2Seat} is null) or (${table.game2} = 'played' and (${table.game2Seat} is null or ${table.game2Seat} in ('first', 'second'))) or (${table.game2} in ('no_show', 'forfeit') and coalesce(${table.game2Seat}, '') in ('first', 'second', 'both'))`,
        ),
        // A single game a pair leaves the second slot none, and only it.
        check(`tournament_pairings_single_check`, sql`(${table.gamesPerPair} = 1) = (${table.game2} = 'none')`),
        // Game 2 waits for game 1 to be over.
        check(`tournament_pairings_order_check`, sql`${table.game2} in ('pending', 'none') or ${table.game1} not in ('pending', 'live')`),
    ],
);

const reasons = quoted(reportReasons);

// A report someone sent from the form, open until the operator closes it
// with a note.
// Signed-out visitors report too, so nothing ties a report to an account;
// the name and email are what the reporter chose to give.
// The good-faith statement is a required box, kept as given.
export const reports = sqliteTable(
    `reports`,
    {
        id: integer(`id`).primaryKey({ autoIncrement: true }),
        subject: text(`subject`).notNull(),
        reason: text(`reason`).notNull(),
        details: text(`details`).notNull(),
        reporterName: text(`reporter_name`),
        reporterEmail: text(`reporter_email`),
        goodFaith: integer(`good_faith`).notNull(),
        status: text(`status`).notNull().default(`open`),
        createdAt: integer(`created_at`).notNull(),
        closedAt: integer(`closed_at`),
        note: text(`note`),
    },
    (table) => [
        index(`reports_status_created_idx`).on(table.status, table.createdAt),
        index(`reports_closed_at_idx`).on(table.closedAt),
        check(
            `reports_subject_check`,
            sql`length(${table.subject}) between 1 and ${sql.raw(String(reportSubjectMaxLength))} and substr(${table.subject}, 1, 1) = '/'`,
        ),
        check(`reports_reason_check`, sql`${table.reason} in (${reasons})`),
        check(`reports_details_check`, sql`length(${table.details}) between 1 and ${sql.raw(String(reportDetailsMaxLength))}`),
        check(
            `reports_name_check`,
            sql`${table.reporterName} is null or length(${table.reporterName}) between 1 and ${sql.raw(String(reportNameMaxLength))}`,
        ),
        check(
            `reports_email_check`,
            sql`${table.reporterEmail} is null or (length(${table.reporterEmail}) between 3 and ${sql.raw(String(reportEmailMaxLength))} and ${table.reporterEmail} like '%_@_%')`,
        ),
        check(`reports_good_faith_check`, sql`${table.goodFaith} = 1`),
        check(`reports_status_check`, sql`${table.status} in ('open', 'closed')`),
        check(`reports_closed_check`, sql`(${table.status} = 'closed') = (${table.closedAt} is not null)`),
        check(`reports_note_check`, sql`(${table.status} = 'closed') = (${table.note} is not null) and (${table.note} is null or length(${table.note}) between 1 and 500)`),
    ],
);
