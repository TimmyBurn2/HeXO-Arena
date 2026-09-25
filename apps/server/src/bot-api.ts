import {
    accountDeclarationSchema,
    botAccountPath,
    botAccountSchema,
    botDirectoryQuerySchema,
    botListingSchema,
    botsPath,
    botStreamPath,
    botStreamQuerySchema,
    type BotAccount,
    type BotListing,
} from '@hexarena/contract';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { BotPrincipal } from './bot-auth';
import { authenticateBot } from './bot-auth';
import { listBots, readBotDeclaration, updateBotDeclaration, type BotDeclaration } from './bots';
import { type Query } from './db';
import type { PresenceRegistry } from './presence';
import { isProvisional } from './rating';
import { streamPlayerOf } from './rating-store';
import type { StartGate } from './site-state';

export interface BotApiDeps {
    query: Query;
    presence: PresenceRegistry;
    gate: StartGate;
}

// Sends the failure itself and yields null, so handlers stay flat.
export function requireBot(query: Query, request: FastifyRequest, reply: FastifyReply): BotPrincipal | null {
    const auth = authenticateBot(query, request.headers.authorization);
    if (auth.kind === `none`) {
        reply.code(401).send({ error: `missing, unknown, or rotated token`, code: `unauthorized` });
        return null;
    }
    if (auth.kind === `banned`) {
        reply.code(403).send({ error: `the bot's owner is banned`, code: `banned` });
        return null;
    }
    return auth.bot;
}

export function registerBotApi(app: FastifyInstance, deps: BotApiDeps): void {
    const { query, presence, gate } = deps;

    app.get(botStreamPath, async (request, reply) => {
        const bot = requireBot(query, request, reply);
        if (!bot) return reply;
        const parsed = botStreamQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.code(400).send({ error: `the open parameter must be exactly 1`, code: `bad_request` });
        }
        if (gate.refuse(reply)) return reply;
        // Writing on reply.raw bypasses serialization and anything that
        // buffers; hijack keeps the framework from answering on its own.
        // Headers flush eagerly: a bot with no replay lines must not wait
        // for the first keepalive to learn the stream is open.
        reply.hijack();
        reply.raw.writeHead(200, { 'content-type': `application/x-ndjson` });
        reply.raw.flushHeaders();
        presence.attach(bot.id, reply.raw, parsed.data.open === `1`);
    });

    app.get(botsPath, async (request, reply) => {
        const parsed = botDirectoryQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.code(400).send({ error: `the online parameter must be exactly 1`, code: `bad_request` });
        }
        const rows = listBots(query);
        const listed = rows
            .filter((row) => parsed.data.online !== `1` || presence.isOnline(row.id))
            .map((row): BotListing => ({
                name: row.name,
                ownerName: row.ownerName,
                online: presence.isOnline(row.id),
                openForChallenges: presence.isOpenForChallenges(row.id),
                rating: Math.round(row.rating.rating),
                provisional: isProvisional(row.rating),
                ...(row.about !== undefined && { about: row.about }),
                ...(row.version !== undefined && { version: row.version }),
                ...(row.repoUrl !== undefined && { repoUrl: row.repoUrl }),
                ...(row.accepts !== undefined && { accepts: row.accepts }),
            }));
        return reply.code(200).send(botListingSchema.array().parse(listed));
    });

    const accountOf = (botId: string, declaration: BotDeclaration): BotAccount =>
        botAccountSchema.parse({
            ...streamPlayerOf(query, { kind: `bot`, id: botId }, declaration.name),
            ...declaration,
        });

    app.get(botAccountPath, async (request, reply) => {
        const bot = requireBot(query, request, reply);
        if (!bot) return reply;
        const declaration = readBotDeclaration(query, bot.id);
        // The id came from a token the lookup just resolved.
        if (declaration === undefined) throw new Error(`bot row vanished while reading: ${bot.id}`);
        return reply.code(200).send(accountOf(bot.id, declaration));
    });

    app.patch(botAccountPath, async (request, reply) => {
        const bot = requireBot(query, request, reply);
        if (!bot) return reply;
        const parsed = accountDeclarationSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: `the declaration fails validation`, code: `bad_request` });
        }
        return reply.code(200).send(accountOf(bot.id, updateBotDeclaration(query, bot.id, parsed.data)));
    });
}
