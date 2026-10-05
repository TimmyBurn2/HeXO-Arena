import { leaderboardActiveDays, leaderboardCap, leaderboardPath, leaderboardQuerySchema, leaderboardSchema, type LeaderboardEntry } from '@hexo-arena/contract';
import type { FastifyInstance } from 'fastify';
import type { Ladder } from './ladder';
import type { PresenceRegistry } from './presence';
import { daySeconds } from './utc-day';

/** The earliest finish, in epoch seconds, that keeps a player on the default board at this moment. */
export function activeSince(nowMs: number): number {
    return Math.floor(nowMs / 1000) - leaderboardActiveDays * daySeconds;
}

function isoOf(seconds: number): string {
    return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/u, `Z`);
}

export function registerLeaderboardApi(app: FastifyInstance, deps: { ladder: Pick<Ladder, `read`>; presence: PresenceRegistry; now: () => number }): void {
    app.get(leaderboardPath, { config: { limit: `public` } }, async (request, reply) => {
        const parsed = leaderboardQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.code(400).send({ error: `kind must be bots, humans, or all, and active 30d or all`, code: `bad_request` });
        }
        const { kind, active } = parsed.data;
        const board = deps.ladder
            .read(kind, active === `all` ? null : activeSince(deps.now()))
            .slice(0, leaderboardCap)
            .map((player, index): LeaderboardEntry => {
                const entry = { rank: index + 1, name: player.name, rating: Math.round(player.rating), games: player.games, lastPlayedAt: isoOf(player.lastPlayedAt) };
                return player.botId === null
                    ? { ...entry, kind: `human` }
                    : { ...entry, kind: `bot`, ownerName: player.ownerName, online: deps.presence.isOnline(player.botId) };
            });
        return reply.code(200).send(leaderboardSchema.parse(board));
    });
}
