import {
    accountDeclarationSchema,
    botAccountPath,
    botAccountSchema,
    botClientOf,
    botDirectoryQuerySchema,
    botListingSchema,
    botsPath,
    botStreamPath,
    botStreamQuerySchema,
    type BotAccount,
    type BotListing,
} from '@hexo-arena/contract';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { BotPrincipal } from './bot-auth';
import { authenticateBot } from './bot-auth';
import type { AnalysisService } from './analysis-service';
import type { AnalyzerSessions } from './analyzers';
import { listBots, readBotDeclaration, recordClient, updateBotDeclaration, type BotDeclaration, type StoredAnalyzer } from './bots';
import { nowSeconds, type Query } from './db';
import type { GameRegistry } from './game-registry';
import type { PresenceRegistry } from './presence';
import type { CredentialLimits } from './request-limits';
import { isProvisional } from './rating';
import { streamPlayerOf } from './rating-store';
import type { StartGate } from './site-state';

export interface BotApiDeps {
    query: Query;
    presence: PresenceRegistry;
    gate: StartGate;
    // The directory shows each bot's live games,
    // so a page can tell a busy bot before a start fails.
    games: Pick<GameRegistry, `activeGameCount`>;
    limits: CredentialLimits;
    reservations: { isReserved: (botId: string) => boolean };
    analyzers: Pick<AnalyzerSessions, `isReady` | `sendOffer`>;
    analysis: Pick<AnalysisService, `withdraw` | `dispatch`>;
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
    const { query, presence, gate, games, limits, reservations, analyzers, analysis } = deps;
    const withReadiness = (botId: string, analyzer: StoredAnalyzer | null) => (analyzer === null ? null : { ...analyzer, ready: analyzers.isReady(botId) });

    app.get(botStreamPath, { config: { limit: `stream` } }, async (request, reply) => {
        const bot = requireBot(query, request, reply);
        if (!bot) return reply;
        // A refused open leaves the stream the bot holds untouched.
        if (limits.refuse(reply, `streamOpen`, `bot:${bot.id}`)) return reply;
        const parsed = botStreamQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.code(400).send({ error: `the open parameter must be exactly 1`, code: `bad_request` });
        }
        // A pause starts nothing new, but a bot coming back to a live game or
        // a running tournament keeps what it holds instead of forfeiting it.
        if (games.activeGameCount(bot.id) === 0 && !reservations.isReserved(bot.id) && gate.refuse(reply)) return reply;
        // The census of clients keeps what the header parses to, never the header.
        recordClient(query, bot.id, botClientOf(request.headers[`user-agent`]), nowSeconds());
        // Writing on reply.raw bypasses serialization and anything that
        // buffers; hijack keeps the framework from answering on its own.
        // Headers flush eagerly: a bot with no replay lines must not wait
        // for the first keepalive to learn the stream is open.
        reply.hijack();
        reply.raw.writeHead(200, { 'content-type': `application/x-ndjson` });
        reply.raw.flushHeaders();
        presence.attach(bot.id, reply.raw, parsed.data.open === `1`);
    });

    app.get(botsPath, { config: { limit: `public` } }, async (request, reply) => {
        const parsed = botDirectoryQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.code(400).send({ error: `the online parameter must be exactly 1`, code: `bad_request` });
        }
        const rows = listBots(query);
        const listed = rows
            .filter((row) => parsed.data.online !== `1` || presence.isOnline(row.id))
            .map((row): BotListing => ({
                analyzer: withReadiness(row.id, row.analyzer),
                name: row.name,
                ownerName: row.ownerName,
                online: presence.isOnline(row.id),
                openForChallenges: presence.isOpenForChallenges(row.id),
                rating: Math.round(row.rating.rating),
                provisional: isProvisional(row.rating),
                liveGames: games.activeGameCount(row.id),
                ...(row.about !== undefined && { about: row.about }),
                ...(row.version !== undefined && { version: row.version }),
                ...(row.repoUrl !== undefined && { repoUrl: row.repoUrl }),
                ...(row.accepts !== undefined && { accepts: row.accepts }),
                levels: row.levels,
            }))
            .filter((listing) => parsed.data.analyzer !== `1` || listing.analyzer !== null);
        return reply.code(200).send(botListingSchema.array().parse(listed));
    });

    const accountOf = (botId: string, declaration: BotDeclaration): BotAccount =>
        botAccountSchema.parse({
            ...streamPlayerOf(query, { kind: `bot`, id: botId }, declaration.name),
            ...declaration,
            analyzer: withReadiness(botId, declaration.analyzer),
        });

    app.get(botAccountPath, { config: { limit: `principal` } }, async (request, reply) => {
        const bot = requireBot(query, request, reply);
        if (!bot) return reply;
        if (limits.refuse(reply, `principal`, `bot:${bot.id}`)) return reply;
        const declaration = readBotDeclaration(query, bot.id);
        // The id came from a token the lookup just resolved.
        if (declaration === undefined) throw new Error(`bot row vanished while reading: ${bot.id}`);
        return reply.code(200).send(accountOf(bot.id, declaration));
    });

    app.patch(botAccountPath, { config: { limit: `principal` } }, async (request, reply) => {
        const bot = requireBot(query, request, reply);
        if (!bot) return reply;
        if (limits.refuse(reply, `principal`, `bot:${bot.id}`)) return reply;
        const parsed = accountDeclarationSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: `the declaration fails validation`, code: `bad_request` });
        }
        const before = parsed.data.analyzer === undefined ? null : readBotDeclaration(query, bot.id)?.analyzer ?? null;
        const declared = updateBotDeclaration(query, bot.id, parsed.data);
        // Turning the analyzer on offers its session at once; withdrawing it
        // closes the session; a change to it may free requests for it.
        if (parsed.data.analyzer === null) analysis.withdraw(bot.id);
        else if (parsed.data.analyzer !== undefined && before === null) analyzers.sendOffer(bot.id);
        else if (parsed.data.analyzer !== undefined) analysis.dispatch();
        return reply.code(200).send(accountOf(bot.id, declared));
    });
}
