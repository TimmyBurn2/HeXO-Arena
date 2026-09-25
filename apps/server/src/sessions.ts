import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { sessionCookieName } from '@hexarena/contract';
import type { FastifyRequest } from 'fastify';
import { nowSeconds, type Query } from './db';
import { sessions, users } from './db/schema';
import { randomToken, sha256Hex } from './tokens';

export const sessionCookieMaxAge = 30 * 24 * 60 * 60;

export function createSession(query: Query, userId: string): string {
    const token = randomToken(32);
    const now = nowSeconds();
    // Opportunistic sweep; hobby scale needs no cron.
    query.delete(sessions).where(lt(sessions.expiresAt, now)).run();
    query
        .insert(sessions)
        .values({
            id: randomUUID(),
            tokenHash: sha256Hex(token),
            userId,
            createdAt: now,
            expiresAt: now + sessionCookieMaxAge,
        })
        .run();
    return token;
}

export function findSessionUser(query: Query, token: string): { id: string; name: string } | null {
    return (
        query
            .select({ id: users.id, name: users.name })
            .from(sessions)
            .innerJoin(users, eq(sessions.userId, users.id))
            .where(
                and(
                    eq(sessions.tokenHash, sha256Hex(token)),
                    gt(sessions.expiresAt, nowSeconds()),
                    isNull(users.bannedAt),
                ),
            )
            .get() ?? null
    );
}

/** The user behind a request's session cookie, or null without one. */
export function sessionUser(
    query: Query,
    request: FastifyRequest,
): { id: string; name: string } | null {
    const token = request.cookies[sessionCookieName];
    return token ? findSessionUser(query, token) : null;
}

export function deleteSession(query: Query, token: string): void {
    query.delete(sessions).where(eq(sessions.tokenHash, sha256Hex(token))).run();
}
