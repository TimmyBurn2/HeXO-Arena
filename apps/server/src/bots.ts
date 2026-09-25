import { and, count, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { nameKeyOf } from '@hexarena/contract';
import { nowSeconds, type Query } from './db';
import { bots, nameReservations, users } from './db/schema';
import { randomToken, sha256Hex } from './tokens';

export const botCapPerUser = 3;

export type CreateBotResult =
    | { kind: `created`; name: string; token: string }
    | { kind: `name_taken` }
    | { kind: `bot_limit` };

export interface BotListing {
    name: string;
    ownerName: string;
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
            .where(eq(bots.ownerId, ownerId))
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

export function listBots(query: Query): BotListing[] {
    return query
        .select({ name: bots.name, ownerName: users.name })
        .from(bots)
        .innerJoin(users, eq(bots.ownerId, users.id))
        .orderBy(bots.nameKey)
        .all();
}

export function deleteBot(query: Query, ownerId: string, nameKey: string): boolean {
    return query.transaction((tx) => {
        const removed = tx
            .delete(bots)
            .where(and(eq(bots.nameKey, nameKey), eq(bots.ownerId, ownerId)))
            .run().changes;
        if (removed !== 1) return false;
        tx.delete(nameReservations).where(eq(nameReservations.nameKey, nameKey)).run();
        return true;
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
            .where(and(eq(bots.nameKey, nameKey), eq(bots.ownerId, ownerId)))
            .returning({ name: bots.name })
            .all();
        if (!updated) return null;
        return { name: updated.name, token };
    });
}
