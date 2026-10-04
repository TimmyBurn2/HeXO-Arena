import { analyzedGame, doneCounts } from './analysis-store';
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
    type FinishedGamesRecord,
    type GamePlayer,
    type OpeningPlies,
    type SeatLevel,
    type Side,
} from '@hexo-arena/contract';
import { and, desc, eq, inArray, isNotNull, isNull, lt, lte, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { FastifyInstance } from 'fastify';
import type { Query } from './db';
import { bots, duels, gameRatings, games, moves, tournamentPairings, tournaments, users } from './db/schema';
import { seatLevelsOf } from './game-store';
import type { PlayerRef } from './rating';
import { ratesSomebody } from './rating-store';
import { shownBot, shownUser, type ShownName } from './shown-names';

// Distinct queries remembered at once; past it the oldest leaves first.
const memoCap = 500;

type Filters = Omit<FinishedGamesQuery, `player` | `vs` | `page`>;

// A before date as the page reads it: the instant, and the latest finish ahead of it.
interface Bound {
    readonly at: number;
    readonly seq: number;
}

/** A query with its names resolved: what the page reads, or an unknown name. */
type Resolved = { kind: `unknown` } | { kind: `page`; player: PlayerRef | null; vs: PlayerRef | null; filters: Filters; page: number };

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
    const { player: playerName, vs: vsName, page, ...filters } = request;
    const player = playerName === undefined ? null : resolveName(query, playerName);
    const vs = vsName === undefined ? null : resolveName(query, vsName);
    if ((playerName !== undefined && player === null) || (vsName !== undefined && vs === null)) return { kind: `unknown` };
    return { kind: `page`, player, vs, filters, page: page === undefined ? 1 : Number(page) };
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

// Each kind reads through its own partial index.
function kindFilter(kind: Filters[`kind`]): SQL | undefined {
    switch (kind) {
        case `human-bot`:
            return isNotNull(games.userId);
        case `guest-bot`:
            return isNotNull(games.guestName);
        case `bot-bot`:
            return isNotNull(games.challengerBotId);
        case undefined:
            return undefined;
    }
}

// Each event reads through its own partial index, written as the index writes it.
function eventFilter(event: Filters[`event`]): SQL | undefined {
    switch (event) {
        case `duel`:
            return sql`${games.duelId} is not null`;
        case `tournament`:
            return sql`${games.pairingId} is not null`;
        case `none`:
            return sql`+${games.duelId} is null and +${games.pairingId} is null`;
        case undefined:
            return undefined;
    }
}

// Tests are left out unless asked. With nothing else to narrow the list,
// the term is written as the partial index of the games shown writes it,
// a literal the planner can match; beside a filter with an index of its own,
// the unary plus keeps the term from matching, so that filter's index is read.
function testsLeftOut(filters: Filters, named: boolean): SQL | undefined {
    if (filters.tests !== undefined) return undefined;
    const narrowed =
        named || [filters.kind, filters.event, filters.result, filters.reason, filters.clock, filters.opening, filters.before, filters.analyzed].some((value) => value !== undefined);
    return narrowed ? sql`+${games.test} = 0` : sql`${games.test} = 0`;
}

// The conditions every arm shares; the clock and opening expressions are
// written as their indexes are, or the planner would not match them.
function shared(filters: Filters, before: Bound | null, named: boolean): (SQL | undefined)[] {
    return [
        isNotNull(games.finishSeq),
        before === null ? undefined : and(lte(games.finishSeq, before.seq), lt(games.finishedAt, before.at)),
        kindFilter(filters.kind),
        eventFilter(filters.event),
        filters.result === `none` ? isNull(games.winner) : undefined,
        filters.reason === undefined ? undefined : eq(games.finishReason, filters.reason),
        filters.clock === undefined ? undefined : sql`${games.timeControl} ->> '$.mode' = ${filters.clock}`,
        filters.opening === undefined ? undefined : sql`json_array_length(${games.openingCells}) = ${Number(filters.opening)}`,
        filters.analyzed === undefined ? undefined : analyzedGame,
        testsLeftOut(filters, named),
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

// The arms a named player's games read, one per seat the player can
// hold, against an opponent's kind when one is named; none when the two
// can never have met.
function seatArms(resolved: Extract<Resolved, { kind: `page` }>, player: PlayerRef): Seat[] {
    return seatsOf(player).filter((seat) => resolved.vs === null || seat.opponentKind === resolved.vs.kind);
}

/**
 * The page query: one arm per seat the player can hold, each walking its
 * own index newest first and stopping at the page's last row, merged in
 * finish order and offset to the page.
 * The cap keeps every arm's walk within its first pages.
 * Answers null when the filters can match nothing.
 */
function pageQuery(query: Query, resolved: Extract<Resolved, { kind: `page` }>, before: Bound | null): SQL | null {
    const { player, vs, filters, page } = resolved;
    const common = shared(filters, before, player !== null);
    const skipped = (page - 1) * finishedGamesPageSize;
    const arm = (conditions: (SQL | undefined)[], limit: number) =>
        query
            .select({ id: games.id, seq: sql<number>`${games.finishSeq}`.as(`seq`) })
            .from(games)
            .where(and(...common, ...conditions))
            .orderBy(desc(games.finishSeq))
            .limit(limit);
    // An embedded select renders in parentheses, which only a FROM takes.
    if (player === null) return sql`select id, seq from ${arm([], finishedGamesPageSize).offset(skipped)}`;
    const arms = seatArms(resolved, player).map((seat) => sql`select id, seq from ${arm(seatConditions(seat, player, vs, filters), skipped + finishedGamesPageSize)}`);
    if (arms.length === 0) return null;
    return sql`${sql.join(arms, sql` union all `)} order by seq desc limit ${finishedGamesPageSize} offset ${skipped}`;
}

/**
 * Every game the filters select when no player is named, counted through
 * the same index the page walks.
 * A named player's total is their record's games and voided ones.
 */
function totalQuery(query: Query, resolved: Extract<Resolved, { kind: `page` }>, before: Bound | null): SQL {
    return sql`select count(*) as total from ${query.select({ id: games.id }).from(games).where(and(...shared(resolved.filters, before, false)))}`;
}

const noRecord: FinishedGamesRecord = {
    games: 0,
    won: 0,
    lost: 0,
    undecided: 0,
    voided: 0,
    asX: { games: 0, won: 0, lost: 0 },
    asO: { games: 0, won: 0, lost: 0 },
};

/**
 * The count behind a named player's record: the page's own arms without
 * their cursor or limit, summed by the side the player sat in one pass,
 * so nothing is sorted; a voided game counts as voided alone.
 * Answers null when the filters can match nothing.
 */
function recordQuery(query: Query, resolved: Extract<Resolved, { kind: `page` }>, player: PlayerRef, before: Bound | null): SQL | null {
    const { vs, filters } = resolved;
    const common = shared(filters, before, true);
    const arms = seatArms(resolved, player)
        .map((seat) => {
            const arm = query
                .select({ side: sql<Side>`${seat.side}`.as(`side`), winner: games.winner, voided: sql<number>`${games.voidedAt} is not null`.as(`voided`) })
                .from(games)
                .where(and(...common, ...seatConditions(seat, player, vs, filters)));
            return sql`select side, winner, voided from ${arm}`;
        });
    if (arms.length === 0) return null;
    const counts = ([`x`, `o`] as const).map(
        (side) =>
            sql`coalesce(sum(not voided and side = ${side}), 0) as ${sql.raw(`${side}_games`)}, coalesce(sum(not voided and side = ${side} and winner = side), 0) as ${sql.raw(`${side}_won`)}, coalesce(sum(not voided and side = ${side} and winner <> side), 0) as ${sql.raw(`${side}_lost`)}`,
    );
    return sql`select ${sql.join(counts, sql`, `)}, coalesce(sum(voided), 0) as voided from (${sql.join(arms, sql` union all `)})`;
}

interface RecordRow {
    readonly voided: number;
    readonly x_games: number;
    readonly x_won: number;
    readonly x_lost: number;
    readonly o_games: number;
    readonly o_won: number;
    readonly o_lost: number;
}

/** The named player's record over every game the filters select, whatever page the cursor names. */
function recordOf(query: Query, resolved: Extract<Resolved, { kind: `page` }>, player: PlayerRef, before: Bound | null): FinishedGamesRecord {
    const statement = recordQuery(query, resolved, player, before);
    if (statement === null) return noRecord;
    // An aggregate with no grouping answers exactly one row.
    const row = query.get<RecordRow>(statement);
    const asX = { games: row.x_games, won: row.x_won, lost: row.x_lost };
    const asO = { games: row.o_games, won: row.o_won, lost: row.o_lost };
    const total = asX.games + asO.games;
    const won = asX.won + asO.won;
    const lost = asX.lost + asO.lost;
    return { games: total, won, lost, undecided: total - won - lost, voided: row.voided, asX, asO };
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

// A game that rates nobody keeps no rating rows, so its seats read none.
function seatOf(shown: ShownName, kind: GamePlayer[`kind`], before: number | null, deviation: number | null, level: SeatLevel | null): GamePlayer {
    return {
        ...shown,
        kind,
        rating: before === null ? null : Math.round(before),
        provisional: deviation !== null && deviation > rankableDeviation,
        ...(level === null ? {} : { level }),
    };
}

/** Finished games by id as the history lists them, newest first. */
export function finishedEntriesOf(query: Query, ids: readonly string[]): FinishedGameEntry[] {
    if (ids.length === 0) return [];
    const rows = query
        .select({
            id: games.id,
            userName: users.name,
            userDeletedAt: users.deletedAt,
            guestName: games.guestName,
            botName: bots.name,
            botDeletedAt: bots.deletedAt,
            userSide: games.userSide,
            challengerName: challengerBots.name,
            challengerDeletedAt: challengerBots.deletedAt,
            destName: destBots.name,
            destDeletedAt: destBots.deletedAt,
            challengerSide: games.challengerSide,
            xLevel: games.xLevel,
            oLevel: games.oLevel,
            unratedByChoice: games.unratedByChoice,
            timeControl: games.timeControl,
            openingCells: games.openingCells,
            winner: games.winner,
            finishReason: games.finishReason,
            finishedAt: games.finishedAt,
            finishSeq: games.finishSeq,
            voidedAt: games.voidedAt,
            duelId: games.duelId,
            duelGame: games.duelGame,
            duelGames: duels.games,
            tournamentId: tournaments.id,
            tournamentName: tournaments.name,
            tournamentRound: tournamentPairings.round,
            pairingGame: games.pairingGame,
            test: games.test,
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
        .leftJoin(duels, eq(duels.id, games.duelId))
        .leftJoin(tournamentPairings, eq(tournamentPairings.id, games.pairingId))
        .leftJoin(tournaments, eq(tournaments.id, tournamentPairings.tournamentId))
        .leftJoin(xRatings, and(eq(xRatings.gameId, games.id), eq(xRatings.side, `x`)))
        .leftJoin(oRatings, and(eq(oRatings.gameId, games.id), eq(oRatings.side, `o`)))
        .where(inArray(games.id, [...ids]))
        .orderBy(desc(games.finishSeq))
        .all();
    const analyzed = doneCounts(query, ids);
    return rows.map((row): FinishedGameEntry => {
        // The seats, side, winner, and reason checks admit only these values,
        // and a page lists finished games alone.
        const winner = row.winner as Side | null;
        const reason = row.finishReason as FinishReason;
        type Seat = { shown: ShownName; kind: GamePlayer[`kind`] };
        const seated = (firstSide: string, first: Seat, second: Seat): Record<Side, Seat> =>
            firstSide === `x` ? { x: first, o: second } : { x: second, o: first };
        const human: Seat | null =
            row.userName !== null
                ? { shown: shownUser(row.userName, row.userDeletedAt), kind: `user` }
                : row.guestName !== null
                  ? { shown: { name: row.guestName }, kind: `guest` }
                  : null;
        const seats: Record<Side, Seat> | null =
            human !== null && row.botName !== null && row.userSide !== null
                ? seated(row.userSide, human, { shown: shownBot(row.botName, row.botDeletedAt), kind: `bot` })
                : row.challengerName !== null && row.destName !== null && row.challengerSide !== null
                  ? seated(
                        row.challengerSide,
                        { shown: shownBot(row.challengerName, row.challengerDeletedAt), kind: `bot` },
                        { shown: shownBot(row.destName, row.destDeletedAt), kind: `bot` },
                    )
                  : null;
        if (seats === null || row.finishedAt === null) throw new Error(`stored game row seats nobody or never finished: ${row.id}`);
        const openingPlies = boardCellSchema.array().parse(JSON.parse(row.openingCells)).length;
        const levels = seatLevelsOf(row);
        return {
            gameId: row.id,
            players: {
                x: seatOf(seats.x.shown, seats.x.kind, row.xBefore, row.xDeviation, levels.x),
                o: seatOf(seats.o.shown, seats.o.kind, row.oBefore, row.oDeviation, levels.o),
            },
            winner,
            reason,
            timeControl: timeControlSchema.parse(JSON.parse(row.timeControl)),
            // The opening checks admit only the odd counts from one to nine.
            openingPlies: openingPlies as OpeningPlies,
            turns: turnsOnBoard(openingPlies) + row.moves,
            finishedAt: new Date(row.finishedAt * 1000).toISOString().replace(/\.\d{3}Z$/u, `Z`),
            rated: winner !== null && row.voidedAt === null && ratesSomebody(row),
            voided: row.voidedAt !== null,
            ...(row.unratedByChoice === 1 ? { unratedByChoice: true } : {}),
            ...(row.test === 1 ? { test: true as const } : {}),
            ...(row.tournamentId === null || row.tournamentName === null || row.tournamentRound === null || (row.pairingGame !== 1 && row.pairingGame !== 2)
                ? {}
                : { tournament: { id: row.tournamentId, name: row.tournamentName, round: row.tournamentRound, game: row.pairingGame } }),
            ...(row.duelId === null || row.duelGame === null || row.duelGames === null ? {} : { duel: { id: row.duelId, game: row.duelGame, of: row.duelGames } }),
            analyses: analyzed.get(row.id) ?? 0,
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
    const player = resolved.player;
    const before = beforeBound(query, resolved.filters.before);
    const empty: FinishedGamesPage = { games: [], page: resolved.page, pages: 0, total: 0, ...(player === null ? {} : { record: noRecord }) };
    if (before === `none`) return empty;
    const record = player === null ? null : recordOf(query, resolved, player, before);
    // An aggregate with no grouping answers exactly one row.
    const total = record === null ? query.get<{ total: number }>(totalQuery(query, resolved, before)).total : record.games + record.voided;
    const statement = pageQuery(query, resolved, before);
    const rows = statement === null ? [] : query.all<{ id: string; seq: number }>(statement);
    return {
        games: finishedEntriesOf(query, rows.map((row) => row.id)),
        page: resolved.page,
        pages: Math.min(finishedGamesPageCap, Math.ceil(total / finishedGamesPageSize)),
        total,
        ...(record === null ? {} : { record }),
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
    const page = pageQuery(query, resolved, before);
    if (page !== null) explain(page);
    if (resolved.player === null) {
        explain(totalQuery(query, resolved, before));
    } else {
        const record = recordQuery(query, resolved, resolved.player, before);
        if (record !== null) explain(record);
    }
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
