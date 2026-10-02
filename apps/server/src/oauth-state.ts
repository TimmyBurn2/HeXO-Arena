import { timingSafeEqual } from 'node:crypto';
import { oauthMaxAgeSeconds } from '@hexo-arena/contract';
import { count, eq, gte, lt } from 'drizzle-orm';
import { nowSeconds, type Query } from './db';
import { authStates } from './db/schema';
import { randomToken } from './tokens';

// Discord echoes only the state parameter, so the mandatory nonce rides
// inside it and both halves are validated against this row, which also
// keeps the path the sign-in returns to.
// The nonce also rides in a cookie of the browser that started, so a
// callback link carried to another browser signs nobody in there.

export function createOAuthState(query: Query, next: string): { state: string; nonce: string } {
    const state = randomToken(32);
    const nonce = randomToken(16);
    const now = nowSeconds();
    query.delete(authStates).where(lt(authStates.expiresAt, now)).run();
    query
        .insert(authStates)
        .values({ state, nonce, expiresAt: now + oauthMaxAgeSeconds, next })
        .run();
    return { state: `${state}.${nonce}`, nonce };
}

/** Sign-ins started and not yet back from Discord, whose states have not expired. */
export function outstandingOAuthStates(query: Query): number {
    return query.select({ n: count() }).from(authStates).where(gte(authStates.expiresAt, nowSeconds())).get()?.n ?? 0;
}

function sameSecret(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * The return path of a state issued here, once, to the browser holding its
 * nonce; null for one unknown, used, expired, or come back to another browser.
 */
export function consumeOAuthState(query: Query, stateParam: string, browserNonce: string | undefined): { next: string } | null {
    const separator = stateParam.lastIndexOf(`.`);
    if (separator === -1) return null;
    const state = stateParam.slice(0, separator);
    const nonce = stateParam.slice(separator + 1);
    const row = query
        .select({ nonce: authStates.nonce, expiresAt: authStates.expiresAt, next: authStates.next })
        .from(authStates)
        .where(eq(authStates.state, state))
        .get();
    query.delete(authStates).where(eq(authStates.state, state)).run();
    if (row === undefined || browserNonce === undefined || row.expiresAt <= nowSeconds()) return null;
    return sameSecret(row.nonce, nonce) && sameSecret(row.nonce, browserNonce) ? { next: row.next } : null;
}
