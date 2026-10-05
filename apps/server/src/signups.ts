import { signupAttemptCap, signupMaxAgeSeconds, type DiscordNames } from '@hexo-arena/contract';
import { eq, lte } from 'drizzle-orm';
import { nowSeconds, type Query } from './db';
import { pendingSignups } from './db/schema';
import type { DiscordIdentity } from './discord';
import { randomToken, sha256Hex } from './tokens';

// A first sign-in waiting for its public name.
interface PendingSignup {
    discordId: string;
    names: DiscordNames;
    next: string;
}

/**
 * Hold a first sign-in for {@link signupMaxAgeSeconds}; the token is the
 * signup cookie's value, kept only as its hash. A sign-in the same Discord
 * account already holds is replaced.
 */
export function holdSignup(query: Query, identity: DiscordIdentity, next: string): string {
    const token = randomToken(32);
    query.transaction((tx) => {
        tx.delete(pendingSignups).where(eq(pendingSignups.discordId, identity.id)).run();
        tx.insert(pendingSignups)
            .values({
                tokenHash: sha256Hex(token),
                discordId: identity.id,
                discordUsername: identity.names.username,
                discordDisplayName: identity.names.displayName,
                next,
                expiresAt: nowSeconds() + signupMaxAgeSeconds,
            })
            .run();
    });
    return token;
}

/** The sign-up a token holds, while it has not expired. */
export function findSignup(query: Query, token: string): PendingSignup | null {
    const row = query.select().from(pendingSignups).where(eq(pendingSignups.tokenHash, sha256Hex(token))).get();
    if (row === undefined || row.expiresAt <= nowSeconds()) return null;
    return {
        discordId: row.discordId,
        names: { username: row.discordUsername, displayName: row.discordDisplayName },
        next: row.next,
    };
}

/**
 * Count one name tried against the sign-up; past the cap the sign-up ends
 * and the answer is false.
 */
export function spendSignupAttempt(query: Query, token: string): boolean {
    const key = sha256Hex(token);
    return query.transaction((tx) => {
        const row = tx.select({ attempts: pendingSignups.attempts }).from(pendingSignups).where(eq(pendingSignups.tokenHash, key)).get();
        if (row === undefined) return false;
        if (row.attempts >= signupAttemptCap) {
            tx.delete(pendingSignups).where(eq(pendingSignups.tokenHash, key)).run();
            return false;
        }
        tx.update(pendingSignups).set({ attempts: row.attempts + 1 }).where(eq(pendingSignups.tokenHash, key)).run();
        return true;
    });
}

export function dropSignup(query: Query, token: string): void {
    query.delete(pendingSignups).where(eq(pendingSignups.tokenHash, sha256Hex(token))).run();
}

/** Delete every sign-up past its time; the count it deleted. */
export function sweepSignups(query: Query): number {
    return query.delete(pendingSignups).where(lte(pendingSignups.expiresAt, nowSeconds())).run().changes;
}
