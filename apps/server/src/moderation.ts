import { adminGameIdSchema, nameKeyOf } from '@hexo-arena/contract';
import { and, count, eq, inArray, isNotNull, isNull, like, or, type SQL } from 'drizzle-orm';
import { nowSeconds, type Query } from './db';
import { adminActions, bots, games, nameReservations, sessions, tournamentEntries, users } from './db/schema';
import { randomToken, sha256Hex } from './tokens';

export type ModerationChange = { kind: `changed`; id: string } | { kind: `unchanged` } | { kind: `not_found` };

export function setBotDelisted(query: Query, nameKey: string, delisted: boolean): ModerationChange {
    const bot = query.select({ id: bots.id, delistedAt: bots.delistedAt }).from(bots).where(eq(bots.nameKey, nameKey)).get();
    if (bot === undefined) return { kind: `not_found` };
    if ((bot.delistedAt !== null) === delisted) return { kind: `unchanged` };
    query.update(bots)
        .set({ delistedAt: delisted ? nowSeconds() : null })
        .where(eq(bots.id, bot.id))
        .run();
    return { kind: `changed`, id: bot.id };
}

// A stored hash no token can match: the row keeps its unique, non-null
// column, and the owner mints a fresh token from the site.
export function killBotToken(query: Query, botId: string): void {
    query.update(bots)
        .set({ tokenHash: sha256Hex(`revoked:${randomToken(32)}`) })
        .where(eq(bots.id, botId))
        .run();
}

export function findBotId(query: Query, nameKey: string): string | undefined {
    return query
        .select({ id: bots.id })
        .from(bots)
        .where(and(eq(bots.nameKey, nameKey), isNull(bots.deletedAt)))
        .get()?.id;
}

export function ownedBotId(query: Query, ownerId: string, nameKey: string): string | undefined {
    return query
        .select({ id: bots.id })
        .from(bots)
        .where(and(eq(bots.nameKey, nameKey), eq(bots.ownerId, ownerId), isNull(bots.deletedAt)))
        .get()?.id;
}

// Placeholders count up from the number already claimed; a name some
// earlier row happens to hold is skipped, so the claim always lands.
export function claimPlaceholderName(query: Query): string {
    const claimed = query
        .select({ n: count() })
        .from(nameReservations)
        .where(like(nameReservations.nameKey, `deleted-%`))
        .get()?.n ?? 0;
    for (let n = claimed + 1; ; n += 1) {
        const name = `deleted-${String(n)}`;
        const inserted = query.insert(nameReservations).values({ nameKey: name }).onConflictDoNothing().run().changes;
        if (inserted === 1) return name;
    }
}

// A guest's game is in no rating, nor is one against a bot at a level
// other than its default, so neither keeps a bot on the record.
function hasDecidedGame(query: Query, seat: SQL | undefined): boolean {
    return (
        query
            .select({ id: games.id })
            .from(games)
            .where(and(seat, isNotNull(games.winner), isNull(games.guestName), isNull(games.xLevel), isNull(games.oLevel)))
            .limit(1)
            .get() !== undefined
    );
}

// An entry left after the bot's waiting entries are removed is a
// tournament it took part in, whose record keeps the bot.
function hasTournamentEntry(query: Query, botId: string): boolean {
    return query.select({ botId: tournamentEntries.botId }).from(tournamentEntries).where(eq(tournamentEntries.botId, botId)).limit(1).get() !== undefined;
}

function botSeat(botId: string): SQL | undefined {
    return or(eq(games.botId, botId), eq(games.challengerBotId, botId), eq(games.destBotId, botId));
}

/** What became of a deleted bot: kept under a placeholder, or gone with its name freed. */
export type BotDeletion = { kind: `anonymized`; placeholder: string } | { kind: `deleted` };

/**
 * Deletes a bot under the recorded policy: with rated games or a
 * tournament it took part in, it is anonymized and kept, so the fold stays exact and no opponent's rating
 * shifts, and its name stays reserved; without them it is deleted
 * outright, its unrated games with it, and its name is freed.
 * Callers end its live games first.
 */
