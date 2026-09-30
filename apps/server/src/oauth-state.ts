import { count, eq, gte, lt } from 'drizzle-orm';
import { nowSeconds, type Query } from './db';
import { authStates } from './db/schema';
import { randomToken } from './tokens';

// Discord echoes only the state parameter, so the mandatory nonce rides
// inside it and both halves are validated against this row, which also
// keeps the path the sign-in returns to.
const stateTtlSeconds = 600;

export function createOAuthState(query: Query, next: string): string {
    const state = randomToken(32);
    const nonce = randomToken(16);
    const now = nowSeconds();
    query.delete(authStates).where(lt(authStates.expiresAt, now)).run();
    query
        .insert(authStates)
        .values({ state, nonce, expiresAt: now + stateTtlSeconds, next })
        .run();
    return `${state}.${nonce}`;
}

/** Sign-ins started and not yet back from Discord, whose states have not expired. */
export function outstandingOAuthStates(query: Query): number {
    return query.select({ n: count() }).from(authStates).where(gte(authStates.expiresAt, nowSeconds())).get()?.n ?? 0;
}

/** The return path of a state issued here, once; null for one unknown, used, or expired. */
export function consumeOAuthState(query: Query, stateParam: string): { next: string } | null {
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
    return row !== undefined && row.nonce === nonce && row.expiresAt > nowSeconds() ? { next: row.next } : null;
}
