import {
    acceptsSchema,
    botCapPerUser,
    nameKeyOf,
    type Accepts,
    type AccountDeclaration,
    type BotAccount,
} from '@hexarena/contract';
import { and, count, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { nowSeconds, type Query } from './db';
import { bots, nameReservations, ratings, users } from './db/schema';
import { seedRating, type PlayerRating } from './rating';
import { randomToken, sha256Hex } from './tokens';

export type CreateBotResult =
    | { kind: `created`; name: string; token: string }
    | { kind: `name_taken` }
    | { kind: `bot_limit` };

export interface BotRow {
    id: string;
    name: string;
    ownerId: string;
    ownerName: string;
    // Hidden from the directory and out of every new challenge or game, by
    // an explicit delist or by the owner's ban.
    delisted: boolean;
    about?: string;
    version?: string;
    repoUrl?: string;
    accepts?: Accepts;
}

interface DeclarationColumns {
    about: string | null;
    version: string | null;
    repoUrl: string | null;
    accepts: string | null;
}

const declarationColumns = {
    about: bots.about,
    version: bots.version,
    repoUrl: bots.repoUrl,
    accepts: bots.accepts,
};

// Absent, not null: the wire shape omits a field the bot never declared,
// so the row nulls are dropped here and never cross a boundary again.
function declarationView(row: DeclarationColumns): Pick<BotRow, `about` | `version` | `repoUrl` | `accepts`> {
    const view: Pick<BotRow, `about` | `version` | `repoUrl` | `accepts`> = {};
    if (row.about !== null) view.about = row.about;
    if (row.version !== null) view.version = row.version;
    if (row.repoUrl !== null) view.repoUrl = row.repoUrl;
    if (row.accepts !== null) view.accepts = acceptsSchema.parse(JSON.parse(row.accepts));
    return view;
}

// An empty string clears any text field, not only about and repoUrl: one
// rule, no special cases.
function clearableText(value: string): string | null {
    return value === `` ? null : value;
}

function mintBotToken(): string {
    return `hxo_${randomToken(32)}`;
}

export function createBot(query: Query, ownerId: string, name: string): CreateBotResult {
    const token = mintBotToken();
    return query.transaction((tx) => {
        // The cap is policy, not integrity: counted inside the transaction,
        // which the single-process, single-connection model serializes.
        const held = tx
            .select({ n: count() })
            .from(bots)
            .where(and(eq(bots.ownerId, ownerId), isNull(bots.deletedAt)))
            .all()[0]?.n ?? 0;
        if (held >= botCapPerUser) {
            return { kind: `bot_limit` };
        }
        const claimed = tx
            .insert(nameReservations)
            .values({ nameKey: nameKeyOf(name) })
            .onConflictDoNothing()
            .run().changes;
        if (claimed !== 1) return { kind: `name_taken` };
        tx.insert(bots)
            .values({
                id: randomUUID(),
                ownerId,
                name,
                nameKey: nameKeyOf(name),
                tokenHash: sha256Hex(token),
                scope: `bot:play`,
                createdAt: nowSeconds(),
            })
            .run();
        return { kind: `created`, name, token };
    });
}

export function listBots(query: Query): (BotRow & { rating: PlayerRating })[] {
    return query
        .select({
            id: bots.id,
            name: bots.name,
            ownerId: bots.ownerId,
            ownerName: users.name,
            ...declarationColumns,
            rating: ratings.rating,
            deviation: ratings.deviation,
            volatility: ratings.volatility,
        })
        .from(bots)
        .innerJoin(users, eq(bots.ownerId, users.id))
        .leftJoin(ratings, eq(ratings.botId, bots.id))
        .where(and(isNull(bots.delistedAt), isNull(bots.deletedAt), isNull(users.bannedAt)))
        .orderBy(bots.nameKey)
        .all()
        .map((row) => ({
            id: row.id,
            name: row.name,
            ownerId: row.ownerId,
            ownerName: row.ownerName,
            delisted: false,
            ...declarationView(row),
            // No row means no rated game yet: the bot still sits at its seed.
            rating:
                row.rating === null || row.deviation === null || row.volatility === null
                    ? seedRating(`bot`)
                    : { rating: row.rating, deviation: row.deviation, volatility: row.volatility },
        }));
}

export function findBot(query: Query, nameKey: string): BotRow | undefined {
    const row = query
        .select({
            id: bots.id,
            name: bots.name,
            ownerId: bots.ownerId,
            ownerName: users.name,
            delistedAt: bots.delistedAt,
            ownerBannedAt: users.bannedAt,
            ...declarationColumns,
        })
        .from(bots)
        .innerJoin(users, eq(bots.ownerId, users.id))
        .where(and(eq(bots.nameKey, nameKey), isNull(bots.deletedAt)))
        .get();
    return row === undefined
        ? undefined
        : {
              id: row.id,
              name: row.name,
              ownerId: row.ownerId,
              ownerName: row.ownerName,
              delisted: row.delistedAt !== null || row.ownerBannedAt !== null,
              ...declarationView(row),
          };
}

export type BotDeclaration = Omit<BotAccount, `rating` | `provisional`>;

export function readBotDeclaration(query: Query, botId: string): BotDeclaration | undefined {
    const row = query
        .select({ name: bots.name, ...declarationColumns })
        .from(bots)
        .where(eq(bots.id, botId))
        .get();
    return row === undefined ? undefined : { name: row.name, ...declarationView(row) };
}

export function updateBotDeclaration(query: Query, botId: string, changes: AccountDeclaration): BotDeclaration {
    return query.transaction((tx) => {
        const set: Partial<DeclarationColumns> = {};
        if (changes.about !== undefined) set.about = clearableText(changes.about);
        if (changes.version !== undefined) set.version = clearableText(changes.version);
        if (changes.repoUrl !== undefined) set.repoUrl = clearableText(changes.repoUrl);
        if (changes.accepts !== undefined) set.accepts = JSON.stringify(changes.accepts);
        const [row] =
            Object.keys(set).length === 0
                ? tx
                      .select({ name: bots.name, ...declarationColumns })
                      .from(bots)
                      .where(eq(bots.id, botId))
                      .all()
                : tx
                      .update(bots)
                      .set(set)
                      .where(eq(bots.id, botId))
                      .returning({ name: bots.name, ...declarationColumns })
                      .all();
        // The bot id came from a token the lookup just resolved, so a
        // missing row means the delete raced the patch.
        if (!row) throw new Error(`bot row vanished while declaring: ${botId}`);
        return { name: row.name, ...declarationView(row) };
    });
}

export function rotateBotToken(
    query: Query,
    ownerId: string,
    nameKey: string,
): { name: string; token: string } | null {
    const token = mintBotToken();
    return query.transaction((tx) => {
        const [updated] = tx
            .update(bots)
            .set({ tokenHash: sha256Hex(token) })
            .where(and(eq(bots.nameKey, nameKey), eq(bots.ownerId, ownerId), isNull(bots.deletedAt)))
            .returning({ name: bots.name })
            .all();
        if (!updated) return null;
        return { name: updated.name, token };
    });
}
