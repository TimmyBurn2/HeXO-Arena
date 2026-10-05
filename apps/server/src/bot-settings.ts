import { botSettingsSchema, botSettingsUpdateSchema, nameKeyOf, nameSyntaxSchema, type BotSettings, type BotSettingsUpdate } from '@hexo-arena/contract';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { storedClient } from './bots';
import type { Query } from './db';
import { bots } from './db/schema';
import type { CredentialLimits } from './request-limits';
import { sessionUser } from './sessions';
import type { TournamentScheduler } from './tournament-scheduler';

interface BotSettingsDeps {
    query: Query;
    limits: CredentialLimits;
    // Turning duels by others off takes the bot out of the duels and round robins others set up.
    tournaments: Pick<TournamentScheduler, `withdrawRefused`>;
}

const settingsColumns = {
    name: bots.name,
    duelsByOthers: bots.duelsByOthers,
    ownerAbout: bots.ownerAbout,
    ownerRepoUrl: bots.ownerRepoUrl,
    declaredAbout: bots.about,
    declaredRepoUrl: bots.repoUrl,
    clientKind: bots.clientKind,
    clientVersion: bots.clientVersion,
};

interface SettingsRow {
    name: string;
    duelsByOthers: number;
    ownerAbout: string | null;
    ownerRepoUrl: string | null;
    declaredAbout: string | null;
    declaredRepoUrl: string | null;
    clientKind: string | null;
    clientVersion: string | null;
}

// Absent, not null, for anything never set, as the bot's own view has it.
function settingsOf(row: SettingsRow): BotSettings {
    const client = storedClient(row);
    return botSettingsSchema.parse({
        name: row.name,
        duelsByOthers: row.duelsByOthers === 1,
        ...(row.ownerAbout === null ? {} : { about: row.ownerAbout }),
        ...(row.ownerRepoUrl === null ? {} : { repoUrl: row.ownerRepoUrl }),
        ...(row.declaredAbout === null ? {} : { declaredAbout: row.declaredAbout }),
        ...(row.declaredRepoUrl === null ? {} : { declaredRepoUrl: row.declaredRepoUrl }),
        ...(client === undefined ? {} : { client }),
    });
}

// An owned, live bot's settings after any change the update makes; an empty
// text clears the owner's own, so the declared one shows again.
// Undefined for a bot the owner does not hold.
function updateBotSettings(query: Query, ownerId: string, nameKey: string, changes: BotSettingsUpdate): BotSettings | undefined {
    const where = and(eq(bots.nameKey, nameKey), eq(bots.ownerId, ownerId), isNull(bots.deletedAt));
    const set: { duelsByOthers?: number; ownerAbout?: string | null; ownerRepoUrl?: string | null } = {};
    if (changes.duelsByOthers !== undefined) set.duelsByOthers = changes.duelsByOthers ? 1 : 0;
    if (changes.about !== undefined) set.ownerAbout = changes.about === `` ? null : changes.about;
    if (changes.repoUrl !== undefined) set.ownerRepoUrl = changes.repoUrl === `` ? null : changes.repoUrl;
    const row =
        Object.keys(set).length === 0
            ? query.select(settingsColumns).from(bots).where(where).get()
            : query.update(bots).set(set).where(where).returning(settingsColumns).get();
    return row === undefined ? undefined : settingsOf(row);
}

interface NameParams {
    name: string;
}

/** The owner reads a bot's settings, or changes some; anyone else finds no such bot. */
export function registerBotSettingsApi(app: FastifyInstance, deps: BotSettingsDeps): void {
    const { query, limits } = deps;

    const answer = (request: FastifyRequest<{ Params: NameParams }>, reply: FastifyReply, changes: () => BotSettingsUpdate | null) => {
        const user = sessionUser(query, request);
        if (user === null) return reply.code(401).send({ error: `no session`, code: `unauthorized` });
        if (limits.refuse(reply, `principal`, `user:${user.id}`)) return reply;
        const parsed = changes();
        if (parsed === null) return reply.code(400).send({ error: `the request fails validation`, code: `bad_request` });
        const { name } = request.params;
        const held = nameSyntaxSchema.safeParse(name).success ? updateBotSettings(query, user.id, nameKeyOf(name), parsed) : undefined;
        if (held === undefined) return reply.code(404).send({ error: `no such bot of yours`, code: `not_found` });
        if (parsed.duelsByOthers === false) {
            const bot = query.select({ id: bots.id }).from(bots).where(and(eq(bots.nameKey, nameKeyOf(name)), isNull(bots.deletedAt))).get();
            if (bot !== undefined) deps.tournaments.withdrawRefused(bot.id);
        }
        return reply.code(200).send(held);
    };

    app.get<{ Params: NameParams }>(`/api/bots/:name/settings`, { config: { limit: `principal` } }, async (request, reply) => answer(request, reply, () => ({})));

    app.patch<{ Params: NameParams }>(`/api/bots/:name/settings`, { config: { limit: `principal` } }, async (request, reply) =>
        answer(request, reply, () => {
            const parsed = botSettingsUpdateSchema.safeParse(request.body);
            return parsed.success ? parsed.data : null;
        }),
    );
}
