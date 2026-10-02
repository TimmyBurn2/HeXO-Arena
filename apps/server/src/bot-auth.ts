import { botTokenPattern } from '@hexo-arena/contract';
import { and, eq, isNull } from 'drizzle-orm';
import type { Query } from './db';
import { bots, users } from './db/schema';
import { sha256Hex } from './tokens';

export const botPlayScope = `bot:play`;

export interface BotPrincipal {
    id: string;
    name: string;
    nameKey: string;
    ownerId: string;
    delisted: boolean;
}

export type BotAuth =
    | { kind: `none` }
    | { kind: `banned`; bot: BotPrincipal }
    | { kind: `authenticated`; bot: BotPrincipal };

// The lookup keys on the sha256 of the token, so a rotated row stops
// matching without any invalidation list to keep in step.
export function authenticateBot(query: Query, authorization: string | undefined): BotAuth {
    const token = bearerToken(authorization);
    if (token === null) return { kind: `none` };
    const [row] = query
        .select({
            id: bots.id,
            name: bots.name,
            nameKey: bots.nameKey,
            scope: bots.scope,
            ownerId: users.id,
            bannedAt: users.bannedAt,
            delistedAt: bots.delistedAt,
        })
        .from(bots)
        .innerJoin(users, eq(bots.ownerId, users.id))
        .where(and(eq(bots.tokenHash, sha256Hex(token)), isNull(bots.deletedAt)))
        .all();
    if (!row) return { kind: `none` };
    const bot: BotPrincipal = {
        id: row.id,
        name: row.name,
        nameKey: row.nameKey,
        ownerId: row.ownerId,
        delisted: row.delistedAt !== null,
    };
    // A token without the play scope does not authenticate on this surface;
    // the schema constraint admits only bot:play today, so this carries the
    // requirement for the day the scope set widens.
    if (row.scope !== botPlayScope) return { kind: `none` };
    if (row.bannedAt !== null) return { kind: `banned`, bot };
    return { kind: `authenticated`, bot };
}

function bearerToken(authorization: string | undefined): string | null {
    const [scheme, token] = (authorization ?? ``).split(` `);
    if (scheme?.toLowerCase() !== `bearer`) return null;
    return token !== undefined && botTokenPattern.test(token) ? token : null;
}
