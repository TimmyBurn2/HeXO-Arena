import {
    boardCellSchema,
    finishedGamesMemoMs,
    finishedGamesPageCap,
    finishedGamesPageSchema,
    finishedGamesPageSize,
    finishedGamesPath,
    finishedGamesQuerySchema,
    nameKeyOf,
    nameSyntaxSchema,
    placeholderNamePattern,
    rankableDeviation,
    timeControlSchema,
    turnsOnBoard,
    type FinishReason,
    type FinishedGameEntry,
    type FinishedGamesPage,
    type FinishedGamesQuery,
    type GamePlayer,
    type OpeningPlies,
    type Side,
} from '@hexo-arena/contract';
import { and, desc, eq, inArray, isNotNull, isNull, lt, lte, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { FastifyInstance } from 'fastify';
import type { Query } from './db';
import { bots, gameRatings, games, moves, users } from './db/schema';
import type { PlayerRef } from './rating';

// A page reads one row past its size, which says whether another follows.
const readAhead = finishedGamesPageSize + 1;

// Distinct queries remembered at once; past it the oldest leaves first.
const memoCap = 500;

type Filters = Omit<FinishedGamesQuery, `player` | `vs` | `cursor`>;

// A before date as the page reads it: the instant, and the latest finish ahead of it.
interface Bound {
    readonly at: number;
    readonly seq: number;
}

/** A query with its names resolved: what the page reads, or an unknown name. */
type Resolved =
    | { kind: `unknown` }
    | { kind: `page`; player: PlayerRef | null; vs: PlayerRef | null; filters: Filters; page: number; below: number | null };

// A deleted player's placeholder names no one a reader can ask for.
function resolveName(query: Query, name: string): PlayerRef | null {
    if (!nameSyntaxSchema.safeParse(name).success || placeholderNamePattern.test(nameKeyOf(name))) return null;
    const key = nameKeyOf(name);
    const user = query.select({ id: users.id }).from(users).where(and(eq(users.nameKey, key), isNull(users.deletedAt))).get();
    if (user !== undefined) return { kind: `human`, id: user.id };
    const bot = query.select({ id: bots.id }).from(bots).where(and(eq(bots.nameKey, key), isNull(bots.deletedAt))).get();
    return bot === undefined ? null : { kind: `bot`, id: bot.id };
}

function resolve(query: Query, request: FinishedGamesQuery): Resolved {
    const { player: playerName, vs: vsName, cursor, ...filters } = request;
    const player = playerName === undefined ? null : resolveName(query, playerName);
    const vs = vsName === undefined ? null : resolveName(query, vsName);
    if ((playerName !== undefined && player === null) || (vsName !== undefined && vs === null)) return { kind: `unknown` };
    if (cursor === undefined) return { kind: `page`, player, vs, filters, page: 1, below: null };
    // The cursor schema admits only a page number, a dot, and a finish number.
    const [page = 1, below = 0] = cursor.split(`.`).map(Number);
    return { kind: `page`, player, vs, filters, page, below };
}

const otherSide = sql`(case ${games.challengerSide} when 'x' then 'o' else 'x' end)`;
const otherUserSide = sql`(case ${games.userSide} when 'x' then 'o' else 'x' end)`;

// One seat column a player can sit in, with that seat's side and the
// opponent's column: a human sits in user_id; a bot in bot_id against a
// human, and as challenger or challenged against a bot.
interface Seat {
    readonly column: SQLWrapper;
    readonly side: SQLWrapper;
    readonly opponent: SQLWrapper;
    readonly opponentKind: PlayerRef[`kind`];
}

function seatsOf(player: PlayerRef): readonly Seat[] {
    if (player.kind === `human`) return [{ column: games.userId, side: games.userSide, opponent: games.botId, opponentKind: `bot` }];
    return [
        { column: games.botId, side: otherUserSide, opponent: games.userId, opponentKind: `human` },
        { column: games.challengerBotId, side: games.challengerSide, opponent: games.destBotId, opponentKind: `bot` },
        { column: games.destBotId, side: otherSide, opponent: games.challengerBotId, opponentKind: `bot` },
    ];
}

// The conditions every arm shares; the clock and opening expressions are
// written as their indexes are, or the planner would not match them.
function shared(filters: Filters, below: number | null, before: Bound | null): (SQL | undefined)[] {
    return [
        isNotNull(games.finishSeq),
        below === null ? undefined : lt(games.finishSeq, below),
        before === null ? undefined : and(lte(games.finishSeq, before.seq), lt(games.finishedAt, before.at)),
        filters.kind === `human-bot` ? isNotNull(games.userId) : filters.kind === `bot-bot` ? isNotNull(games.challengerBotId) : undefined,
        filters.result === `none` ? isNull(games.winner) : undefined,
        filters.reason === undefined ? undefined : eq(games.finishReason, filters.reason),
        filters.clock === undefined ? undefined : sql`${games.timeControl} ->> '$.mode' = ${filters.clock}`,
        filters.opening === undefined ? undefined : sql`json_array_length(${games.openingCells}) = ${Number(filters.opening)}`,
    ];
}

function seatConditions(seat: Seat, player: PlayerRef, vs: PlayerRef | null, filters: Filters): (SQL | undefined)[] {
    return [
        sql`${seat.column} = ${player.id}`,
        vs === null ? undefined : sql`${seat.opponent} = ${vs.id}`,
        filters.side === undefined ? undefined : sql`${seat.side} = ${filters.side}`,
        filters.result === `won` ? sql`${games.winner} = ${seat.side}` : undefined,
        filters.result === `lost` ? and(isNotNull(games.winner), sql`${games.winner} <> ${seat.side}`) : undefined,
    ];
}

/**
 * The page query: one arm per seat the player can hold, each walking its
 * own index newest first and stopping one row past a page, merged in
 * finish order.
 * Answers null when the filters can match nothing.
 */
function pageQuery(query: Query, resolved: Extract<Resolved, { kind: `page` }>, before: Bound | null): SQL | null {
    const { player, vs, filters } = resolved;
    const common = shared(filters, resolved.below, before);
    const arm = (conditions: (SQL | undefined)[]) =>
        query
            .select({ id: games.id, seq: sql<number>`${games.finishSeq}`.as(`seq`) })
            .from(games)
            .where(and(...common, ...conditions))
            .orderBy(desc(games.finishSeq))
            .limit(readAhead);
    // An embedded select renders in parentheses, which only a FROM takes.
    if (player === null) return sql`select id, seq from ${arm([])}`;
    const arms = seatsOf(player)
        .filter((seat) => vs === null || seat.opponentKind === vs.kind)
        .map((seat) => sql`select id, seq from ${arm(seatConditions(seat, player, vs, filters))}`);
    if (arms.length === 0) return null;
    return sql`${sql.join(arms, sql` union all `)} order by seq desc limit ${readAhead}`;
}

// The latest finish before the date, so the page seeks below it at once
// instead of walking the newer games.
function beforeBound(query: Query, date: string | undefined): Bound | null | `none` {
    if (date === undefined) return null;
    const at = Date.parse(`${date}T00:00:00Z`) / 1000;
    const latest = query
        .select({ seq: games.finishSeq })
        .from(games)
        .where(and(isNotNull(games.finishSeq), lt(games.finishedAt, at)))
        .orderBy(desc(games.finishedAt))
        .limit(1)
        .get();
    return latest === undefined || latest.seq === null ? `none` : { at, seq: latest.seq };
}

const challengerBots = alias(bots, `challenger_bot`);
const destBots = alias(bots, `dest_bot`);
const xRatings = alias(gameRatings, `x_rating`);
const oRatings = alias(gameRatings, `o_rating`);

function seatOf(name: string, kind: GamePlayer[`kind`], before: number | null, deviation: number | null): GamePlayer {
    return {
        name,
        kind,
        rating: before === null ? null : Math.round(before),
        provisional: deviation !== null && deviation > rankableDeviation,
    };
}

function entriesOf(query: Query, ids: readonly string[]): FinishedGameEntry[] {
    if (ids.length === 0) return [];
    const rows = query
        .select({
            id: games.id,
            userName: users.name,
            botName: bots.name,
            userSide: games.userSide,
            challengerName: challengerBots.name,
            destName: destBots.name,
            challengerSide: games.challengerSide,
            timeControl: games.timeControl,
            openingCells: games.openingCells,
            winner: games.winner,
            finishReason: games.finishReason,
            finishedAt: games.finishedAt,
            finishSeq: games.finishSeq,
            voidedAt: games.voidedAt,
            moves: sql<number>`(select count(*) from ${moves} where ${moves.gameId} = ${games.id})`,
            xBefore: xRatings.ratingBefore,
            xDeviation: xRatings.deviationAfter,
            oBefore: oRatings.ratingBefore,
            oDeviation: oRatings.deviationAfter,
        })
        .from(games)
        .leftJoin(users, eq(games.userId, users.id))
        .leftJoin(bots, eq(games.botId, bots.id))
        .leftJoin(challengerBots, eq(games.challengerBotId, challengerBots.id))
        .leftJoin(destBots, eq(games.destBotId, destBots.id))
        .leftJoin(xRatings, and(eq(xRatings.gameId, games.id), eq(xRatings.side, `x`)))
        .leftJoin(oRatings, and(eq(oRatings.gameId, games.id), eq(oRatings.side, `o`)))
        .where(inArray(games.id, [...ids]))
        .orderBy(desc(games.finishSeq))
        .all();
    return rows.map((row): FinishedGameEntry => {
        // The seats, side, winner, and reason checks admit only these values,
        // and a page lists finished games alone.
        const winner = row.winner as Side | null;
        const reason = row.finishReason as FinishReason;
        const seats: Record<Side, { name: string; kind: GamePlayer[`kind`] }> | null =
            row.userName !== null && row.botName !== null && row.userSide !== null
                ? row.userSide === `x`
                    ? { x: { name: row.userName, kind: `user` }, o: { name: row.botName, kind: `bot` } }
                    : { x: { name: row.botName, kind: `bot` }, o: { name: row.userName, kind: `user` } }
                : row.challengerName !== null && row.destName !== null && row.challengerSide !== null
                  ? row.challengerSide === `x`
                      ? { x: { name: row.challengerName, kind: `bot` }, o: { name: row.destName, kind: `bot` } }
                      : { x: { name: row.destName, kind: `bot` }, o: { name: row.challengerName, kind: `bot` } }
                  : null;
        if (seats === null || row.finishedAt === null) throw new Error(`stored game row seats nobody or never finished: ${row.id}`);
        const openingPlies = boardCellSchema.array().parse(JSON.parse(row.openingCells)).length;
        return {
            gameId: row.id,
            players: {
                x: seatOf(seats.x.name, seats.x.kind, row.xBefore, row.xDeviation),
                o: seatOf(seats.o.name, seats.o.kind, row.oBefore, row.oDeviation),
            },
            winner,
            reason,
            timeControl: timeControlSchema.parse(JSON.parse(row.timeControl)),
            // The opening checks admit only the odd counts from one to nine.
            openingPlies: openingPlies as OpeningPlies,
            turns: turnsOnBoard(openingPlies) + row.moves,
            finishedAt: new Date(row.finishedAt * 1000).toISOString().replace(/\.\d{3}Z$/u, `Z`),
            rated: winner !== null && row.voidedAt === null,
        };
    });
}

/**
 * One page of finished games for a parsed query, or `unknown` when a name
 * in it matches no player.
 */
export function listFinishedGames(query: Query, request: FinishedGamesQuery): FinishedGamesPage | `unknown` {
    const resolved = resolve(query, request);
    if (resolved.kind === `unknown`) return `unknown`;
    const empty: FinishedGamesPage = { games: [], next: null, page: resolved.page };
    const before = beforeBound(query, resolved.filters.before);
    if (before === `none`) return empty;
    const statement = pageQuery(query, resolved, before);
    if (statement === null) return empty;
    const rows = query.all<{ id: string; seq: number }>(statement);
    const shown = rows.slice(0, finishedGamesPageSize);
    const last = shown.at(-1);
    const more = rows.length > finishedGamesPageSize && resolved.page < finishedGamesPageCap && last !== undefined;
    return {
        games: entriesOf(query, shown.map((row) => row.id)),
        next: more ? `${String(resolved.page + 1)}.${String(last.seq)}` : null,
        page: resolved.page,
    };
}

/**
 * The query plans a parsed query's reads run on, for the test that holds
 * every filter to an index.
 */
export function explainFinishedGames(query: Query, request: FinishedGamesQuery): string[] {
    const resolved = resolve(query, request);
    if (resolved.kind === `unknown`) throw new Error(`a name in the query matches no player`);
    const plans: string[] = [];
    const explain = (statement: SQL) => {
        for (const row of query.all<{ detail: string }>(sql`explain query plan ${statement}`)) plans.push(row.detail);
    };
    if (resolved.filters.before !== undefined) {
        const at = Date.parse(`${resolved.filters.before}T00:00:00Z`) / 1000;
        explain(sql`select seq from ${query.select({ seq: sql<number>`${games.finishSeq}`.as(`seq`) }).from(games).where(and(isNotNull(games.finishSeq), lt(games.finishedAt, at))).orderBy(desc(games.finishedAt)).limit(1)}`);
    }
    const before = resolved.filters.before === undefined ? null : { at: 0, seq: 0 };
    const statement = pageQuery(query, resolved, before);
    if (statement !== null) explain(statement);
    return plans;
}

/**
 * The finished-games read: public, memoized per distinct query, the names
 * in the key folded so every spelling of one query shares its body.
 */
export function registerFinishedGamesApi(app: FastifyInstance, deps: { query: Query; now: () => number }): void {
    const memo = new Map<string, { at: number; status: number; body: string }>();

    app.get(finishedGamesPath, { config: { limit: `public` } }, async (request, reply) => {
        const parsed = finishedGamesQuerySchema.safeParse(request.query);
        if (!parsed.success) return reply.code(400).send({ error: `the query fails validation`, code: `bad_request` });
        const { player, vs, ...rest } = parsed.data;
        const key = JSON.stringify({ ...rest, player: player === undefined ? null : nameKeyOf(player), vs: vs === undefined ? null : nameKeyOf(vs) });
        const now = deps.now();
        let held = memo.get(key);
        // A clock that steps back starts a new window.
        if (held === undefined || now < held.at || now - held.at >= finishedGamesMemoMs) {
            const page = listFinishedGames(deps.query, parsed.data);
            held =
                page === `unknown`
                    ? { at: now, status: 404, body: JSON.stringify({ error: `no player has that name`, code: `not_found` }) }
                    : { at: now, status: 200, body: JSON.stringify(finishedGamesPageSchema.parse(page)) };
            memo.delete(key);
            memo.set(key, held);
            for (const [stale, entry] of memo) {
                if (memo.size <= memoCap && now - entry.at < finishedGamesMemoMs) break;
                memo.delete(stale);
            }
        }
        return reply.code(held.status).header(`content-type`, `application/json; charset=utf-8`).send(held.body);
    });
}
