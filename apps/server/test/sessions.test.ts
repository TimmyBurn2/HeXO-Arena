import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createQuery, nowSeconds } from '../src/db';
import { sessions } from '../src/db/schema';
import { createSession, findSessionUser } from '../src/sessions';
import { createUserWithDerivedName } from '../src/users';
import { openDatabase, runMigrations } from '../src/db';

function testQuery() {
    const sqlite = openDatabase(`:memory:`);
    runMigrations(sqlite);
    return { sqlite, query: createQuery(sqlite) };
}

describe('sessions', () => {
    it('resolves the user for a freshly minted token', () => {
        const { sqlite, query } = testQuery();
        const user = createUserWithDerivedName(query, `1`, `tester`);
        const token = createSession(query, user.id);
        expect(findSessionUser(query, token)).toEqual({ id: user.id, name: user.name });
        sqlite.close();
    });

    it('rejects an unknown token', () => {
        const { sqlite, query } = testQuery();
        createUserWithDerivedName(query, `1`, `tester`);
        expect(findSessionUser(query, `not-a-session-token`)).toBeNull();
        sqlite.close();
    });

    it('rejects an expired session', () => {
        const { sqlite, query } = testQuery();
        const user = createUserWithDerivedName(query, `1`, `tester`);
        const token = createSession(query, user.id);
        query
            .update(sessions)
            .set({ expiresAt: nowSeconds() - 1 })
            .where(eq(sessions.userId, user.id))
            .run();
        expect(findSessionUser(query, token)).toBeNull();
        sqlite.close();
    });
});
