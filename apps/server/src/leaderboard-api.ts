import { leaderboardEntrySchema, leaderboardPath, leaderboardQuerySchema, type LeaderboardEntry } from '@hexo-arena/contract';
import type { FastifyInstance } from 'fastify';
import type { Query } from './db';
import { rankablePlayers } from './rating-store';

export function registerLeaderboardApi(app: FastifyInstance, deps: { query: Query }): void {
    app.get(leaderboardPath, { config: { limit: `public` } }, async (request, reply) => {
        const parsed = leaderboardQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.code(400).send({ error: `kind must be bots, humans, or all`, code: `bad_request` });
        }
        const board = rankablePlayers(deps.query, parsed.data.kind).map(
            (player, index): LeaderboardEntry => ({
                rank: index + 1,
                name: player.name,
                kind: player.kind,
                rating: Math.round(player.rating),
            }),
        );
        return reply.code(200).send(leaderboardEntrySchema.array().parse(board));
    });
}
