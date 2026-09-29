import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { isReservedName, nameKeyOf, nameSyntaxSchema } from '@hexo-arena/contract';
import { nowSeconds, type Query } from './db';
import { nameReservations, users } from './db/schema';

export interface UserRow {
    id: string;
    discordId: string;
    name: string;
    nameKey: string;
    banned: boolean;
}

// Discord usernames may hold characters the name charset rejects. A dot
// joins words there, so it becomes a hyphen rather than fusing them; the
// rest is stripped, trimmed to a legal start and end, and a fixed stem
// stands in when too little is left, so the suffixes always have a base.
export function nameBaseFromDiscordUsername(username: string): string {
    const stripped = username.toLowerCase().replaceAll(`.`, `-`).replace(/[^a-z0-9_-]/g, ``);
    const trimmed = stripped.replace(/^[^a-z]+/g, ``).slice(0, 30).replace(/[^a-z0-9]+$/g, ``);
    return trimmed.length >= 2 ? trimmed : `user`;
}

function suffixedCandidate(base: string, attempt: number): string {
    if (attempt === 0) return base;
    const suffix = `-${attempt.toString()}`;
    return `${base.slice(0, 30 - suffix.length)}${suffix}`;
}

/**
 * The name a first sign-in suggests: the Discord username as a legal name,
 * suffixed until no player holds its fold. Nothing is claimed, so the name
 * is free when read and checked again when the account is created.
 */
export function suggestedName(query: Query, username: string): string {
    const base = nameBaseFromDiscordUsername(username);
    for (let attempt = 0; attempt < 1000; attempt++) {
        const candidate = suffixedCandidate(base, attempt);
        if (!nameSyntaxSchema.safeParse(candidate).success || isReservedName(candidate)) continue;
        const held = query.select().from(nameReservations).where(eq(nameReservations.nameKey, nameKeyOf(candidate))).get();
        if (held === undefined) return candidate;
    }
    throw new Error(`no free name for base ${base}`);
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

// The name is chosen, not derived, so a taken fold is an honest rejection
// instead of a suffix.
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
