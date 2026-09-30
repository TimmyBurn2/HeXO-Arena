import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { discordNameMaxLength, nextPathMaxLength, signupAttemptCap } from '@hexo-arena/contract';
// One global namespace shared by users and bots: a SQLite unique index
// cannot span two tables, so the fold key is reserved here first and both
// tables reference it.
export const nameReservations = sqliteTable(`name_reservations`, {
    nameKey: text(`name_key`).primaryKey(),
});

export const users = sqliteTable(`users`, {
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
});

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
        delistedAt: integer(`delisted_at`),
        // Set when a bot with rated games is deleted: the row stays so the
        // game log stays whole, under a deleted-<n> placeholder name.
        deletedAt: integer(`deleted_at`),
    },
    (table) => [
        index(`bots_owner_id_idx`).on(table.ownerId),
        check(`bots_scope_check`, sql`${table.scope} in ('bot:play')`),
    ],
);

// The opening position including the origin stone is placed at creation
// and cannot be derived, so it lives here as json; the two-placement turns
// the players made live in moves. A game is in progress exactly while
// finished_at is null; finish_seq numbers finishes in the order they
// happened, which finished_at cannot, since two games share a second.
// A game seats two players in one row: a human game
// sets the human's id, the facing bot, and the human's side; a bot-vs-bot
// game sets the challenger, the challenged bot, and the challenger's side.
// The seats constraint pins exactly one of the two groups.
export const games = sqliteTable(
    `games`,
    {
        id: text(`id`).primaryKey(),
        userId: text(`user_id`).references(() => users.id, { onDelete: `cascade` }),
        botId: text(`bot_id`).references(() => bots.id, { onDelete: `cascade` }),
        userSide: text(`user_side`),
        challengerBotId: text(`challenger_bot_id`).references(() => bots.id, {
            onDelete: `cascade`,
        }),
        destBotId: text(`dest_bot_id`).references(() => bots.id, { onDelete: `cascade` }),
        challengerSide: text(`challenger_side`),
        timeControl: text(`time_control`).notNull(),
        openingCells: text(`opening_cells`).notNull(),
        winner: text(`winner`),
        finishReason: text(`finish_reason`),
        createdAt: integer(`created_at`).notNull(),
        finishedAt: integer(`finished_at`),
        finishSeq: integer(`finish_seq`),
        // A voided game stays in the log but never counts toward a rating.
        voidedAt: integer(`voided_at`),
    },
    (table) => [
        index(`games_user_id_idx`).on(table.userId),
        uniqueIndex(`games_finish_seq_idx`).on(table.finishSeq),
        index(`games_bot_id_idx`).on(table.botId),
        index(`games_challenger_bot_id_idx`).on(table.challengerBotId),
        index(`games_dest_bot_id_idx`).on(table.destBotId),
        check(
            `games_user_side_check`,
            sql`${table.userSide} is null or ${table.userSide} in ('x', 'o')`,
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
                ${table.userId} is not null and ${table.botId} is not null and ${table.userSide} is not null
                and ${table.challengerBotId} is null and ${table.destBotId} is null and ${table.challengerSide} is null
            ) or (
                ${table.userId} is null and ${table.botId} is null and ${table.userSide} is null
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
        side: text(`side`).notNull(),
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
        firstPlayer: text(`first_player`).notNull(),
        status: text(`status`).notNull(),
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
    (table) => [
        check(
            `admin_actions_action_check`,
            sql`${table.action} in ('pause', 'resume', 'ban-user', 'unban-user', 'delete-user', 'delist-bot', 'relist-bot', 'revoke-bot', 'abort-game', 'recompute-ratings')`,
        ),
        check(`admin_actions_reason_check`, sql`length(${table.reason}) > 0`),
    ],
);
