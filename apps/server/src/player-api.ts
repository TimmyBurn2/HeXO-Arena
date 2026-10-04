import {
    nameKeyOf,
    nameSyntaxSchema,
    placeholderNamePattern,
    playerOpponentsCap,
    playerPlacingsCap,
    playerRecordMemoMs,
    playerRecordSchema,
    rankableDeviation,
    ratingHistoryCap,
    ratingHistoryQuerySchema,
    ratingHistorySchema,
    type PlayerRecord,
    type RatingPoint,
    type Side,
} from '@hexo-arena/contract';
import { and, asc, desc, eq, inArray, isNull, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Query } from './db';
import { bots, gameRatings, games, tournamentEntries, tournamentPairings, tournaments, users } from './db/schema';
import type { Ladder } from './ladder';
import { activeSince } from './leaderboard-api';
import { isProvisional, type PlayerRef } from './rating';
import { readRating } from './rating-store';
import { shownBot, shownUser, type ShownName } from './shown-names';
import { standingsOf, storedSlot } from './round-robin';
import { creatorJoin, creators, nameColumns, tournamentNameOf } from './tournament-store';

const isoOf = (seconds: number) => new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/u, `Z`);

const day = 86_400;
const rangeSeconds = { '30d': 30 * day, '1y': 365 * day, all: null } as const;

interface Named extends PlayerRef {
    readonly name: string;
}

// A deleted player's placeholder names no one a reader can ask for.
function resolve(query: Query, name: string): Named | null {
    if (!nameSyntaxSchema.safeParse(name).success || placeholderNamePattern.test(nameKeyOf(name))) return null;
    const key = nameKeyOf(name);
    const user = query.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.nameKey, key), isNull(users.deletedAt))).get();
    if (user !== undefined) return { kind: `human`, ...user };
    const bot = query.select({ id: bots.id, name: bots.name }).from(bots).where(and(eq(bots.nameKey, key), isNull(bots.deletedAt))).get();
    return bot === undefined ? null : { kind: `bot`, ...bot };
}

const otherSide = sql`(case ${games.challengerSide} when 'x' then 'o' else 'x' end)`;
const otherUserSide = sql`(case ${games.userSide} when 'x' then 'o' else 'x' end)`;

// The seat columns a player can sit in, each with that seat's side and the
// opponent's column and kind.
function seatsOf(player: PlayerRef): readonly { column: SQLWrapper; side: SQLWrapper; opponent: SQLWrapper; opponentKind: PlayerRef[`kind`] }[] {
    if (player.kind === `human`) return [{ column: games.userId, side: games.userSide, opponent: games.botId, opponentKind: `bot` }];
    return [
        { column: games.botId, side: otherUserSide, opponent: games.userId, opponentKind: `human` },
        { column: games.challengerBotId, side: games.challengerSide, opponent: games.destBotId, opponentKind: `bot` },
        { column: games.destBotId, side: otherSide, opponent: games.challengerBotId, opponentKind: `bot` },
    ];
}

interface PlayedRow {
    readonly side: Side;
    readonly winner: Side | null;
    readonly reason: string;
    readonly opponent: string;
    readonly opponentKind: PlayerRef[`kind`];
    readonly finishedAt: number;
}

// The finished games a record counts: aborted and voided ones left out, as
// the rating leaves them.
const counted = sql`${games.finishedAt} is not null and ${games.finishReason} <> 'aborted' and ${games.voidedAt} is null`;

// Every counted game the player sat in against an account or a bot; a
// bot's games against guests are counted apart.
function playedRows(query: Query, player: PlayerRef): PlayedRow[] {
    const arms = seatsOf(player).map(
        (seat) =>
            sql`select ${seat.side} as side, ${games.winner} as winner, ${games.finishReason} as reason, ${seat.opponent} as opponent, ${seat.opponentKind} as opponentKind, ${games.finishedAt} as finishedAt from ${games} where ${seat.column} = ${player.id} and ${games.guestName} is null and ${counted}`,
    );
    return query.all<PlayedRow>(sql.join(arms, sql` union all `));
}

// A bot's counted games against guests: unrated, and in no other figure.
function guestRecord(query: Query, botId: string): NonNullable<PlayerRecord[`guests`]> {
    const row = query.get<{ games: number; won: number | null; lost: number | null }>(
        sql`select count(*) as games, sum(${games.winner} = ${otherUserSide}) as won, sum(${games.winner} = ${games.userSide}) as lost from ${games} where ${games.botId} = ${botId} and ${games.guestName} is not null and ${counted}`,
    );
    return { games: row.games, won: row.won ?? 0, lost: row.lost ?? 0 };
}

function opponentNames(query: Query, ids: { human: readonly string[]; bot: readonly string[] }): Map<string, ShownName> {
    const named = new Map<string, ShownName>();
    if (ids.human.length > 0) {
        for (const row of query.select({ id: users.id, name: users.name, deletedAt: users.deletedAt }).from(users).where(inArray(users.id, [...ids.human])).all()) {
            named.set(row.id, shownUser(row.name, row.deletedAt));
        }
    }
    if (ids.bot.length > 0) {
        for (const row of query.select({ id: bots.id, name: bots.name, deletedAt: bots.deletedAt }).from(bots).where(inArray(bots.id, [...ids.bot])).all()) {
            named.set(row.id, shownBot(row.name, row.deletedAt));
        }
    }
    return named;
}

