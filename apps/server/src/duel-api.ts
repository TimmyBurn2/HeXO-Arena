import {
    botDailyCap,
    createDuelRequestSchema,
    deletedPlayerName,
    duelBotStatesSchema,
    duelDailyCap,
    duelDetailMemoMs,
    duelDetailSchema,
    duelGameCounts,
    duelIdSchema,
    duelListCap,
    duelListQuerySchema,
    duelListSchema,
    duelLiveCap,
    duelPerBotCap,
    estimateOf,
    nameKeyOf,
    nameSyntaxSchema,
    pairDailyCap,
    seatLevelOf,
    sideOf,
    turnsOnBoard,
    type DuelBot,
    type DuelBotState,
    type DuelDetail,
    type DuelEstimate,
    type DuelGame,
    type DuelKind,
    type DuelList,
    type DuelSummary,
    type EstimateUnit,
    type SeatLevel,
} from '@hexo-arena/contract';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { listBots } from './bots';
import type { Query } from './db';
import { bots, users } from './db/schema';
import { duelGateFailures, type DuelGateFailure, type DuelRunner } from './duel-runner';
import {
    countRunningOfBot,
    countRunningStartedBy,
    countStartedSince,
    duelGameRows,
    findDuel,
    insertDuel,
    keyOfBot,
    latestGames,
    listedDuels,
    otherKey,
    pairRunning,
    readDuelBot,
    runningPairs,
    sideOfKey,
    xKeyOf,
    type DuelBotRecord,
    type DuelGameRow,
    type DuelKey,
    type DuelRow,
} from './duel-store';
import type { GameRegistry } from './game-registry';
import { countBotBotGamesSince, countPairBotGamesSince, type OpeningCell } from './game-store';
import type { PresenceRegistry } from './presence';
import { isProvisional } from './rating';
import { readRating } from './rating-store';
import { duelExport } from './game-export';
import type { ClientLimits, CredentialLimits } from './request-limits';
import { sessionUser } from './sessions';
import { shownBot, shownUser } from './shown-names';
import type { StartGate } from './site-state';
import { countRunningRoundRobinsOfBot } from './tournament-store';

const isoOf = (seconds: number) => new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/u, `Z`);

const cells = (opening: readonly OpeningCell[]) => opening.map((cell) => ({ x: cell.x, y: cell.y, side: sideOf(cell.player) }));

interface NamedBot {
    readonly name: string;
    readonly ownerName: string;
    readonly deleted: boolean;
}

// Each bot and the starter as public answers name them.
function namesOf(query: Query, row: DuelRow): { bots: Record<DuelKey, NamedBot>; startedBy: string } {
    const bot = (id: string): NamedBot => {
        const found = query
            .select({ name: bots.name, deletedAt: bots.deletedAt, ownerName: users.name, ownerDeletedAt: users.deletedAt })
            .from(bots)
            .innerJoin(users, eq(users.id, bots.ownerId))
            .where(eq(bots.id, id))
            .get();
        // A duel cascades away with either of its bots.
        if (found === undefined) throw new Error(`a duel names a bot that is gone: ${id}`);
        const shown = shownBot(found.name, found.deletedAt);
        return { name: shown.name, ownerName: shownUser(found.ownerName, found.ownerDeletedAt).name, deleted: shown.deleted === true };
    };
    const starter = row.startedBy === null ? undefined : query.select({ name: users.name, deletedAt: users.deletedAt }).from(users).where(eq(users.id, row.startedBy)).get();
    return { bots: { a: bot(row.botIds.a), b: bot(row.botIds.b) }, startedBy: starter === undefined ? deletedPlayerName : shownUser(starter.name, starter.deletedAt).name };
}

