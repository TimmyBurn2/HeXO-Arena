import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
// One global namespace shared by users and bots (SPEC.md section 4): a
// SQLite unique index cannot span two tables, so the fold key is reserved
// here first and both tables reference it.
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
    // Carried from day one (SPEC.md section 4) so the admin ban op never
    // needs a migration; nothing sets it yet.
    bannedAt: integer(`banned_at`),
    createdAt: integer(`created_at`).notNull(),
});

export const sessions = sqliteTable(
    `sessions`,
    {
        id: text(`id`).primaryKey(),
        tokenHash: text(`token_hash`).notNull().unique(),
        userId: text(`user_id`)
            .notNull()
            .references(() => users.id, { onDelete: `cascade` }),
        createdAt: integer(`created_at`).notNull(),
        expiresAt: integer(`expires_at`).notNull()},
    (table) => [index(`sessions_user_id_idx`).on(table.userId)],
);

// Single-use CSRF binding for the OAuth redirect; state and nonce travel
// as one parameter because Discord echoes only state.
export const authStates = sqliteTable(`auth_states`, {
    state: text(`state`).primaryKey(),
    nonce: text(`nonce`).notNull(),
    expiresAt: integer(`expires_at`).notNull(),
});

// The scope column exists from day one so adding scopes later is not a
// breaking change (SPEC.md section 5); v0 mints `bot:play` only.
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
    },
    (table) => [
        index(`bots_owner_id_idx`).on(table.ownerId),
        check(`bots_scope_check`, sql`${table.scope} in ('bot:play')`),
    ],
);
