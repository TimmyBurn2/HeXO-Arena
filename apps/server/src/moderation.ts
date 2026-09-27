import { adminGameIdSchema, nameKeyOf } from '@hexo-arena/contract';
import { and, count, eq, inArray, isNotNull, isNull, like, or, type SQL } from 'drizzle-orm';
import { nowSeconds, type Query } from './db';
import { bots, games, nameReservations, sessions, users } from './db/schema';
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

function hasDecidedGame(query: Query, seat: SQL | undefined): boolean {
    return query.select({ id: games.id }).from(games).where(and(seat, isNotNull(games.winner))).limit(1).get() !== undefined;
}

function botSeat(botId: string): SQL | undefined {
    return or(eq(games.botId, botId), eq(games.challengerBotId, botId), eq(games.destBotId, botId));
}

/**
 * Deletes a bot under the recorded policy: with rated games it is
 * anonymized and kept, so the fold stays exact and no opponent's rating
 * shifts, and its name stays reserved; without them it is deleted
 * outright, its unrated games with it, and its name is freed.
 * Callers end its live games first.
 */
export function deleteBotByPolicy(query: Query, botId: string): `anonymized` | `deleted` {
    const bot = query.select({ nameKey: bots.nameKey }).from(bots).where(eq(bots.id, botId)).get();
    if (bot === undefined) throw new Error(`deleting a bot that does not exist: ${botId}`);
    if (hasDecidedGame(query, botSeat(botId))) {
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
        return `anonymized`;
    }
    query.delete(bots).where(eq(bots.id, botId)).run();
    query.delete(nameReservations).where(eq(nameReservations.nameKey, bot.nameKey)).run();
    return `deleted`;
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
    readonly placeholder: string | null;
    readonly bots: Record<`anonymized` | `deleted`, number>;
}

/**
 * Forgets a user: every bot goes under the bot policy, and the user row is
 * deleted outright unless games or kept bots still point at it, in which
 * case it is renamed to a placeholder and loses its Discord identity.
 * The user's own name is freed either way; nothing that could identify
 * them stays behind. Callers end the user's live games first.
 */
export function deleteUser(query: Query, userId: string): UserDeletion {
    const user = query.select({ nameKey: users.nameKey }).from(users).where(eq(users.id, userId)).get();
    if (user === undefined) throw new Error(`deleting a user that does not exist: ${userId}`);
    const botOutcomes = { anonymized: 0, deleted: 0 };
    for (const botId of liveBotIdsOf(query, userId)) botOutcomes[deleteBotByPolicy(query, botId)] += 1;
    query.delete(sessions).where(eq(sessions.userId, userId)).run();
    const kept =
        query.select({ id: games.id }).from(games).where(eq(games.userId, userId)).limit(1).get() !== undefined ||
        botIdsOf(query, userId).length > 0;
    if (!kept) {
        query.delete(users).where(eq(users.id, userId)).run();
        query.delete(nameReservations).where(eq(nameReservations.nameKey, user.nameKey)).run();
        return { user: `deleted`, placeholder: null, bots: botOutcomes };
    }
    const placeholder = claimPlaceholderName(query);
    query.update(users)
        .set({ name: placeholder, nameKey: placeholder, discordId: `deleted:${placeholder}`, deletedAt: nowSeconds() })
        .where(eq(users.id, userId))
        .run();
    query.delete(nameReservations).where(eq(nameReservations.nameKey, user.nameKey)).run();
    return { user: `anonymized`, placeholder, bots: botOutcomes };
}