export function deleteBotByPolicy(query: Query, botId: string): BotDeletion {
    const bot = query.select({ nameKey: bots.nameKey }).from(bots).where(eq(bots.id, botId)).get();
    if (bot === undefined) throw new Error(`deleting a bot that does not exist: ${botId}`);
    if (hasDecidedGame(query, botSeat(botId)) || hasTournamentEntry(query, botId)) {
        const placeholder = claimPlaceholderName(query);
        query.update(bots)
            .set({
                name: placeholder,
                nameKey: placeholder,
                deletedAt: nowSeconds(),
                about: null,
                version: null,
                repoUrl: null,
                accepts: null,
            })
            .where(eq(bots.id, botId))
            .run();
        killBotToken(query, botId);
        return { kind: `anonymized`, placeholder };
    }
    query.delete(bots).where(eq(bots.id, botId)).run();
    query.delete(nameReservations).where(eq(nameReservations.nameKey, bot.nameKey)).run();
    return { kind: `deleted` };
}

export function revokeBot(query: Query, nameKey: string): ModerationChange {
    const botId = findBotId(query, nameKey);
    if (botId === undefined) return { kind: `not_found` };
    killBotToken(query, botId);
    return { kind: `changed`, id: botId };
}

export function botIdsOf(query: Query, ownerId: string): string[] {
    return query.select({ id: bots.id }).from(bots).where(eq(bots.ownerId, ownerId)).all().map((row) => row.id);
}

export function liveBotIdsOf(query: Query, ownerId: string): string[] {
    return query
        .select({ id: bots.id })
        .from(bots)
        .where(and(eq(bots.ownerId, ownerId), isNull(bots.deletedAt)))
        .all()
        .map((row) => row.id);
}

function liveUser(query: Query, nameKey: string): { id: string; bannedAt: number | null } | undefined {
    return query
        .select({ id: users.id, bannedAt: users.bannedAt })
        .from(users)
        .where(and(eq(users.nameKey, nameKey), isNull(users.deletedAt)))
        .get();
}

// A ban ends every session at once; bot tokens are kept, so a bot reads
// the defined 403 while the ban lasts instead of an anonymous 401.
export function banUser(query: Query, nameKey: string): ModerationChange {
    const user = liveUser(query, nameKey);
    if (user === undefined) return { kind: `not_found` };
    if (user.bannedAt !== null) return { kind: `unchanged` };
    query.update(users).set({ bannedAt: nowSeconds() }).where(eq(users.id, user.id)).run();
    query.delete(sessions).where(eq(sessions.userId, user.id)).run();
    return { kind: `changed`, id: user.id };
}

// The tokens that outlived the ban die with it, so nothing minted before
// the ban plays again; the owner mints fresh ones.
export function unbanUser(query: Query, nameKey: string): ModerationChange {
    const user = liveUser(query, nameKey);
    if (user === undefined) return { kind: `not_found` };
    if (user.bannedAt === null) return { kind: `unchanged` };
    query.update(users).set({ bannedAt: null }).where(eq(users.id, user.id)).run();
    for (const botId of botIdsOf(query, user.id)) killBotToken(query, botId);
    return { kind: `changed`, id: user.id };
}

function gamesMatching(query: Query, match: string): string[] | null {
    if (adminGameIdSchema.safeParse(match).success) {
        const game = query.select({ id: games.id }).from(games).where(eq(games.id, match)).get();
        return game === undefined ? null : [game.id];
    }
    const key = nameKeyOf(match);
    const gameIds = (seat: SQL | undefined): string[] =>
        query.select({ id: games.id }).from(games).where(seat).all().map((row) => row.id);
    const user = query.select({ id: users.id }).from(users).where(eq(users.nameKey, key)).get();
    if (user !== undefined) return gameIds(eq(games.userId, user.id));
    // Deleted bots count here: excluding a placeholder's games is how a
    // forgotten Sybil's influence is taken back.
    const bot = query.select({ id: bots.id }).from(bots).where(eq(bots.nameKey, key)).get();
    if (bot === undefined) return null;
    return gameIds(botSeat(bot.id));
}

export type VoidResult = { kind: `voided`; count: number } | { kind: `not_found`; match: string };

