import {
    acceptsCovers,
    acceptsSchema,
    botConcurrentGameCap,
    levelsSchema,
    seatLevelOf,
    type Accepts,
    type Levels,
    type SeatLevel,
    type TimeControl,
} from '@hexo-arena/contract';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import type { Query } from './db';
import { bots, users } from './db/schema';
import type { GameRegistry } from './game-registry';
import type { PresenceRegistry } from './presence';

/** What the gates read of a bot that may play in a duel or a tournament a person set up. */
export interface BotRecord {
    readonly id: string;
    readonly name: string;
    readonly ownerId: string;
    readonly deleted: boolean;
    readonly delisted: boolean;
    readonly ownerBanned: boolean;
    readonly accepts: Accepts | undefined;
    readonly levels: Levels | null;
    readonly version: string | null;
    readonly duelsByOthers: boolean;
}

const botColumns = {
    id: bots.id,
    name: bots.name,
    ownerId: bots.ownerId,
    deletedAt: bots.deletedAt,
    delistedAt: bots.delistedAt,
    ownerBannedAt: users.bannedAt,
    accepts: bots.accepts,
    levels: bots.levels,
    version: bots.version,
    duelsByOthers: bots.duelsByOthers,
};

/** A bot by id or by the fold of a live name, as the gates read it. */
export function readBot(query: Query, by: { id: string } | { nameKey: string }): BotRecord | undefined {
    const row = query
        .select(botColumns)
        .from(bots)
        .innerJoin(users, eq(users.id, bots.ownerId))
        .where(`id` in by ? eq(bots.id, by.id) : and(eq(bots.nameKey, by.nameKey), isNull(bots.deletedAt)))
        .get();
    if (row === undefined) return undefined;
    return {
        id: row.id,
        name: row.name,
        ownerId: row.ownerId,
        deleted: row.deletedAt !== null,
        delisted: row.delistedAt !== null,
        ownerBanned: row.ownerBannedAt !== null,
        accepts: row.accepts === null ? undefined : acceptsSchema.parse(JSON.parse(row.accepts)),
        levels: row.levels === null ? null : levelsSchema.parse(JSON.parse(row.levels)),
        version: row.version,
        duelsByOthers: row.duelsByOthers === 1,
    };
}

/** A gate a bot fails for a game of a duel or a tournament a person set up: taken out, held by the weekly, or not ready. */
export type BotGateFailure = `deleted` | `delisted` | `banned` | `offline` | `closed` | `refused` | `clock` | `tournament` | `busy`;

// What the gates read beyond the bot's own row.
interface BotGateDeps {
    readonly presence: Pick<PresenceRegistry, `isOnline` | `isOpenForChallenges`>;
    readonly games: Pick<GameRegistry, `activeGameCount`>;
    readonly reservations: { isReserved: (botId: string) => boolean };
}

/**
 * Every gate a bot fails for a game someone set up, in the order a refusal
 * names them: being open and its owner's switch bind only an event someone
 * else set up, since an owner may test a bot kept closed to others.
 */
export function botGates(bot: BotRecord, terms: { starterId: string | null; timeControl: TimeControl }, deps: BotGateDeps): BotGateFailure[] {
    const failures: BotGateFailure[] = [];
    if (bot.deleted) failures.push(`deleted`);
    if (bot.delisted) failures.push(`delisted`);
    if (bot.ownerBanned) failures.push(`banned`);
    if (!deps.presence.isOnline(bot.id)) failures.push(`offline`);
    else if (!deps.presence.isOpenForChallenges(bot.id) && bot.ownerId !== terms.starterId) failures.push(`closed`);
    if (!bot.duelsByOthers && bot.ownerId !== terms.starterId) failures.push(`refused`);
    if (!acceptsCovers(bot.accepts, terms.timeControl)) failures.push(`clock`);
    if (deps.reservations.isReserved(bot.id)) failures.push(`tournament`);
    if (deps.games.activeGameCount(bot.id) >= botConcurrentGameCap) failures.push(`busy`);
    return failures;
}

/** The level a bot plays a game at: the one picked for it while still declared and not its default, else its default. */
export function levelNow(bot: BotRecord, chosen: SeatLevel | null): SeatLevel | null {
    if (chosen === null) return null;
    const declared = bot.levels?.list.find((level) => level.id === chosen.id);
    return declared === undefined || declared.id === bot.levels?.default ? null : seatLevelOf(declared);
}

/** The level picked by its id, null at the bot's default; undefined for a level the bot does not declare. */
export function chosenLevel(bot: BotRecord, id: string | undefined): SeatLevel | null | undefined {
    if (id === undefined) return null;
    const declared = bot.levels?.list.find((level) => level.id === id);
    if (declared === undefined) return undefined;
    return declared.id === bot.levels?.default ? null : seatLevelOf(declared);
}

/** A refusal to set a bot event up: its status, code, and message, the bot it names, and the wait a quota answers with. */
export interface Refusal {
    readonly status: number;
    readonly code: string;
    readonly error: string;
    readonly bot?: string;
    readonly retryAfter?: number;
}

/** Answers a refusal: its status and code, the bot it names, and the wait as Retry-After. */
export function sendRefusal(reply: FastifyReply, refusal: Refusal): FastifyReply {
    if (refusal.retryAfter !== undefined) void reply.header(`retry-after`, String(refusal.retryAfter));
    return reply.code(refusal.status).send({ error: refusal.error, code: refusal.code, ...(refusal.bot === undefined ? {} : { bot: refusal.bot }) });
}

// The gates a setup answers first, in this order, each by the first bot
// failing it; busy and reserved come later, beside the per-bot cap.
const gateRefusals: readonly (readonly [readonly BotGateFailure[], Omit<Refusal, `bot`>])[] = [
    [[`delisted`], { status: 403, code: `delisted`, error: `a bot is delisted` }],
    [[`banned`], { status: 403, code: `banned`, error: `a bot's owner is banned` }],
    [[`offline`, `closed`], { status: 400, code: `not_open`, error: `a bot is not online and taking games` }],
    [[`refused`], { status: 400, code: `duel_refused`, error: `a bot's owner takes no duels or round robins set up by others` }],
    [[`clock`], { status: 400, code: `clock_not_accepted`, error: `a bot does not accept this clock` }],
];

/** The first refusal a field's gates call for, naming the first bot that fails it; null when every bot passes them. */
export function gateRefusal(field: readonly { readonly bot: BotRecord; readonly reasons: readonly BotGateFailure[] }[]): Refusal | null {
    for (const [reasons, refusal] of gateRefusals) {
        const failing = field.find((each) => each.reasons.some((reason) => reasons.includes(reason)));
        if (failing !== undefined) return { ...refusal, bot: failing.bot.name };
    }
    return null;
}

/** The first bot of a field busy for a new event: at its game cap, held by the weekly, or in its most events already. */
export function busyBot(field: readonly { readonly bot: BotRecord; readonly reasons: readonly BotGateFailure[] }[], running: (botId: string) => number, cap: number): BotRecord | undefined {
    return field.find(({ bot, reasons }) => reasons.includes(`busy`) || reasons.includes(`tournament`) || running(bot.id) >= cap)?.bot;
}
