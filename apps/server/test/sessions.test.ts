import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createQuery, nowSeconds } from '../src/db';
import { sessions } from '../src/db/schema';
import { createSession, findSessionUser } from '../src/sessions';
import { createUserWithExactName } from '../src/users';
import { migratedDatabase } from './helpers';

function testQuery() {
    const sqlite = migratedDatabase();
    return { sqlite, query: createQuery(sqlite) };
}

function created(query: ReturnType<typeof testQuery>[`query`]) {
    const user = createUserWithExactName(query, `1`, `tester`);
    if (user === `name_taken`) throw new Error(`the name is taken`);
    return user;
}

describe('sessions', () => {
    it('keeps the Discord names it was made with, for its owner to read', () => {
        const { sqlite, query } = testQuery();
        const user = created(query);
        const token = createSession(query, user.id, { username: `mira.hex`, displayName: `Mira` });
        expect(findSessionUser(query, token)?.discord).toEqual({ username: `mira.hex`, displayName: `Mira` });
        sqlite.close();
    });

    it('refuses Discord names past 32 characters, and a display name without a username', () => {
        const { sqlite, query } = testQuery();
        const user = created(query);
        expect(() => createSession(query, user.id, { username: `m`.repeat(33), displayName: null })).toThrow(/CHECK constraint failed/);
        const insert = sqlite.prepare(
            `insert into sessions (id, token_hash, user_id, created_at, expires_at, discord_username, discord_display_name) values (?, ?, ?, 1, 2, ?, ?)`,
        );
        expect(() => insert.run(`s1`, `h1`, user.id, null, `Mira`)).toThrow(/CHECK constraint failed/);
        expect(() => insert.run(`s2`, `h2`, user.id, ``, null)).toThrow(/CHECK constraint failed/);
        sqlite.close();
    });

    it('resolves the user for a freshly minted token', () => {
        const { sqlite, query } = testQuery();
        const user = created(query);
        const token = createSession(query, user.id, null);
        expect(findSessionUser(query, token)).toEqual({ id: user.id, name: user.name, discord: null });
        sqlite.close();
    });

    it('rejects an unknown token', () => {
        const { sqlite, query } = testQuery();
        created(query);
        expect(findSessionUser(query, `not-a-session-token`)).toBeNull();
        sqlite.close();
    });

    it('rejects an expired session', () => {
        const { sqlite, query } = testQuery();
        const user = created(query);
        const token = createSession(query, user.id, null);
        query
            .update(sessions)
            .set({ expiresAt: nowSeconds() - 1 })
            .where(eq(sessions.userId, user.id))
            .run();
        expect(findSessionUser(query, token)).toBeNull();
        sqlite.close();
    });
});