// A bot at a level other than its default has no rating of its own to show.
function duelBot(query: Query, row: DuelRow, key: DuelKey, named: NamedBot): DuelBot {
    const level = row.levels[key];
    const version = row.versions[key];
    const rating = named.deleted ? null : readRating(query, { kind: `bot`, id: row.botIds[key] });
    return {
        name: named.name,
        ownerName: named.ownerName,
        ...(named.deleted ? { deleted: true as const } : {}),
        ratingAtStart: level === null ? Math.round(row.ratings[key]) : null,
        ...(level === null ? {} : { level }),
        ...(version === null ? {} : { version }),
        now: rating === null ? null : { rating: Math.round(rating.rating), provisional: isProvisional(rating) },
    };
}

interface DuelReads {
    readonly games: Pick<GameRegistry, `liveEntriesOf`>;
    readonly duels: Pick<DuelRunner, `waitingOf`>;
}

// The stored bot that won a game, read through the bot that played x in it.
function winnerOf(row: DuelRow, game: DuelGameRow): DuelKey | null {
    const xKey = keyOfBot(row, game.xBotId);
    if (game.winner === null || xKey === null) return null;
    return game.winner === `x` ? xKey : otherKey(xKey);
}

// A game over counts once it stands; an aborted one counts for no one.
const stands = (game: DuelGameRow) => game.finishedAt !== null && game.reason !== `aborted`;

// An aborted game a running duel still holds replays on the next pass.
function stateOf(game: DuelGameRow | undefined, running: boolean): DuelGame[`state`] {
    if (game === undefined) return running ? `pending` : `not_played`;
    if (game.finishedAt === null) return `live`;
    if (game.reason !== `aborted`) return `played`;
    return running ? `pending` : `aborted`;
}

// A test's games by pair, the first bot's points in each, since a pair's
// two games share an opening; a single game is a unit of its own.
function estimateFor(row: DuelRow, latest: ReadonlyMap<number, DuelGameRow>): DuelEstimate | undefined {
    if (!row.test) return undefined;
    const units: EstimateUnit[] = [];
    for (let first = 1; first <= row.games; first += 2) {
        const unit = { games: 0, points: 0 };
        for (const number of [first, first + 1]) {
            const game = latest.get(number);
            if (number > row.games || game === undefined || !stands(game)) continue;
            const winner = winnerOf(row, game);
            unit.games += 1;
            unit.points += winner === null ? 0.5 : sideOfKey(row, winner) === `first` ? 1 : 0;
        }
        units.push(unit);
    }
    return estimateOf(units) ?? undefined;
}

const kindOf = (row: DuelRow): DuelKind => (row.test ? `test` : `duel`);

function fieldsOf(query: Query, row: DuelRow) {
    const named = namesOf(query, row);
    const latest = latestGames(duelGameRows(query, row.id));
    const first = row.first;
    const second = otherKey(first);
    const over = [...latest.values()].filter(stands);
    const score = { first: 0, second: 0 };
    for (const game of over) {
        const winner = winnerOf(row, game);
        if (winner !== null) score[sideOfKey(row, winner)] += 1;
    }
    const estimate = estimateFor(row, latest);
    return {
        latest,
        played: over.length,
        fields: {
            id: row.id,
            kind: kindOf(row),
            status: row.status,
            startedBy: named.startedBy,
            first: duelBot(query, row, first, named.bots[first]),
            second: duelBot(query, row, second, named.bots[second]),
            terms: { games: row.games, openingPlies: row.openingPlies, timeControl: row.timeControl, rated: row.rated },
            score,
            ...(estimate === undefined ? {} : { estimate }),
            ...(row.endReason === null ? {} : { end: { reason: row.endReason, bot: row.endBot === null ? null : sideOfKey(row, row.endBot) } }),
            createdAt: isoOf(row.createdAt),
            endedAt: row.endedAt === null ? null : isoOf(row.endedAt),
        },
    };
}

function summaryOf(query: Query, row: DuelRow): DuelSummary {
    const { fields, played, latest } = fieldsOf(query, row);
    const results = gamesOf(row, latest).map(({ game, x, gameId, state, winner }) => ({ game, x, gameId, state, winner }));
    return { ...fields, played, results };
}