// A bot's finished tournaments, newest first, with its place in each.
function placingsOf(query: Query, botId: string): NonNullable<PlayerRecord[`placings`]> {
    const rows = query
        .select({ id: tournaments.id, ...nameColumns, endedAt: tournaments.endedAt })
        .from(tournamentEntries)
        .innerJoin(tournaments, eq(tournaments.id, tournamentEntries.tournamentId))
        .leftJoin(creators, creatorJoin)
        .where(and(eq(tournamentEntries.botId, botId), eq(tournaments.status, `finished`), inArray(tournamentEntries.state, [`playing`, `withdrawn`])))
        .orderBy(desc(tournaments.endedAt))
        .limit(playerPlacingsCap)
        .all();
    return rows.flatMap((row) => {
        const field = query
            .select({ botId: tournamentEntries.botId })
            .from(tournamentEntries)
            .where(and(eq(tournamentEntries.tournamentId, row.id), inArray(tournamentEntries.state, [`playing`, `withdrawn`])))
            .all()
            .map((entry) => entry.botId);
        const pairings = query
            .select({
                round: tournamentPairings.round,
                leg: tournamentPairings.leg,
                first: tournamentPairings.firstBotId,
                second: tournamentPairings.secondBotId,
                game1: tournamentPairings.game1,
                game1Seat: tournamentPairings.game1Seat,
                game2: tournamentPairings.game2,
                game2Seat: tournamentPairings.game2Seat,
            })
            .from(tournamentPairings)
            .where(eq(tournamentPairings.tournamentId, row.id))
            .orderBy(asc(tournamentPairings.round))
            .all()
            .map((pairing) => ({
                round: pairing.round,
                leg: pairing.leg,
                first: pairing.first,
                second: pairing.second,
                games: [storedSlot(pairing.game1, pairing.game1Seat), storedSlot(pairing.game2, pairing.game2Seat)] as const,
            }));
        const line = standingsOf(field, pairings).find((standing) => standing.bot === botId);
        if (line === undefined || row.endedAt === null) return [];
        return [{ tournamentId: row.id, name: tournamentNameOf(row), rank: line.rank, entrants: field.length, points: line.points, endedAt: isoOf(row.endedAt) }];
    });
}

/** A player's record over every finished game but aborted and voided ones; null for a name no player holds. */
export function playerRecord(query: Query, ladder: Pick<Ladder, `read`>, name: string, nowMs: number): PlayerRecord | null {
    const player = resolve(query, name);
    if (player === null) return null;
    const rows = playedRows(query, player);
    const asX = { games: 0, won: 0 };
    const asO = { games: 0, won: 0 };
    const forfeits = { disconnect: 0, terminated: 0 };
    let won = 0;
    let lost = 0;
    const met = new Map<string, { kind: PlayerRef[`kind`]; games: number; won: number; lost: number }>();
    for (const row of rows) {
        const sides = row.side === `x` ? asX : asO;
        sides.games += 1;
        const opponent = met.get(row.opponent) ?? { kind: row.opponentKind, games: 0, won: 0, lost: 0 };
        opponent.games += 1;
        if (row.winner === row.side) {
            won += 1;
            sides.won += 1;
            opponent.won += 1;
        } else if (row.winner !== null) {
            lost += 1;
            opponent.lost += 1;
            if (row.reason === `disconnect`) forfeits.disconnect += 1;
            if (row.reason === `terminated`) forfeits.terminated += 1;
        }
        met.set(row.opponent, opponent);
    }
    const names = opponentNames(query, {
        human: [...met.entries()].filter(([, entry]) => entry.kind === `human`).map(([id]) => id),
        bot: [...met.entries()].filter(([, entry]) => entry.kind === `bot`).map(([id]) => id),
    });
    // Every id came from a stored game, whose seats name rows that exist.
    const shownOf = (id: string): ShownName => names.get(id) ?? { name: id };
    const mostPlayed = [...met.entries()].sort((one, two) => two[1].games - one[1].games || shownOf(one[0]).name.localeCompare(shownOf(two[0]).name)).slice(0, playerOpponentsCap);
    const rating = readRating(query, player);
    const rank = ladder.read(`all`, activeSince(nowMs)).findIndex((entry) => entry.kind === player.kind && entry.name === player.name);
    const times = rows.map((row) => row.finishedAt);
    return {
        name: player.name,
        kind: player.kind,
        rating: Math.round(rating.rating),
        deviation: Math.round(rating.deviation),
        provisional: isProvisional(rating),
        rank: rank === -1 ? null : rank + 1,
        games: rows.length,
        won,
        lost,
        undecided: rows.length - won - lost,
        asX,
        asO,
        forfeits,
        opponents: mostPlayed.map(([id, entry]) => ({ ...shownOf(id), kind: entry.kind, games: entry.games, won: entry.won, lost: entry.lost })),
        firstGameAt: times.length === 0 ? null : isoOf(Math.min(...times)),
        lastGameAt: times.length === 0 ? null : isoOf(Math.max(...times)),
        ...(player.kind === `bot` ? { placings: placingsOf(query, player.id), guests: guestRecord(query, player.id) } : {}),
    };
}

