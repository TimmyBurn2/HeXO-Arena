import {
    acceptsCovers,
    acceptsSchema,
    nameKeyOf,
    nameSyntaxSchema,
    openingPliesSchema,
    timeControlSchema,
    tournamentDetailMemoMs,
    tournamentDetailSchema,
    tournamentEntryRequestSchema,
    tournamentEntryStateSchema,
    tournamentEntryReasonSchema,
    tournamentIdSchema,
    tournamentListPastCap,
    tournamentListQuerySchema,
    tournamentListSchema,
    tournamentStatusSchema,
    tournamentWaitingCap,
    type TournamentBot,
    type TournamentDetail,
    type TournamentEntry,
    type TournamentGame,
    type TournamentList,
    type TournamentPlace,
    type TournamentSummary,
    type TournamentYours,
} from '@hexo-arena/contract';
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { nowSeconds, type Query } from './db';
import { bots, games, tournamentEntries, tournamentPairings, tournaments, users } from './db/schema';
import type { GameRegistry } from './game-registry';
import type { PresenceRegistry } from './presence';
import { tournamentExport } from './game-export';
import type { ClientLimits, CredentialLimits } from './request-limits';
import { pointOf, standingsOf, storedSlot, xSeatOf, type PairingSeat, type ScoredPairing } from './round-robin';
import { sessionUser } from './sessions';
import { shownBot, shownUser } from './shown-names';

const isoOf = (seconds: number) => new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/u, `Z`);

interface TournamentRow {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly startsAt: number;
    readonly startedAt: number | null;
    readonly endedAt: number | null;
    readonly timeControl: string;
    readonly openingPlies: number;
    readonly maxEntrants: number;
}

const tournamentColumns = {
    id: tournaments.id,
    name: tournaments.name,
    status: tournaments.status,
    startsAt: tournaments.startsAt,
    startedAt: tournaments.startedAt,
    endedAt: tournaments.endedAt,
    timeControl: tournaments.timeControl,
    openingPlies: tournaments.openingPlies,
    maxEntrants: tournaments.maxEntrants,
};

interface EntryRow {
    readonly botId: string;
    readonly ownerId: string;
    /** The bot's number in this tournament, which its pages name it by. */
    readonly key: number;
    /** The bot as the tournament's pages name it. */
    readonly bot: string;
    readonly ownerName: string;
    readonly deleted: boolean;
    readonly state: string;
    readonly reason: string | null;
    readonly ratingAtStart: number | null;
}

// A deleted bot reads by its label alone; its number in the entry order
// keeps it apart from another deleted bot without either one's placeholder.
function entryRows(query: Query, tournamentId: string): EntryRow[] {
    const rows = query
        .select({
            botId: tournamentEntries.botId,
            ownerId: tournamentEntries.ownerId,
            bot: bots.name,
            botDeletedAt: bots.deletedAt,
            ownerName: users.name,
            ownerDeletedAt: users.deletedAt,
            state: tournamentEntries.state,
            reason: tournamentEntries.reason,
            ratingAtStart: tournamentEntries.ratingAtStart,
        })
        .from(tournamentEntries)
        .innerJoin(bots, eq(bots.id, tournamentEntries.botId))
        .innerJoin(users, eq(users.id, tournamentEntries.ownerId))
        .where(eq(tournamentEntries.tournamentId, tournamentId))
        .orderBy(asc(tournamentEntries.enteredAt), asc(bots.nameKey))
        .all();
    return rows.map(({ botDeletedAt, ownerDeletedAt, ...row }, index) => ({
        ...row,
        key: index + 1,
        bot: shownBot(row.bot, botDeletedAt).name,
        ownerName: shownUser(row.ownerName, ownerDeletedAt).name,
        deleted: botDeletedAt !== null,
    }));
}