/** A duel as the lists name it; null for an unknown id. */
export function duelSummary(query: Query, id: string): DuelSummary | null {
    const row = duelIdSchema.safeParse(id).success ? findDuel(query, id) : undefined;
    return row === undefined ? null : summaryOf(query, row);
}

// A duel as its page reads it; null for an unknown id.
function duelDetail(query: Query, reads: DuelReads, id: string): DuelDetail | null {
    const row = findDuel(query, id);
    if (row === undefined) return null;
    const { fields, latest } = fieldsOf(query, row);
    const running = row.status === `running`;
    const liveIds = [...latest.values()].filter((game) => game.finishedAt === null).map((game) => game.id);
    const wait = running ? reads.duels.waitingOf(id) : null;
    return {
        ...fields,
        games: gamesOf(row, latest),
        live: reads.games.liveEntriesOf(liveIds),
        ...(wait === null ? {} : { waiting: { bot: sideOfKey(row, wait.key), until: new Date(wait.until).toISOString() } }),
    };
}

// Every game of a duel as it stands, played, live, or to come.
function gamesOf(row: DuelRow, latest: ReadonlyMap<number, DuelGameRow>): DuelGame[] {
    const running = row.status === `running`;
    return Array.from({ length: row.games }, (_, index): DuelGame => {
        const number = index + 1;
        const game = latest.get(number);
        const xKey = (game === undefined ? null : keyOfBot(row, game.xBotId)) ?? xKeyOf(row, number);
        const over = game !== undefined && stands(game);
        const won = over ? winnerOf(row, game) : null;
        // A pair's second game shows the stones its first game drew before it starts.
        const opening = game?.opening ?? (number % 2 === 0 ? latest.get(number - 1)?.opening : undefined);
        return {
            game: number,
            x: sideOfKey(row, xKey),
            gameId: game?.id ?? null,
            state: stateOf(game, running),
            winner: won === null ? null : sideOfKey(row, won),
            reason: over ? game.reason : null,
            turns: over ? turnsOnBoard(game.opening.length) + game.moves : null,
            opening: opening === undefined ? null : cells(opening),
        };
    });
}

// Which duels a list holds: one bot's, one person's, one kind, or every one.
interface DuelListFilter {
    readonly botId: string | null;
    readonly userId: string | null;
    readonly kind: DuelKind | null;
}

// Running duels and the latest over.
function duelList(query: Query, filter: DuelListFilter): DuelList {
    const listed = (running: boolean) => listedDuels(query, { running, ...filter, limit: duelListCap }).map((row) => summaryOf(query, row));
    return { running: listed(true), past: listed(false) };
}

// Every listed bot's switch, the bots it plays a running duel with, and its running round robins, as the bot list orders them.
function duelBotStates(query: Query): DuelBotState[] {
    const pairs = runningPairs(query);
    const listed = listBots(query);
    const names = new Map(listed.map((bot) => [bot.id, bot.name]));
    const switches = new Map(query.select({ id: bots.id, on: bots.duelsByOthers }).from(bots).all().map((row) => [row.id, row.on === 1]));
    return listed.map((bot) => ({
        name: bot.name,
        duelsByOthers: switches.get(bot.id) ?? true,
        // A running duel's other bot can be one the list hides, which the setup needs no name for.
        dueling: pairs.flatMap((pair) => {
            const other = pair.a === bot.id ? pair.b : pair.b === bot.id ? pair.a : null;
            const name = other === null ? undefined : names.get(other);
            return name === undefined ? [] : [name];
        }),
        roundRobins: countRunningRoundRobinsOfBot(query, bot.id),
    }));
}

interface DuelApiDeps {
    query: Query;
    presence: PresenceRegistry;
    games: GameRegistry;
    gate: StartGate;
    limits: CredentialLimits & ClientLimits;
    reservations: { isReserved: (botId: string) => boolean };
    duels: DuelRunner;
    random: () => number;
    now: () => number;
}

type Refusal = { status: number; code: string; error: string; retryAfter?: number };

