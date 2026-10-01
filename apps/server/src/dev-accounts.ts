import { devAccountSchema, devAccountsPath, devPersonas, nameKeyOf, type DevAccount } from '@hexo-arena/contract';
import { and, asc, count, eq, isNotNull, isNull, or, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Query } from './db';
import { bots, games, users } from './db/schema';
import { isProvisional } from './rating';
import { readRating } from './rating-store';

function finishedCount(query: Query, seat: SQL | undefined): number {
    return query.select({ n: count() }).from(games).where(and(isNotNull(games.finishSeq), seat)).get()?.n ?? 0;
}

function accountOf(query: Query, persona: (typeof devPersonas)[number]): DevAccount | null {
    const user = query
        .select({ id: users.id, name: users.name, bannedAt: users.bannedAt })
        .from(users)
        .where(and(eq(users.nameKey, nameKeyOf(persona.name)), isNull(users.deletedAt)))
        .get();
    if (user === undefined) return null;
    const rating = readRating(query, { kind: `human`, id: user.id });
    const owned = query
        .select({ id: bots.id, name: bots.name })
        .from(bots)
        .where(and(eq(bots.ownerId, user.id), isNull(bots.deletedAt)))
        .orderBy(asc(bots.createdAt), asc(bots.nameKey))
        .all();
    return {
        name: user.name,
        purpose: persona.purpose,
        rating: Math.round(rating.rating),
        provisional: isProvisional(rating),
        banned: user.bannedAt !== null,
        games: finishedCount(query, eq(games.userId, user.id)),
        bots: owned.map((bot) => {
            const botRating = readRating(query, { kind: `bot`, id: bot.id });
            return {
                name: bot.name,
                rating: Math.round(botRating.rating),
                provisional: isProvisional(botRating),
                vsBots: finishedCount(query, or(eq(games.challengerBotId, bot.id), eq(games.destBotId, bot.id))),
            };
        }),
    };
}

/** The seeded personas as they stand, for the dev pill and the seed's top-ups; registered only under DEV_LOGIN. */
export function registerDevAccountsApi(app: FastifyInstance, deps: { query: Query }): void {
    app.get(devAccountsPath, { config: { limit: `public` } }, async (_request, reply) => {
        const listed = devPersonas.flatMap((persona) => accountOf(deps.query, persona) ?? []);
        return reply.code(200).send(devAccountSchema.array().parse(listed));
    });
}
