import { and, eq, gt, isNull, lte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { sessionCookieName, sessionMaxAgeSeconds, type DiscordNames } from '@hexo-arena/contract';
import type { FastifyRequest } from 'fastify';
import { nowSeconds, type Query } from './db';
import { sessions, users } from './db/schema';
import { randomToken, sha256Hex } from './tokens';

/** A new session for the user, keeping the Discord names it was signed in with, if any. */
export function createSession(query: Query, userId: string, discord: DiscordNames | null): string {
    const token = randomToken(32);
    const now = nowSeconds();
    query
        .insert(sessions)
        .values({
            id: randomUUID(),
            tokenHash: sha256Hex(token),
            userId,
            createdAt: now,
            expiresAt: now + sessionMaxAgeSeconds,
            discordUsername: discord?.username ?? null,
            discordDisplayName: discord?.displayName ?? null,
        })
        .run();
    return token;
}

/** A session's user, with the Discord names the session keeps. */
export interface SessionUser {
    id: string;
    name: string;
    discord: DiscordNames | null;
}

export function findSessionUser(query: Query, token: string): SessionUser | null {
    const row =
        query
            .select({
                id: users.id,
                name: users.name,
                discordUsername: sessions.discordUsername,
                discordDisplayName: sessions.discordDisplayName,
            })
            .from(sessions)
            .innerJoin(users, eq(sessions.userId, users.id))
            .where(
                and(
                    eq(sessions.tokenHash, sha256Hex(token)),
                    gt(sessions.expiresAt, nowSeconds()),
                    isNull(users.bannedAt),
                ),
            )
            .get() ?? null;
    if (row === null) return null;
    const { discordUsername, discordDisplayName, ...user } = row;
    return { ...user, discord: discordUsername === null ? null : { username: discordUsername, displayName: discordDisplayName } };
}

/** The user behind a request's session cookie, or null without one. */
export function sessionUser(query: Query, request: FastifyRequest): SessionUser | null {
    const token = request.cookies[sessionCookieName];
    return token ? findSessionUser(query, token) : null;
}

/**
 * Delete every session past its time, and the Discord names it kept with
 * it; the count it deleted.
 */
export function sweepSessions(query: Query): number {
    return query.delete(sessions).where(lte(sessions.expiresAt, nowSeconds())).run().changes;
}

export function deleteSession(query: Query, token: string): void {
    query.delete(sessions).where(eq(sessions.tokenHash, sha256Hex(token))).run();
}