function sendRefusal(reply: FastifyReply, refusal: Refusal): FastifyReply {
    if (refusal.retryAfter !== undefined) void reply.header(`retry-after`, String(refusal.retryAfter));
    return reply.code(refusal.status).send({ error: refusal.error, code: refusal.code });
}

// The chosen level by its id, null at the bot's default; undefined for a level the bot does not declare.
function chosenLevel(bot: DuelBotRecord, id: string | undefined): SeatLevel | null | undefined {
    if (id === undefined) return null;
    const declared = bot.levels?.list.find((level) => level.id === id);
    if (declared === undefined) return undefined;
    return declared.id === bot.levels?.default ? null : seatLevelOf(declared);
}

const duelLengths: ReadonlySet<number> = new Set(duelGameCounts);

/**
 * The duel routes: anyone signed in starts one between two ready bots,
 * anyone reads them, and the starter or an owner stops one.
 */
export function registerDuelApi(app: FastifyInstance, deps: DuelApiDeps): void {
    const { query, limits, gate } = deps;
    const memo = new Map<string, { at: number; body: string }>();

    // Every reader of one key within the window gets the one body; a clock
    // that steps back starts a new window.
    const memoized = (key: string, build: () => string | null): string | null => {
        const now = deps.now();
        const held = memo.get(key);
        if (held !== undefined && now >= held.at && now - held.at < duelDetailMemoMs) return held.body;
        const body = build();
        if (body !== null) memo.set(key, { at: now, body });
        for (const [stale, entry] of memo) if (now - entry.at >= duelDetailMemoMs) memo.delete(stale);
        return body;
    };

    // A duel started or stopped shows in the lists and the bots' states at once, as it does on its own page.
    const forget = (id: string) => {
        memo.delete(id);
        for (const key of memo.keys()) if (key.startsWith(`list:`) || key === `bots`) memo.delete(key);
    };

    const detailOf = (id: string) => {
        const detail = duelDetail(query, deps, id);
        return detail === null ? null : duelDetailSchema.parse(detail);
    };

    app.post(`/api/duels`, { config: { limit: `principal` } }, async (request, reply) => {
        const user = sessionUser(query, request);
        if (user === null) return reply.code(401).send({ error: `no signed-in user`, code: `unauthorized` });
        if (limits.refuse(reply, `principal`, `user:${user.id}`)) return reply;
        const parsed = createDuelRequestSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: `the request fails validation`, code: `bad_request` });
        if (gate.refuse(reply)) return reply;
        const terms = parsed.data;
        const first = readDuelBot(query, { nameKey: nameKeyOf(terms.first) });
        const second = readDuelBot(query, { nameKey: nameKeyOf(terms.second) });
        if (first === undefined || second === undefined) return reply.code(404).send({ error: `no such bot`, code: `not_found` });
        const pair = [first, second] as const;
        const failures = pair.map((bot) => duelGateFailures(bot, { starterId: user.id, timeControl: terms.timeControl }, deps));
        const fails = (...reasons: DuelGateFailure[]) => failures.some((list) => list.some((reason) => reasons.includes(reason)));
        if (fails(`delisted`)) return reply.code(403).send({ error: `a bot is delisted`, code: `delisted` });
        if (fails(`banned`)) return reply.code(403).send({ error: `a bot's owner is banned`, code: `banned` });
        if (fails(`offline`, `closed`)) return reply.code(400).send({ error: `a bot is not online and taking games`, code: `not_open` });
        if (fails(`refused`)) return reply.code(400).send({ error: `a bot's owner takes no duels started by others`, code: `duel_refused` });
        if (fails(`clock`)) return reply.code(400).send({ error: `a bot does not accept this clock`, code: `clock_not_accepted` });
        const firstLevel = chosenLevel(first, terms.levels?.first);
        const secondLevel = chosenLevel(second, terms.levels?.second);
        if (firstLevel === undefined || secondLevel === undefined) return reply.code(400).send({ error: `a bot declares no such level`, code: `unknown_level` });
        if (fails(`busy`, `tournament`) || pair.some((bot) => countRunningOfBot(query, bot.id) + countRunningRoundRobinsOfBot(query, bot.id) >= duelPerBotCap)) {
            return reply.code(400).send({ error: `a bot is at its game cap, in a tournament, or in its most duels and round robins`, code: `bot_busy` });
        }
        // One person on both sides makes a test, whoever started it.
        const test = first.ownerId === second.ownerId;
        // The pair is stored in one order, so one unique index holds it to one running duel.
        const firstIsA = first.id < second.id;
        const botIds = firstIsA ? { a: first.id, b: second.id } : { a: second.id, b: first.id };
        const ownsOne = (first.ownerId === user.id) !== (second.ownerId === user.id);
        const atDefault = firstLevel === null && secondLevel === null;
        const nowSeconds = Math.floor(deps.now() / 1000);
        const dayStart = Math.floor(nowSeconds / 86_400) * 86_400;
        const untilTomorrow = dayStart + 86_400 - nowSeconds;
        // The quotas are read where the duel is written, as the daily caps are.
        const created = query.transaction((tx): { id: string } | Refusal => {
            if (pairRunning(tx, botIds)) return { status: 400, code: `duel_live`, error: `the two bots already play a duel` };
            if (countRunningStartedBy(tx, user.id) >= duelLiveCap) return { status: 400, code: `duel_busy`, error: `you run your most duels at once` };
            if (terms.rated && !(ownsOne && atDefault && !test)) {
                return { status: 400, code: `unrated_only`, error: `a duel is rated only when you own exactly one of the bots and both play their default level` };
            }
            if (!test && !duelLengths.has(terms.games)) return { status: 400, code: `test_only`, error: `only a test between two bots of one owner plays that many games` };
            if (countStartedSince(tx, user.id, dayStart) >= duelDailyCap) {
                return { status: 429, code: `daily_duel_cap`, error: `you started your duels for the day`, retryAfter: untilTomorrow };
            }
            if (terms.rated) {
                if (countPairBotGamesSince(tx, { one: first.id, two: second.id }, dayStart) + terms.games > pairDailyCap) {
                    return { status: 429, code: `daily_pair_cap`, error: `the pair's daily cap does not hold every game`, retryAfter: untilTomorrow };
                }
                if (pair.some((bot) => countBotBotGamesSince(tx, bot.id, dayStart) + terms.games > botDailyCap)) {
                    return { status: 429, code: `daily_bot_cap`, error: `a bot's daily cap does not hold every game`, retryAfter: untilTomorrow };
                }
            }
            const [a, b] = firstIsA ? [first, second] : [second, first];
            const id = insertDuel(tx, {
                startedBy: user.id,
                botIds,
                first: firstIsA ? `a` : `b`,
                xInGame1: deps.random() < 0.5 ? `a` : `b`,
                test,
                games: terms.games,
                timeControl: terms.timeControl,
                openingPlies: terms.openingPlies,
                levels: firstIsA ? { a: firstLevel, b: secondLevel } : { a: secondLevel, b: firstLevel },
                ratings: { a: readRating(tx, { kind: `bot`, id: botIds.a }).rating, b: readRating(tx, { kind: `bot`, id: botIds.b }).rating },
                versions: { a: a.version, b: b.version },
                rated: terms.rated,
                createdAt: nowSeconds,
            });
            return { id };
        });
        if (`code` in created) return sendRefusal(reply, created);
        deps.duels.advance(created.id);
        forget(created.id);
        return reply.code(201).send(detailOf(created.id));
    });

    app.get(`/api/duels`, { config: { limit: `public` } }, async (request, reply) => {
        const parsed = duelListQuerySchema.safeParse(request.query);
        if (!parsed.success) return reply.code(400).send({ error: `the query fails validation`, code: `bad_request` });
        const name = parsed.data.bot;
        const botId =
            name === undefined || !nameSyntaxSchema.safeParse(name).success
                ? null
                : (query.select({ id: bots.id }).from(bots).where(and(eq(bots.nameKey, nameKeyOf(name)), isNull(bots.deletedAt))).get()?.id ?? null);
        if (name !== undefined && botId === null) return reply.code(404).send({ error: `no such bot`, code: `not_found` });
        const mine = parsed.data.mine !== undefined;
        const userId = mine ? (sessionUser(query, request)?.id ?? null) : null;
        // Signed out, the caller owns nothing and started nothing.
        if (mine && userId === null) return reply.send(duelListSchema.parse({ running: [], past: [] }));
        const filter: DuelListFilter = { botId, userId, kind: parsed.data.kind ?? null };
        const body = memoized(`list:${JSON.stringify(filter)}`, () => {
            const list = duelList(query, filter);
            if (userId === null) return JSON.stringify(duelListSchema.parse(list));
            const dayStart = Math.floor(deps.now() / 86_400_000) * 86_400;
            const quota = { live: countRunningStartedBy(query, userId), today: countStartedSince(query, userId, dayStart) };
            return JSON.stringify(duelListSchema.parse({ ...list, quota }));
        });
        return reply.header(`content-type`, `application/json; charset=utf-8`).send(body);
    });

    app.get(`/api/duels/bots`, { config: { limit: `public` } }, async (_request, reply) => {
        const body = memoized(`bots`, () => JSON.stringify(duelBotStatesSchema.parse(duelBotStates(query))));
        return reply.header(`content-type`, `application/json; charset=utf-8`).send(body);
    });

    app.get(`/api/duels/:id`, { config: { limit: `public` } }, async (request, reply) => {
        const { id } = request.params as { id: string };
        if (!duelIdSchema.safeParse(id).success) return reply.code(404).send({ error: `no such duel`, code: `not_found` });
        const body = memoized(id, () => {
            const detail = detailOf(id);
            return detail === null ? null : JSON.stringify(detail);
        });
        if (body === null) return reply.code(404).send({ error: `no such duel`, code: `not_found` });
        return reply.header(`content-type`, `application/json; charset=utf-8`).send(body);
    });

    app.get(`/api/duels/:id/export`, { config: { limit: `public` } }, async (request, reply) => {
        const { id } = request.params as { id: string };
        if (!duelIdSchema.safeParse(id).success) return reply.code(404).send({ error: `no such duel`, code: `not_found` });
        if (limits.refuseExport(reply, request)) return reply;
        const detail = duelDetail(query, deps, id);
        if (detail === null) return reply.code(404).send({ error: `no such duel`, code: `not_found` });
        const file = duelExport(query, detail, deps.now());
        return reply.header(`content-type`, `application/zip`).header(`content-disposition`, `attachment; filename="${file.fileName}"`).send(file.body);
    });

    app.post(`/api/duels/:id/stop`, { config: { limit: `principal` } }, async (request, reply) => {
        const user = sessionUser(query, request);
        if (user === null) return reply.code(401).send({ error: `no signed-in user`, code: `unauthorized` });
        if (limits.refuse(reply, `principal`, `user:${user.id}`)) return reply;
        const { id } = request.params as { id: string };
        const row = duelIdSchema.safeParse(id).success ? findDuel(query, id) : undefined;
        if (row === undefined) return reply.code(404).send({ error: `no such duel`, code: `not_found` });
        const ownedKey = [row.first, otherKey(row.first)].find((key) => readDuelBot(query, { id: row.botIds[key] })?.ownerId === user.id) ?? null;
        const starter = row.startedBy === user.id;
        if (!starter && ownedKey === null) return reply.code(403).send({ error: `you neither started the duel nor own one of its bots`, code: `not_yours` });
        const stopped = deps.duels.stopDuel(id, starter ? { reason: `starter`, bot: null } : { reason: `owner`, bot: ownedKey });
        if (stopped !== `stopped`) return reply.code(409).send({ error: `the duel is already over`, code: `over` });
        forget(id);
        return reply.code(200).send(detailOf(id));
    });
}