/** A player's rating after each rated game in the range, oldest first, the newest {@link ratingHistoryCap} at most. */
export function ratingHistory(query: Query, name: string, range: keyof typeof rangeSeconds, nowMs: number): RatingPoint[] | null {
    const player = resolve(query, name);
    if (player === null) return null;
    const span = rangeSeconds[range];
    const since = span === null ? null : Math.floor(nowMs / 1000) - span;
    const arms = seatsOf(player).map((seat) => {
        const conditions: SQL[] = [
            sql`${seat.column} = ${player.id}`,
            sql`${games.winner} is not null`,
            sql`${games.voidedAt} is null`,
            ...(since === null ? [] : [sql`${games.finishedAt} >= ${since}`]),
        ];
        return sql`select ${games.id} as gameId, ${games.finishSeq} as seq, ${games.finishedAt} as at, ${gameRatings.ratingAfter} as rating, ${gameRatings.deviationAfter} as deviation from ${games} join ${gameRatings} on ${gameRatings.gameId} = ${games.id} and ${gameRatings.side} = ${seat.side} where ${sql.join(conditions, sql` and `)}`;
    });
    const rows = query.all<{ gameId: string; seq: number; at: number; rating: number; deviation: number }>(
        sql`${sql.join(arms, sql` union all `)} order by seq desc limit ${ratingHistoryCap}`,
    );
    return rows.reverse().map((row) => ({ gameId: row.gameId, at: isoOf(row.at), rating: Math.round(row.rating), deviation: Math.round(row.deviation), provisional: row.deviation > rankableDeviation }));
}

const notFound = JSON.stringify({ error: `no player has that name`, code: `not_found` });

/** A read as every caller in its few seconds gets it: the value, and the answer's status and body. */
export interface PlayerAnswer<T> {
    readonly value: T | null;
    readonly status: number;
    readonly body: string;
}

function remembering<T>(now: () => number, serialize: (value: T) => string): (key: string, read: () => T | null) => PlayerAnswer<T> {
    const memo = new Map<string, { at: number; answer: PlayerAnswer<T> }>();
    return (key, read) => {
        const at = now();
        const held = memo.get(key);
        if (held !== undefined && at >= held.at && at - held.at < playerRecordMemoMs) return held.answer;
        const value = read();
        const answer = value === null ? { value, status: 404, body: notFound } : { value, status: 200, body: serialize(value) };
        memo.set(key, { at, answer });
        for (const [stale, entry] of memo) if (at - entry.at >= playerRecordMemoMs) memo.delete(stale);
        return answer;
    };
}

/** The player reads, each name's read at most once in its few seconds, whoever asks. */
export interface PlayerReads {
    record(name: string): PlayerAnswer<PlayerRecord>;
    history(name: string, range: keyof typeof rangeSeconds): PlayerAnswer<RatingPoint[]>;
}

/**
 * The player reads, memoized per name: the API and the link previews read
 * through the same memo, so a burst of either costs one read.
 */
export function createPlayerReads(deps: { query: Query; ladder: Pick<Ladder, `read`>; now: () => number }): PlayerReads {
    const records = remembering<PlayerRecord>(deps.now, (record) => JSON.stringify(playerRecordSchema.parse(record)));
    const histories = remembering<RatingPoint[]>(deps.now, (history) => JSON.stringify(ratingHistorySchema.parse(history)));
    return {
        record: (name) => records(nameKeyOf(name), () => playerRecord(deps.query, deps.ladder, name, deps.now())),
        history: (name, range) => histories(`${range} ${nameKeyOf(name)}`, () => ratingHistory(deps.query, name, range, deps.now())),
    };
}

/** The player reads, public, a deletion's placeholder answering not found. */
export function registerPlayerApi(app: FastifyInstance, deps: { reads: PlayerReads }): void {
    app.get<{ Params: { name: string } }>(`/api/players/:name`, { config: { limit: `public` } }, async (request, reply) => {
        const answer = deps.reads.record(request.params.name);
        return reply.code(answer.status).header(`content-type`, `application/json; charset=utf-8`).send(answer.body);
    });

    app.get<{ Params: { name: string } }>(`/api/players/:name/rating`, { config: { limit: `public` } }, async (request, reply) => {
        const parsed = ratingHistoryQuerySchema.safeParse(request.query);
        if (!parsed.success) return reply.code(400).send({ error: `range must be 30d, 1y, or all`, code: `bad_request` });
        const answer = deps.reads.history(request.params.name, parsed.data.range);
        return reply.code(answer.status).header(`content-type`, `application/json; charset=utf-8`).send(answer.body);
    });
}
