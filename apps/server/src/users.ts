import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { isReservedName, nameKeyOf, nameSyntaxSchema } from '@hexarena/contract';
import { nowSeconds, type Query } from './db';
import { nameReservations, users } from './db/schema';

export interface UserRow {
    id: string;
    discordId: string;
    name: string;
    nameKey: string;
    banned: boolean;
}

// Discord usernames may hold characters the name charset rejects; the
// derived base strips them, trims to a legal start and end, and falls back
// to a fixed stem so the claim loop always has something to suffix.
export function nameBaseFromDiscordUsername(username: string): string {
    const stripped = username.toLowerCase().replace(/[^a-z0-9_-]/g, ``);
    const lettersFirst = stripped.replace(/^[^a-z]+/g, ``);
    const trimmed = lettersFirst.replace(/[^a-z0-9]+$/g, ``);
    return trimmed.length >= 2 ? trimmed.slice(0, 30) : `user`;
}

function suffixedCandidate(base: string, attempt: number): string {
    if (attempt === 0) return base;
    const suffix = `-${attempt.toString()}`;
    return `${base.slice(0, 30 - suffix.length)}${suffix}`;
}

export function findUserByDiscordId(query: Query, discordId: string): UserRow | undefined {
    const row = query
        .select({
            id: users.id,
            discordId: users.discordId,
            name: users.name,
            nameKey: users.nameKey,
            bannedAt: users.bannedAt,
        })
        .from(users)
        .where(eq(users.discordId, discordId))
        .get();
    if (row === undefined) return undefined;
    const { bannedAt, ...user } = row;
    return { ...user, banned: bannedAt !== null };
}

export function createUserWithDerivedName(
    query: Query,
    discordId: string,
    username: string,
): UserRow {
    const base = nameBaseFromDiscordUsername(username);
    return query.transaction((tx) => {
        for (let attempt = 0; attempt < 1000; attempt++) {
            const candidate = suffixedCandidate(base, attempt);
            if (!nameSyntaxSchema.safeParse(candidate).success) continue;
            if (isReservedName(candidate)) continue;
            const claimed = tx
                .insert(nameReservations)
                .values({ nameKey: nameKeyOf(candidate) })
                .onConflictDoNothing()
                .run().changes;
            if (claimed !== 1) continue;
            const row = tx
                .insert(users)
                .values({
                    id: randomUUID(),
                    discordId,
                    name: candidate,
                    nameKey: nameKeyOf(candidate),
                    createdAt: nowSeconds(),
                })
                .returning({
                    id: users.id,
                    discordId: users.discordId,
                    name: users.name,
                    nameKey: users.nameKey,
                })
                .get();
            return { ...row, banned: false };
        }
        throw new Error(`no free name for base ${base}`);
    });
}

// The dev login path: the name is chosen, not derived, so a taken fold is
// an honest rejection instead of a suffix.
export function createUserWithExactName(
    query: Query,
    discordId: string,
    name: string,
): UserRow | `name_taken` {
    const nameKey = nameKeyOf(name);
    return query.transaction((tx) => {
        const claimed = tx
            .insert(nameReservations)
            .values({ nameKey })
            .onConflictDoNothing()
            .run().changes;
        if (claimed !== 1) return `name_taken`;
        const row = tx
            .insert(users)
            .values({
                id: randomUUID(),
                discordId,
                name,
                nameKey,
                createdAt: nowSeconds(),
            })
            .returning({
                id: users.id,
                discordId: users.discordId,
                name: users.name,
                nameKey: users.nameKey,
            })
            .get();
        return { ...row, banned: false };
    });
}