// A bot as the round lines name it; every pairing seats two of the entries.
function botOf(entry: EntryRow | undefined, botId: string): TournamentBot {
    if (entry === undefined) throw new Error(`a pairing seats a bot with no entry: ${botId}`);
    return { key: entry.key, name: entry.bot, ...(entry.deleted ? { deleted: true as const } : {}) };
}

// The checks admit only the contract's states and reasons.
function entryView(row: EntryRow, online: boolean): TournamentEntry {
    return {
        key: row.key,
        bot: row.bot,
        ownerName: row.ownerName,
        ...(row.deleted ? { deleted: true } : {}),
        online,
        ratingAtStart: row.ratingAtStart === null ? null : Math.round(row.ratingAtStart),
        state: tournamentEntryStateSchema.parse(row.state),
        ...(row.reason === null ? {} : { reason: tournamentEntryReasonSchema.parse(row.reason) }),
    };
}

interface PairingView {
    readonly round: number;
    readonly first: TournamentBot;
    readonly second: TournamentBot;
    readonly scored: ScoredPairing;
    readonly gameIds: readonly [string | null, string | null];
}

// Every pairing seats two of the tournament's entries, which name its bots.
function pairingViews(query: Query, tournamentId: string, entries: readonly EntryRow[]): PairingView[] {
    const rows = query
        .select({
            id: tournamentPairings.id,
            round: tournamentPairings.round,
            firstBotId: tournamentPairings.firstBotId,
            secondBotId: tournamentPairings.secondBotId,
            game1: tournamentPairings.game1,
            game1Seat: tournamentPairings.game1Seat,
            game2: tournamentPairings.game2,
            game2Seat: tournamentPairings.game2Seat,
        })
        .from(tournamentPairings)
        .where(eq(tournamentPairings.tournamentId, tournamentId))
        .orderBy(asc(tournamentPairings.round), asc(tournamentPairings.id))
        .all();
    if (rows.length === 0) return [];
    const byBot = new Map(entries.map((entry) => [entry.botId, entry]));
    // The latest game of each slot, a replay over the game it replaced.
    const slotGames = new Map<string, string>();
    {
        for (const game of query
            .select({ id: games.id, pairingId: games.pairingId, pairingGame: games.pairingGame })
            .from(games)
            .where(inArray(games.pairingId, rows.map((row) => row.id)))
            .orderBy(asc(games.createdAt))
            .all()) {
            slotGames.set(`${game.pairingId ?? ``}:${String(game.pairingGame)}`, game.id);
        }
    }
    return rows.map((row) => ({
        round: row.round,
        first: botOf(byBot.get(row.firstBotId), row.firstBotId),
        second: botOf(byBot.get(row.secondBotId), row.secondBotId),
        scored: {
            round: row.round,
            first: row.firstBotId,
            second: row.secondBotId,
            games: [storedSlot(row.game1, row.game1Seat), storedSlot(row.game2, row.game2Seat)],
        },
        gameIds: [slotGames.get(`${row.id}:1`) ?? null, slotGames.get(`${row.id}:2`) ?? null],
    }));
}

function gameView(pairing: PairingView, index: 0 | 1): TournamentGame {
    const result = pairing.scored.games[index];
    const keyOf = (seat: PairingSeat) => (seat === `first` ? pairing.first.key : pairing.second.key);
    const point = pointOf(result);
    const absent = result.kind === `no_show` ? result.missing : result.kind === `forfeit` ? result.withdrawn : null;
    return {
        x: keyOf(xSeatOf(index === 0 ? 1 : 2)),
        gameId: pairing.gameIds[index],
        outcome: result.kind,
        point: point === null ? null : keyOf(point),
        missing: absent === null ? [] : absent === `both` ? [pairing.first.key, pairing.second.key] : [keyOf(absent)],
    };
}