// Every match resolves before anything is voided, so a typo voids nothing.
export function voidGames(query: Query, matches: readonly string[]): VoidResult {
    const ids = new Set<string>();
    for (const match of matches) {
        const found = gamesMatching(query, match);
        if (found === null) return { kind: `not_found`, match };
        for (const id of found) ids.add(id);
    }
    if (ids.size === 0) return { kind: `voided`, count: 0 };
    const count = query
        .update(games)
        .set({ voidedAt: nowSeconds() })
        .where(and(inArray(games.id, [...ids]), isNull(games.voidedAt)))
        .run().changes;
    return { kind: `voided`, count };
}

export function findUserId(query: Query, nameKey: string): string | undefined {
    return liveUser(query, nameKey)?.id;
}

export interface UserDeletion {
    readonly user: `anonymized` | `deleted`;
    /** The name the account's audit rows now carry, and its row too when it is kept. */
    readonly placeholder: string;
    readonly bots: Record<`anonymized` | `deleted`, number>;
}

// The actions whose target is a player's name, or a list of names and game
// ids; every other action targets an id or a tournament's own name.
export const namedTargetActions = [`ban-user`, `unban-user`, `delete-user`, `delist-bot`, `relist-bot`, `revoke-bot`, `abort-game`, `recompute-ratings`];

// Each name in a named target is rewritten by its fold, so the audit keeps
// what happened and to whom by placeholder, and no longer by name.
function pseudonymizeAudit(query: Query, placeholders: ReadonlyMap<string, string>): void {
    const rows = query
        .select({ id: adminActions.id, target: adminActions.target })
        .from(adminActions)
        .where(and(isNotNull(adminActions.target), inArray(adminActions.action, namedTargetActions)))
        .all();
    for (const row of rows) {
        const target = row.target ?? ``;
        const rewritten = target
            .split(` `)
            .map((word) => placeholders.get(nameKeyOf(word)) ?? word)
            .join(` `);
        if (rewritten !== target) query.update(adminActions).set({ target: rewritten }).where(eq(adminActions.id, row.id)).run();
    }
}

/**
 * Forgets a user: every bot goes under the bot policy, and the user row is
 * deleted outright unless games or kept bots still point at it, in which
 * case it is renamed to a placeholder and loses its Discord identity.
 * The user's own name is freed either way, and every audit row naming the
 * user or one of their bots names a placeholder instead: a kept bot's own,
 * else the user's, which is claimed even when no row keeps it.
 * Callers end the user's live games first.
 */
export function deleteUser(query: Query, userId: string): UserDeletion {
    const user = query.select({ nameKey: users.nameKey }).from(users).where(eq(users.id, userId)).get();
    if (user === undefined) throw new Error(`deleting a user that does not exist: ${userId}`);
    const placeholder = claimPlaceholderName(query);
    const placeholders = new Map([[user.nameKey, placeholder]]);
    const botOutcomes = { anonymized: 0, deleted: 0 };
    for (const botId of liveBotIdsOf(query, userId)) {
        const nameKey = query.select({ nameKey: bots.nameKey }).from(bots).where(eq(bots.id, botId)).get()?.nameKey ?? ``;
        const outcome = deleteBotByPolicy(query, botId);
        botOutcomes[outcome.kind] += 1;
        placeholders.set(nameKey, outcome.kind === `anonymized` ? outcome.placeholder : placeholder);
    }
    query.delete(sessions).where(eq(sessions.userId, userId)).run();
    pseudonymizeAudit(query, placeholders);
    const kept =
        query.select({ id: games.id }).from(games).where(eq(games.userId, userId)).limit(1).get() !== undefined ||
        botIdsOf(query, userId).length > 0;
    if (!kept) {
        query.delete(users).where(eq(users.id, userId)).run();
        query.delete(nameReservations).where(eq(nameReservations.nameKey, user.nameKey)).run();
        return { user: `deleted`, placeholder, bots: botOutcomes };
    }
    query.update(users)
        .set({ name: placeholder, nameKey: placeholder, discordId: `deleted:${placeholder}`, deletedAt: nowSeconds() })
        .where(eq(users.id, userId))
        .run();
    query.delete(nameReservations).where(eq(nameReservations.nameKey, user.nameKey)).run();
    return { user: `anonymized`, placeholder, bots: botOutcomes };
}
