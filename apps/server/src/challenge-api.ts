import {
    acceptsCovers,
    botConcurrentGameCap,
    botDailyCap,
    challengeInboxCap,
    createChallengeRequestSchema,
    nameKeyOf,
    nameSyntaxSchema,
    pairDailyCap,
} from '@hexo-arena/contract';
import type { FastifyInstance } from 'fastify';
import { requireBot } from './bot-api';
import { findBot } from './bots';
import { nowSeconds, type Query } from './db';
import type { GameRegistry } from './game-registry';
import { countBotBotGamesSince, countPairBotGamesSince } from './game-store';
import type { ChallengeRegistry } from './challenge-registry';
import type { PresenceRegistry } from './presence';
import type { CredentialLimits } from './request-limits';
import type { StartGate } from './site-state';

export interface ChallengeApiDeps {
    query: Query;
    presence: PresenceRegistry;
    gate: StartGate;
    games: GameRegistry;
    challenges: ChallengeRegistry;
    limits: CredentialLimits;
}

interface NameParams {
    name: string;
}

interface ChallengeParams {
    challengeId: string;
}

// Unix epoch days are UTC days, so the floor is the whole day boundary.
function utcDayStartSeconds(seconds: number): number {
    return Math.floor(seconds / 86_400) * 86_400;
}

export function registerChallengeApi(app: FastifyInstance, deps: ChallengeApiDeps): void {
    const { query, presence, games, challenges, gate, limits } = deps;

    app.post(`/api/bot/challenge/:name`, { config: { limit: `principal` } }, async (request, reply) => {
        const challenger = requireBot(query, request, reply);
        if (!challenger) return reply;
        if (limits.refuse(reply, `principal`, `bot:${challenger.id}`)) return reply;
        const parsed = createChallengeRequestSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: `the request fails validation`, code: `bad_request` });
        }
        if (gate.refuse(reply)) return reply;
        const { name } = request.params as NameParams;
        if (!nameSyntaxSchema.safeParse(name).success) {
            return reply.code(404).send({ error: `no such bot`, code: `not_found` });
        }
        const target = findBot(query, nameKeyOf(name));
        if (target === undefined) {
            return reply.code(404).send({ error: `no such bot`, code: `not_found` });
        }
        // A self-challenge is the degenerate case of a shared owner.
        if (target.ownerId === challenger.ownerId) {
            return reply
                .code(403)
                .send({ error: `the challenger's owner also owns the target`, code: `own_bot` });
        }
        if (target.delisted || challenger.delisted) {
            return reply.code(403).send({ error: `a delisted bot takes part in no challenge`, code: `delisted` });
        }
        if (!presence.isOnline(target.id) || !presence.isOpenForChallenges(target.id)) {
            return reply.code(400).send({
                error: `the target is not online and taking games`,
                code: `not_open`,
            });
        }
        if (!acceptsCovers(target.accepts, parsed.data.timeControl)) {
            return reply.code(400).send({
                error: `the target does not accept this clock`,
                code: `clock_not_accepted`,
            });
        }
        if (
            games.activeGameCount(target.id) >= botConcurrentGameCap ||
            games.activeGameCount(challenger.id) >= botConcurrentGameCap
        ) {
            return reply.code(400).send({
                error: `a side is at its concurrent-game cap`,
                code: `bot_busy`,
            });
        }
        if (challenges.pendingInboxCount(target.id) >= challengeInboxCap) {
            return reply.code(400).send({
                error: `the target's challenge inbox is full`,
                code: `inbox_full`,
            });
        }
        const now = nowSeconds();
        const dayStart = utcDayStartSeconds(now);
        // The daily caps lift when the UTC day turns, so they answer with the wait until then.
        const untilTomorrow = String(dayStart + 86_400 - now);
        if (
            countPairBotGamesSince(
                query,
                { one: challenger.id, two: target.id },
                dayStart,
            ) >= pairDailyCap
        ) {
            return reply.code(429).header(`retry-after`, untilTomorrow).send({
                error: `this pair reached its daily game cap`,
                code: `daily_pair_cap`,
            });
        }
        if (
            countBotBotGamesSince(query, challenger.id, dayStart) >= botDailyCap ||
            countBotBotGamesSince(query, target.id, dayStart) >= botDailyCap
        ) {
            return reply.code(429).header(`retry-after`, untilTomorrow).send({
                error: `a side reached its daily bot-vs-bot cap`,
                code: `daily_bot_cap`,
            });
        }
        const outcome = challenges.create({
            challenger: { id: challenger.id, name: challenger.name },
            dest: { id: target.id, name: target.name },
            timeControl: parsed.data.timeControl,
            openingPlies: parsed.data.openingPlies,
            firstPlayer: parsed.data.firstPlayer,
            requestKey: parsed.data.requestId,
        });
        if (outcome.kind === `pair_pending`) {
            return reply.code(400).send({ error: `a challenge to this bot is already pending`, code: `challenge_pending` });
        }
        if (outcome.kind === `daily_cap`) {
            return reply
                .code(429)
                .header(`retry-after`, String(outcome.retryAfter))
                .send({ error: `the challenger sent its daily challenges`, code: `daily_challenge_cap` });
        }
        return reply
            .code(outcome.kind === `created` ? 201 : 200)
            .send(outcome.view);
    });

    app.post(`/api/bot/challenge/:challengeId/accept`, { config: { limit: `principal` } }, async (request, reply) => {
        const bot = requireBot(query, request, reply);
        if (!bot) return reply;
        if (limits.refuse(reply, `principal`, `bot:${bot.id}`)) return reply;
        // Acceptance starts a game, so a pause holds it like any creation;
        // the challenge stays pending and may still be accepted on resume.
        if (gate.refuse(reply)) return reply;
        const { challengeId } = request.params as ChallengeParams;
        const result = challenges.accept(bot.id, challengeId);
        if (result.kind === `unknown`) {
            return reply.code(404).send({ error: `no such challenge of yours`, code: `not_found` });
        }
        if (result.kind === `bot_busy`) {
            return reply.code(400).send({
                error: `the target is at its concurrent-game cap`,
                code: `bot_busy`,
            });
        }
        return reply.code(200).send({ ok: true });
    });

    app.post(`/api/bot/challenge/:challengeId/decline`, { config: { limit: `principal` } }, async (request, reply) => {
        const bot = requireBot(query, request, reply);
        if (!bot) return reply;
        if (limits.refuse(reply, `principal`, `bot:${bot.id}`)) return reply;
        const { challengeId } = request.params as ChallengeParams;
        if (challenges.decline(bot.id, challengeId).kind !== `ok`) {
            return reply.code(404).send({ error: `no such challenge of yours`, code: `not_found` });
        }
        return reply.code(200).send({ ok: true });
    });

    app.post(`/api/bot/challenge/:challengeId/cancel`, { config: { limit: `principal` } }, async (request, reply) => {
        const bot = requireBot(query, request, reply);
        if (!bot) return reply;
        if (limits.refuse(reply, `principal`, `bot:${bot.id}`)) return reply;
        const { challengeId } = request.params as ChallengeParams;
        if (challenges.cancel(bot.id, challengeId).kind !== `ok`) {
            return reply.code(404).send({ error: `no such challenge of yours`, code: `not_found` });
        }
        return reply.code(200).send({ ok: true });
    });
}