/** A tournament as its page reads it; null for an unknown id. */
export function tournamentDetail(query: Query, deps: { presence: PresenceRegistry; games: GameRegistry }, id: string): TournamentDetail | null {
    const row = query.select(tournamentColumns).from(tournaments).where(eq(tournaments.id, id)).get();
    if (row === undefined) return null;
    const entries = entryRows(query, id);
    const pairings = pairingViews(query, id, entries);
    const byBot = new Map(entries.map((entry) => [entry.botId, entry]));
    const field = entries.filter((entry) => entry.state === `playing` || entry.state === `withdrawn`).map((entry) => entry.botId);
    const standings = standingsOf(
        field,
        pairings.map((pairing) => pairing.scored),
    ).map((line) => {
        const entry = byBot.get(line.bot);
        if (entry === undefined) throw new Error(`a standing names a bot with no entry: ${line.bot}`);
        return {
            rank: line.rank,
            key: entry.key,
            bot: entry.bot,
            ownerName: entry.ownerName,
            ...(entry.deleted ? { deleted: true as const } : {}),
            points: line.points,
            asX: line.asX,
            asO: line.asO,
            withdrawn: entry.state === `withdrawn`,
        };
    });
    const roundNumbers = [...new Set(pairings.map((pairing) => pairing.round))];
    const rounds = roundNumbers.map((round) => {
        const inRound = pairings.filter((pairing) => pairing.round === round);
        const seated = new Set(inRound.flatMap((pairing) => [pairing.first.key, pairing.second.key]));
        const resting = field.map((botId) => byBot.get(botId)).find((entry) => entry !== undefined && !seated.has(entry.key));
        return {
            round,
            pairings: inRound.map((pairing) => ({ first: pairing.first, second: pairing.second, games: [gameView(pairing, 0), gameView(pairing, 1)] })),
            rest: resting === undefined ? null : botOf(resting, resting.botId),
        };
    });
    const liveIds = pairings.flatMap((pairing) => pairing.gameIds.filter((gameId, index) => gameId !== null && pairing.scored.games[index]?.kind === `live`));
    return {
        ...summaryBase(row),
        startedAt: row.startedAt === null ? null : isoOf(row.startedAt),
        endedAt: row.endedAt === null ? null : isoOf(row.endedAt),
        entries: entries.map((entry) => entryView(entry, deps.presence.isOnline(entry.botId))),
        rounds,
        standings,
        live: deps.games.liveEntriesOf(liveIds.filter((gameId): gameId is string => gameId !== null)),
    };
}

function summaryBase(row: TournamentRow) {
    return {
        id: row.id,
        name: row.name,
        status: tournamentStatusSchema.parse(row.status),
        startsAt: isoOf(row.startsAt),
        timeControl: timeControlSchema.parse(JSON.parse(row.timeControl)),
        openingPlies: openingPliesSchema.parse(row.openingPlies),
        maxEntrants: row.maxEntrants,
    };
}

function summaryOf(query: Query, row: TournamentRow): TournamentSummary {
    // Once it starts, the bots that played; before, every entry.
    const counted = row.startedAt === null ? undefined : [`playing`, `withdrawn`];
    const entrants =
        query
            .select({ n: sql<number>`count(*)` })
            .from(tournamentEntries)
            .where(and(eq(tournamentEntries.tournamentId, row.id), counted === undefined ? undefined : inArray(tournamentEntries.state, counted)))
            .get()?.n ?? 0;
    let winner: TournamentSummary[`winner`] = null;
    if (row.status === `finished`) {
        const entries = entryRows(query, row.id);
        const field = entries.filter((entry) => entry.state === `playing` || entry.state === `withdrawn`).map((entry) => entry.botId);
        const top = standingsOf(field, pairingViews(query, row.id, entries).map((pairing) => pairing.scored))[0];
        const entry = entries.find((candidate) => candidate.botId === top?.bot);
        winner = entry === undefined ? null : { name: entry.bot, ownerName: entry.ownerName, ...(entry.deleted ? { deleted: true as const } : {}) };
    }
    return {
        ...summaryBase(row),
        entrants,
        winner,
        round: row.status === `running` ? roundOf(pairingViews(query, row.id, entryRows(query, row.id))) : null,
        ...(row.endedAt === null ? {} : { endedAt: isoOf(row.endedAt) }),
    };
}

