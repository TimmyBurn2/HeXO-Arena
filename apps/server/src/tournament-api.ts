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
    tournamentListSchema,
    tournamentStatusSchema,
    type TournamentDetail,
    type TournamentEntry,
    type TournamentGame,
    type TournamentList,
    type TournamentSummary,
} from '@hexo-arena/contract';
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { nowSeconds, type Query } from './db';
import { bots, games, tournamentEntries, tournamentPairings, tournaments, users } from './db/schema';
import type { GameRegistry } from './game-registry';
import type { PresenceRegistry } from './presence';
import type { CredentialLimits } from './request-limits';
import { pointOf, standingsOf, storedSlot, xSeatOf, type PairingSeat, type ScoredPairing } from './round-robin';
import { sessionUser } from './sessions';

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
    readonly bot: string;
    readonly ownerName: string;
    readonly state: string;
    readonly reason: string | null;
    readonly ratingAtStart: number | null;
}

function entryRows(query: Query, tournamentId: string): EntryRow[] {
    return query
        .select({
            botId: tournamentEntries.botId,
            bot: bots.name,
            ownerName: users.name,
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
}

// The checks admit only the contract's states and reasons.
function entryView(row: EntryRow, online: boolean): TournamentEntry {
    return {
        bot: row.bot,
        ownerName: row.ownerName,
        online,
        ratingAtStart: row.ratingAtStart === null ? null : Math.round(row.ratingAtStart),
        state: tournamentEntryStateSchema.parse(row.state),
        ...(row.reason === null ? {} : { reason: tournamentEntryReasonSchema.parse(row.reason) }),
    };
}

interface PairingView {
    readonly round: number;
    readonly first: string;
    readonly second: string;
    readonly scored: ScoredPairing;
    readonly gameIds: readonly [string | null, string | null];
}

function pairingViews(query: Query, tournamentId: string): PairingView[] {
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
    const names = new Map(
        query
            .select({ id: bots.id, name: bots.name })
            .from(bots)
            .where(inArray(bots.id, [...new Set(rows.flatMap((row) => [row.firstBotId, row.secondBotId]))]))
            .all()
            .map((row) => [row.id, row.name]),
    );
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
        first: names.get(row.firstBotId) ?? row.firstBotId,
        second: names.get(row.secondBotId) ?? row.secondBotId,
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
    const seatName = (seat: PairingSeat) => (seat === `first` ? pairing.first : pairing.second);
    const point = pointOf(result);
    const absent = result.kind === `no_show` ? result.missing : result.kind === `forfeit` ? result.withdrawn : null;
    return {
        x: seatName(xSeatOf(index === 0 ? 1 : 2)),
        gameId: pairing.gameIds[index],
        outcome: result.kind,
        point: point === null ? null : seatName(point),
        missing: absent === null ? [] : absent === `both` ? [pairing.first, pairing.second] : [seatName(absent)],
    };
}

/** A tournament as its page reads it; null for an unknown id. */
export function tournamentDetail(query: Query, deps: { presence: PresenceRegistry; games: GameRegistry }, id: string): TournamentDetail | null {
    const row = query.select(tournamentColumns).from(tournaments).where(eq(tournaments.id, id)).get();
    if (row === undefined) return null;
    const entries = entryRows(query, id);
    const pairings = pairingViews(query, id);
    const nameOf = new Map(entries.map((entry) => [entry.botId, entry]));
    const field = entries.filter((entry) => entry.state === `playing` || entry.state === `withdrawn`).map((entry) => entry.botId);
    const standings = standingsOf(
        field,
        pairings.map((pairing) => pairing.scored),
    ).map((line) => {
        const entry = nameOf.get(line.bot);
        return {
            rank: line.rank,
            bot: entry?.bot ?? line.bot,
            ownerName: entry?.ownerName ?? ``,
            points: line.points,
            asX: line.asX,
            asO: line.asO,
            withdrawn: entry?.state === `withdrawn`,
        };
    });
    const roundNumbers = [...new Set(pairings.map((pairing) => pairing.round))];
    const fieldNames = field.map((botId) => nameOf.get(botId)?.bot ?? botId);
    const rounds = roundNumbers.map((round) => {
        const inRound = pairings.filter((pairing) => pairing.round === round);
        const seated = new Set(inRound.flatMap((pairing) => [pairing.first, pairing.second]));
        return {
            round,
            pairings: inRound.map((pairing) => ({ first: pairing.first, second: pairing.second, games: [gameView(pairing, 0), gameView(pairing, 1)] })),
            rest: fieldNames.find((name) => !seated.has(name)) ?? null,
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
        const top = standingsOf(field, pairingViews(query, row.id).map((pairing) => pairing.scored))[0];
        const entry = entries.find((candidate) => candidate.botId === top?.bot);
        winner = entry === undefined ? null : { name: entry.bot, ownerName: entry.ownerName };
    }
    return { ...summaryBase(row), entrants, winner };
}

/** One tournament as the list holds it; null for an unknown id. */
export function tournamentSummary(query: Query, id: string): TournamentSummary | null {
    const row = query.select(tournamentColumns).from(tournaments).where(eq(tournaments.id, id)).get();
    return row === undefined ? null : summaryOf(query, row);
}

/** The tournament list: the running one, those waiting, and the latest over. */
export function tournamentList(query: Query): TournamentList {
    const all = (statuses: string[], order: `asc` | `desc`, limit: number) =>
        query
            .select(tournamentColumns)
            .from(tournaments)
            .where(inArray(tournaments.status, statuses))
            .orderBy(order === `asc` ? asc(tournaments.startsAt) : desc(sql`coalesce(${tournaments.endedAt}, ${tournaments.startsAt})`))
            .limit(limit)
            .all();
    const [running] = all([`running`], `asc`, 1);
    return {
        running: running === undefined ? null : summaryOf(query, running),
        scheduled: all([`scheduled`], `asc`, 3).map((row) => summaryOf(query, row)),
        past: all([`finished`, `called_off`, `canceled`], `desc`, tournamentListPastCap).map((row) => summaryOf(query, row)),
    };
}

export interface TournamentApiDeps {
    query: Query;
    presence: PresenceRegistry;
    games: GameRegistry;
    limits: CredentialLimits;
    now: () => number;
}

/**
 * The tournament reads, public and memoized per tournament, and the
 * owner's entry while a tournament waits.
 */
export function registerTournamentApi(app: FastifyInstance, deps: TournamentApiDeps): void {
    const { query, limits } = deps;
    const memo = new Map<string, { at: number; body: string }>();

    app.get(`/api/tournaments`, { config: { limit: `public` } }, async (_request, reply) => {
        return reply.header(`content-type`, `application/json; charset=utf-8`).send(JSON.stringify(tournamentListSchema.parse(tournamentList(query))));
    });

    app.get(`/api/tournaments/:id`, { config: { limit: `public` } }, async (request, reply) => {
        const { id } = request.params as { id: string };
        if (!tournamentIdSchema.safeParse(id).success) return reply.code(404).send({ error: `no such tournament`, code: `not_found` });
        const now = deps.now();
        let held = memo.get(id);
        // A clock that steps back starts a new window.
        if (held === undefined || now < held.at || now - held.at >= tournamentDetailMemoMs) {
            const detail = tournamentDetail(query, deps, id);
            if (detail === null) return reply.code(404).send({ error: `no such tournament`, code: `not_found` });
            held = { at: now, body: JSON.stringify(tournamentDetailSchema.parse(detail)) };
            memo.set(id, held);
            for (const [key, entry] of memo) if (now - entry.at >= tournamentDetailMemoMs) memo.delete(key);
        }
        return reply.header(`content-type`, `application/json; charset=utf-8`).send(held.body);
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
