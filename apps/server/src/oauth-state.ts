import { eq, lt } from 'drizzle-orm';
import { nowSeconds, type Query } from './db';
import { authStates } from './db/schema';
import { randomToken } from './tokens';

// Discord echoes only the state parameter, so the mandatory nonce rides
// inside it and both halves are validated against this row (SPEC.md
// section 5).
const stateTtlSeconds = 600;

export function createOAuthState(query: Query): string {
    const state = randomToken(32);
    const nonce = randomToken(16);
    const now = nowSeconds();
    query.delete(authStates).where(lt(authStates.expiresAt, now)).run();
    query
        .insert(authStates)
        .values({ state, nonce, expiresAt: now + stateTtlSeconds })
        .run();
    return `${state}.${nonce}`;
}

export function consumeOAuthState(query: Query, stateParam: string): boolean {
    const separator = stateParam.lastIndexOf(`.`);
    if (separator === -1) return false;
    const state = stateParam.slice(0, separator);
    const nonce = stateParam.slice(separator + 1);
    const row = query
        .select({ nonce: authStates.nonce, expiresAt: authStates.expiresAt })
        .from(authStates)
        .where(eq(authStates.state, state))
        .get();
    query.delete(authStates).where(eq(authStates.state, state)).run();
    return row !== undefined && row.nonce === nonce && row.expiresAt > nowSeconds();
}