// A bot in the field has a place once the pairings are drawn; one that
// never joined the field has none.
function placeOf(query: Query, row: TournamentRow, botId: string): TournamentPlace | null {
    return entryPlace(query, row, (entry) => entry.botId === botId)?.place ?? null;
}

// The owner's entry, one per owner, with the bot as the tournament names it.
function yoursOf(query: Query, row: TournamentRow, ownerId: string): TournamentYours | null {
    const found = entryPlace(query, row, (entry) => entry.ownerId === ownerId);
    return found === null ? null : { bot: found.entry.bot, ...(found.entry.deleted ? { deleted: true as const } : {}), place: found.place };
}

function entryPlace(query: Query, row: TournamentRow, wanted: (entry: EntryRow) => boolean): { entry: EntryRow; place: TournamentPlace } | null {
    const entries = entryRows(query, row.id);
    const entry = entries.find(wanted);
    if (entry === undefined) return null;
    const state = tournamentEntryStateSchema.parse(entry.state);
    const reason = entry.reason === null ? {} : { reason: tournamentEntryReasonSchema.parse(entry.reason) };
    const field = entries.filter((candidate) => candidate.state === `playing` || candidate.state === `withdrawn`).map((candidate) => candidate.botId);
    const line = field.includes(entry.botId)
        ? standingsOf(field, pairingViews(query, row.id, entries).map((pairing) => pairing.scored)).find((standing) => standing.bot === entry.botId)
        : undefined;
    return { entry, place: { state, ...reason, rank: line?.rank ?? null, points: line?.points ?? null } };
}

// The first round with a game still to finish, or the last once none has.
function roundOf(pairings: readonly PairingView[]): TournamentSummary[`round`] {
    const rounds = [...new Set(pairings.map((pairing) => pairing.round))].sort((one, two) => one - two);
    const last = rounds.at(-1);
    if (last === undefined) return null;
    const open = (round: number) =>
        pairings.some((pairing) => pairing.round === round && pairing.scored.games.some((game) => game.kind === `pending` || game.kind === `live`));
    return { current: rounds.find(open) ?? last, of: rounds.length };
}

/** One tournament as the list holds it; null for an unknown id. */
export function tournamentSummary(query: Query, id: string): TournamentSummary | null {
    const row = query.select(tournamentColumns).from(tournaments).where(eq(tournaments.id, id)).get();
    return row === undefined ? null : summaryOf(query, row);
}

/**
 * The tournament list: the running one, those waiting, and the latest over;
 * for a bot, only those it entered, each with its place; for a signed-in
 * owner, each one they entered names their bot and its place.
 */
export function tournamentList(query: Query, botId: string | null = null, ownerId: string | null = null): TournamentList {
    const all = (statuses: string[], order: `asc` | `desc`, limit: number) =>
        query
            .select(tournamentColumns)
            .from(tournaments)
            .where(
                and(
                    inArray(tournaments.status, statuses),
                    botId === null
                        ? undefined
                        : sql`${tournaments.id} in (select ${tournamentEntries.tournamentId} from ${tournamentEntries} where ${tournamentEntries.botId} = ${botId})`,
                ),
            )
            .orderBy(order === `asc` ? asc(tournaments.startsAt) : desc(sql`coalesce(${tournaments.endedAt}, ${tournaments.startsAt})`))
            .limit(limit)
            .all();
    const summary = (row: TournamentRow): TournamentSummary => {
        const place = botId === null ? null : placeOf(query, row, botId);
        const yours = ownerId === null ? null : yoursOf(query, row, ownerId);
        return { ...summaryOf(query, row), ...(place === null ? {} : { bot: place }), ...(yours === null ? {} : { yours }) };
    };
    const [running] = all([`running`], `asc`, 1);
    return {
        running: running === undefined ? null : summary(running),
        scheduled: all([`scheduled`], `asc`, tournamentWaitingCap).map(summary),
        past: all([`finished`, `called_off`, `canceled`], `desc`, tournamentListPastCap).map(summary),
    };
}

export interface TournamentApiDeps {
    query: Query;
    presence: PresenceRegistry;
    games: GameRegistry;
    limits: CredentialLimits & ClientLimits;
    now: () => number;
}

/**
 * The tournament reads, public and memoized per tournament, and the
 * owner's entry while a tournament waits.
 */
export function registerTournamentApi(app: FastifyInstance, deps: TournamentApiDeps): void {
    const { query, limits } = deps;
    const memo = new Map<string, { at: number; body: string }>();

    // Every reader of one key within the window gets the one body; a clock
    // that steps back starts a new window.
    const memoized = (key: string, build: () => string | null): string | null => {
        const now = deps.now();
        const held = memo.get(key);
        if (held !== undefined && now >= held.at && now - held.at < tournamentDetailMemoMs) return held.body;
        const body = build();
        if (body !== null) memo.set(key, { at: now, body });
        for (const [stale, entry] of memo) if (now - entry.at >= tournamentDetailMemoMs) memo.delete(stale);
        return body;
    };

    app.get(`/api/tournaments`, { config: { limit: `public` } }, async (request, reply) => {
        const parsed = tournamentListQuerySchema.safeParse(request.query);
        if (!parsed.success) return reply.code(400).send({ error: `the query fails validation`, code: `bad_request` });
        const name = parsed.data.bot;
        // The list of one bot is shared by every caller through its memo, so only the list of every bot names the caller's own.
        if (name === undefined) {
            const owner = sessionUser(query, request)?.id ?? null;
            return reply.header(`content-type`, `application/json; charset=utf-8`).send(JSON.stringify(tournamentListSchema.parse(tournamentList(query, null, owner))));
        }
        const bot = nameSyntaxSchema.safeParse(name).success
            ? query.select({ id: bots.id }).from(bots).where(and(eq(bots.nameKey, nameKeyOf(name)), isNull(bots.deletedAt))).get()
            : undefined;
        if (bot === undefined) return reply.code(404).send({ error: `no such bot`, code: `not_found` });
        // A bot's list reads the standings of every tournament it entered, so it shares the detail's window.
        const body = memoized(`bot:${bot.id}`, () => JSON.stringify(tournamentListSchema.parse(tournamentList(query, bot.id))));
        return reply.header(`content-type`, `application/json; charset=utf-8`).send(body);
    });

    app.get(`/api/tournaments/:id`, { config: { limit: `public` } }, async (request, reply) => {
        const { id } = request.params as { id: string };
        if (!tournamentIdSchema.safeParse(id).success) return reply.code(404).send({ error: `no such tournament`, code: `not_found` });
        const body = memoized(id, () => {
            const detail = tournamentDetail(query, deps, id);
            return detail === null ? null : JSON.stringify(tournamentDetailSchema.parse(detail));
        });
        if (body === null) return reply.code(404).send({ error: `no such tournament`, code: `not_found` });
        return reply.header(`content-type`, `application/json; charset=utf-8`).send(body);
    });

    app.get(`/api/tournaments/:id/export`, { config: { limit: `public` } }, async (request, reply) => {
        const { id } = request.params as { id: string };
        if (!tournamentIdSchema.safeParse(id).success) return reply.code(404).send({ error: `no such tournament`, code: `not_found` });
        if (limits.refuseExport(reply, request)) return reply;
        const detail = tournamentDetail(query, deps, id);
        if (detail === null) return reply.code(404).send({ error: `no such tournament`, code: `not_found` });
        const file = tournamentExport(query, detail, deps.now());
        return reply.header(`content-type`, `application/zip`).header(`content-disposition`, `attachment; filename="${file.fileName}"`).send(file.body);
    });

    app.put(`/api/tournaments/:id/entry`, { config: { limit: `principal` } }, async (request, reply) => {
        const user = sessionUser(query, request);
        if (user === null) return reply.code(401).send({ error: `no session`, code: `unauthorized` });
        if (limits.refuse(reply, `principal`, `user:${user.id}`)) return reply;
        const parsed = tournamentEntryRequestSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: `the request fails validation`, code: `bad_request` });
        const { id } = request.params as { id: string };
        const tournament = query.select(tournamentColumns).from(tournaments).where(eq(tournaments.id, id)).get();
        const bot = nameSyntaxSchema.safeParse(parsed.data.bot).success
            ? query
                  .select({ id: bots.id, ownerId: bots.ownerId, delistedAt: bots.delistedAt, accepts: bots.accepts })
                  .from(bots)
                  .where(and(eq(bots.nameKey, nameKeyOf(parsed.data.bot)), isNull(bots.deletedAt)))
                  .get()
            : undefined;
        if (tournament === undefined || bot === undefined) return reply.code(404).send({ error: `no such tournament or bot`, code: `not_found` });
        if (bot.ownerId !== user.id) return reply.code(403).send({ error: `the bot is someone else's`, code: `not_owner` });
        if (bot.delistedAt !== null) return reply.code(403).send({ error: `the bot is delisted`, code: `delisted` });
        if (tournament.status !== `scheduled`) return reply.code(409).send({ error: `the tournament no longer waits`, code: `closed` });
        const clock = timeControlSchema.parse(JSON.parse(tournament.timeControl));
        if (!acceptsCovers(bot.accepts === null ? undefined : acceptsSchema.parse(JSON.parse(bot.accepts)), clock)) {
            return reply.code(400).send({ error: `the bot does not accept the clock`, code: `clock_not_accepted` });
        }
        const full = query.transaction((tx) => {
            const others =
                tx
                    .select({ n: sql<number>`count(*)` })
                    .from(tournamentEntries)
                    .where(and(eq(tournamentEntries.tournamentId, id), ne(tournamentEntries.ownerId, user.id)))
                    .get()?.n ?? 0;
            if (others >= tournament.maxEntrants) return true;
            tx.delete(tournamentEntries).where(and(eq(tournamentEntries.tournamentId, id), eq(tournamentEntries.ownerId, user.id))).run();
            tx.insert(tournamentEntries).values({ tournamentId: id, botId: bot.id, ownerId: user.id, enteredAt: nowSeconds() }).run();
            return false;
        });
        if (full) return reply.code(409).send({ error: `the tournament is full`, code: `full` });
        memo.delete(id);
        const entry = entryRows(query, id).find((row) => row.botId === bot.id);
        if (entry === undefined) throw new Error(`an entry just written is gone`);
        return reply.code(200).send(entryView(entry, deps.presence.isOnline(bot.id)));
    });

    app.delete(`/api/tournaments/:id/entry`, { config: { limit: `principal` } }, async (request, reply) => {
        const user = sessionUser(query, request);
        if (user === null) return reply.code(401).send({ error: `no session`, code: `unauthorized` });
        if (limits.refuse(reply, `principal`, `user:${user.id}`)) return reply;
        const { id } = request.params as { id: string };
        const tournament = query.select({ status: tournaments.status }).from(tournaments).where(eq(tournaments.id, id)).get();
        if (tournament === undefined) return reply.code(404).send({ error: `no such tournament`, code: `not_found` });
        if (tournament.status !== `scheduled`) return reply.code(409).send({ error: `the tournament no longer waits`, code: `closed` });
        query.delete(tournamentEntries).where(and(eq(tournamentEntries.tournamentId, id), eq(tournamentEntries.ownerId, user.id))).run();
        memo.delete(id);
        return reply.code(204).send();
    });
}
