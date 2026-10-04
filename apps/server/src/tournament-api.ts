import {
    acceptsCovers,
    acceptsSchema,
    createRoundRobinRequestSchema,
    duelPerBotCap,
    estimateOf,
    nameKeyOf,
    nameSyntaxSchema,
    openingPliesSchema,
    roundRobinDailyCap,
    roundRobinGamesPerPair,
    roundRobinLiveCap,
    seatLevelOf,
    seatLevelSchema,
    timeControlSchema,
    tournamentDetailMemoMs,
    tournamentDetailSchema,
    tournamentEntryReasonSchema,
    tournamentEntryRequestSchema,
    tournamentEntryStateSchema,
    tournamentGamesPerPairSchema,
    tournamentIdSchema,
    tournamentListPastCap,
    tournamentListQuerySchema,
    tournamentListSchema,
    tournamentRunningListCap,
    tournamentStatusSchema,
    tournamentWaitingCap,
    tournamentWithdrawRequestSchema,
    type EstimateUnit,
    type SeatLevel,
    type TournamentBot,
    type TournamentDetail,
    type TournamentEnd,
    type TournamentEntry,
    type TournamentEstimate,
    type TournamentGame,
    type TournamentList,
    type TournamentPlace,
    type TournamentSummary,
    type TournamentYours,
} from '@hexo-arena/contract';
import { and, asc, desc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { nowSeconds, type Query } from './db';
import { bots, games, tournamentEntries, tournamentPairings, tournaments, users } from './db/schema';
import { duelGateFailures, type DuelGateFailure } from './duel-runner';
import { countRunningOfBot, readDuelBot, type DuelBotRecord } from './duel-store';
import type { GameRegistry } from './game-registry';
import type { PresenceRegistry } from './presence';
import { tournamentExport } from './game-export';
import { readRating } from './rating-store';
import type { ClientLimits, CredentialLimits } from './request-limits';
import { pointOf, standingsOf, storedSlot, xSeatOf, type PairingSeat, type ScoredPairing } from './round-robin';
import { sessionUser } from './sessions';
import { shownBot, shownUser } from './shown-names';
import type { StartGate } from './site-state';
import type { TournamentScheduler } from './tournament-scheduler';
import {
    countRoundRobinsSince,
    countRunningRoundRobinsBy,
    countRunningRoundRobinsOfBot,
    creatorJoin,
    creatorOf,
    creators,
    insertRoundRobin,
    nameColumns,
    tournamentNameOf,
    type RoundRobinEntrant,
} from './tournament-store';

const isoOf = (seconds: number) => new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/u, `Z`);

interface TournamentRow {
    readonly id: string;
    readonly name: string | null;
    readonly creatorName: string | null;
    readonly creatorDeletedAt: number | null;
    readonly status: string;
    readonly startsAt: number;
    readonly startedAt: number | null;
    readonly endedAt: number | null;
    readonly timeControl: string;
    readonly openingPlies: number;
    readonly maxEntrants: number;
    readonly origin: string;
    readonly createdBy: string | null;
    readonly rated: number;
    readonly test: number;
    readonly gamesPerPair: number;
    readonly endReason: string | null;
}

const tournamentColumns = {
    id: tournaments.id,
    ...nameColumns,
    status: tournaments.status,
    startsAt: tournaments.startsAt,
    startedAt: tournaments.startedAt,
    endedAt: tournaments.endedAt,
    timeControl: tournaments.timeControl,
    openingPlies: tournaments.openingPlies,
    maxEntrants: tournaments.maxEntrants,
    origin: tournaments.origin,
    createdBy: tournaments.createdBy,
    rated: tournaments.rated,
    test: tournaments.test,
    gamesPerPair: tournaments.gamesPerPair,
    endReason: tournaments.endReason,
};

function selectTournaments(query: Query) {
    return query.select(tournamentColumns).from(tournaments).leftJoin(creators, creatorJoin);
}

function findTournament(query: Query, id: string): TournamentRow | undefined {
    return selectTournaments(query).where(eq(tournaments.id, id)).get();
}

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
    readonly level: SeatLevel | null;
    readonly version: string | null;
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
            level: tournamentEntries.level,
            version: tournamentEntries.version,
        })
        .from(tournamentEntries)
        .innerJoin(bots, eq(bots.id, tournamentEntries.botId))
        .innerJoin(users, eq(users.id, tournamentEntries.ownerId))
        .where(eq(tournamentEntries.tournamentId, tournamentId))
        .orderBy(asc(tournamentEntries.enteredAt), asc(bots.nameKey))
        .all();
    return rows.map(({ botDeletedAt, ownerDeletedAt, level, ...row }, index) => ({
        ...row,
        key: index + 1,
        bot: shownBot(row.bot, botDeletedAt).name,
        ownerName: shownUser(row.ownerName, ownerDeletedAt).name,
        deleted: botDeletedAt !== null,
        level: level === null ? null : seatLevelSchema.parse(JSON.parse(level)),
    }));
}

const inField = (entry: EntryRow) => entry.state === `playing` || entry.state === `withdrawn`;

// A bot as the round lines name it; every pairing seats two of the entries.
function botOf(entry: EntryRow | undefined, botId: string): TournamentBot {
    if (entry === undefined) throw new Error(`a pairing seats a bot with no entry: ${botId}`);
    return { key: entry.key, name: entry.bot, ...(entry.deleted ? { deleted: true as const } : {}) };
}

// The checks admit only the contract's states and reasons. A bot at a
// level other than its default has no rating of its own to show.
function entryView(row: EntryRow, online: boolean): TournamentEntry {
    return {
        key: row.key,
        bot: row.bot,
        ownerName: row.ownerName,
        ...(row.deleted ? { deleted: true } : {}),
        online,
        ratingAtStart: row.ratingAtStart === null || row.level !== null ? null : Math.round(row.ratingAtStart),
        state: tournamentEntryStateSchema.parse(row.state),
        ...(row.reason === null ? {} : { reason: tournamentEntryReasonSchema.parse(row.reason) }),
        ...(row.level === null ? {} : { level: row.level }),
        ...(row.version === null ? {} : { version: row.version }),
    };
}

interface LegView {
    readonly scored: ScoredPairing;
    readonly gameIds: readonly [string | null, string | null];
}

/** A pair's meeting in a round, over every opening it plays. */
interface PairingView {
    readonly round: number;
    readonly first: TournamentBot;
    readonly second: TournamentBot;
    readonly firstBotId: string;
    readonly secondBotId: string;
    readonly legs: readonly LegView[];
}

// Every pairing seats two of the tournament's entries, which name its bots;
// a pair's openings gather under one meeting, in their order.
function pairingViews(query: Query, tournamentId: string, entries: readonly EntryRow[]): PairingView[] {
    const rows = query
        .select({
            id: tournamentPairings.id,
            round: tournamentPairings.round,
            leg: tournamentPairings.leg,
            firstBotId: tournamentPairings.firstBotId,
            secondBotId: tournamentPairings.secondBotId,
            game1: tournamentPairings.game1,
            game1Seat: tournamentPairings.game1Seat,
            game2: tournamentPairings.game2,
            game2Seat: tournamentPairings.game2Seat,
        })
        .from(tournamentPairings)
        .where(eq(tournamentPairings.tournamentId, tournamentId))
        .orderBy(asc(tournamentPairings.round), asc(tournamentPairings.leg), asc(tournamentPairings.id))
        .all();
    if (rows.length === 0) return [];
    const byBot = new Map(entries.map((entry) => [entry.botId, entry]));
    // The latest game of each slot, a replay over the game it replaced.
    const slotGames = new Map<string, string>();
    for (const game of query
        .select({ id: games.id, pairingId: games.pairingId, pairingGame: games.pairingGame })
        .from(games)
        .where(inArray(games.pairingId, rows.map((row) => row.id)))
        .orderBy(asc(games.createdAt))
        .all()) {
        slotGames.set(`${game.pairingId ?? ``}:${String(game.pairingGame)}`, game.id);
    }
    const meetings = new Map<string, { round: number; firstBotId: string; secondBotId: string; legs: LegView[] }>();
    for (const row of rows) {
        const key = `${String(row.round)} ${row.firstBotId} ${row.secondBotId}`;
        const meeting = meetings.get(key) ?? { round: row.round, firstBotId: row.firstBotId, secondBotId: row.secondBotId, legs: [] };
        meeting.legs.push({
            scored: {
                round: row.round,
                leg: row.leg,
                first: row.firstBotId,
                second: row.secondBotId,
                games: [storedSlot(row.game1, row.game1Seat), storedSlot(row.game2, row.game2Seat)],
            },
            gameIds: [slotGames.get(`${row.id}:1`) ?? null, slotGames.get(`${row.id}:2`) ?? null],
        });
        meetings.set(key, meeting);
    }
    return [...meetings.values()].map((meeting) => ({
        ...meeting,
        first: botOf(byBot.get(meeting.firstBotId), meeting.firstBotId),
        second: botOf(byBot.get(meeting.secondBotId), meeting.secondBotId),
    }));
}

const scoredOf = (pairings: readonly PairingView[]) => pairings.flatMap((pairing) => pairing.legs.map((leg) => leg.scored));

function gameView(pairing: PairingView, leg: LegView, index: 0 | 1): TournamentGame {
    const result = leg.scored.games[index];
    const keyOf = (seat: PairingSeat) => (seat === `first` ? pairing.first.key : pairing.second.key);
    const point = pointOf(result);
    const absent = result.kind === `no_show` ? result.missing : result.kind === `forfeit` ? result.withdrawn : null;
    return {
        x: keyOf(xSeatOf(index === 0 ? 1 : 2)),
        gameId: leg.gameIds[index],
        outcome: result.kind,
        point: point === null ? null : keyOf(point),
        missing: absent === null ? [] : absent === `both` ? [pairing.first.key, pairing.second.key] : [keyOf(absent)],
    };
}

// The round under way, or the last one begun; null before any began. A
// game never played, as a stopped round robin leaves those to come, begins nothing.
function lastBegunRound(pairings: readonly PairingView[]): number | null {
    const begun = pairings
        .filter((pairing) => pairing.legs.some((leg) => leg.scored.games.some((game) => game.kind !== `pending` && game.kind !== `not_played`)))
        .map((pairing) => pairing.round);
    return begun.length === 0 ? null : Math.max(...begun);
}

function endOf(row: TournamentRow, pairings: readonly PairingView[]): TournamentEnd | undefined {
    if (row.status === `canceled`) return { reason: `operator`, round: lastBegunRound(pairings) };
    if (row.status !== `stopped`) return undefined;
    // The end check admits only these reasons on a stopped round robin.
    return { reason: row.endReason as TournamentEnd[`reason`], round: lastBegunRound(pairings) };
}

// Each bot of a test against all the others together, counted by the
// pair's openings, as a duel's test is counted by its pairs: its points
// in the games played, a game without a winner a half to each.
function estimatesOf(field: readonly EntryRow[], pairings: readonly PairingView[]): TournamentEstimate[] {
    return field.flatMap((entry) => {
        const units: EstimateUnit[] = [];
        for (const pairing of pairings) {
            const seat: PairingSeat | null = pairing.firstBotId === entry.botId ? `first` : pairing.secondBotId === entry.botId ? `second` : null;
            if (seat === null) continue;
            for (const leg of pairing.legs) {
                const unit = { games: 0, points: 0 };
                for (const game of leg.scored.games) {
                    if (game.kind !== `played`) continue;
                    unit.games += 1;
                    unit.points += game.winner === null ? 0.5 : game.winner === seat ? 1 : 0;
                }
                units.push(unit);
            }
        }
        const estimate = estimateOf(units);
        return estimate === null ? [] : [{ key: entry.key, estimate }];
    });
}

/** What a tournament's page reads beyond the database: who is online, its live games, and the waits the scheduler holds. */
export interface TournamentReads {
    readonly presence: Pick<PresenceRegistry, `isOnline`>;
    readonly games: Pick<GameRegistry, `liveEntriesOf`>;
    readonly tournaments: Pick<TournamentScheduler, `waitingOf` | `nextRoundAt`>;
}

/** A tournament as its page reads it; null for an unknown id. */
export function tournamentDetail(query: Query, reads: TournamentReads, id: string): TournamentDetail | null {
    const row = findTournament(query, id);
    if (row === undefined) return null;
    const entries = entryRows(query, id);
    const pairings = pairingViews(query, id, entries);
    const byBot = new Map(entries.map((entry) => [entry.botId, entry]));
    const field = entries.filter(inField);
    const standings = standingsOf(
        field.map((entry) => entry.botId),
        scoredOf(pairings),
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
        const resting = field.find((entry) => !seated.has(entry.key));
        return {
            round,
            pairings: inRound.map((pairing) => ({
                first: pairing.first,
                second: pairing.second,
                games: pairing.legs.flatMap((leg) => [gameView(pairing, leg, 0), gameView(pairing, leg, 1)]),
            })),
            rest: resting === undefined ? null : botOf(resting, resting.botId),
        };
    });
    const liveIds = pairings.flatMap((pairing) => pairing.legs.flatMap((leg) => leg.gameIds.filter((gameId, index) => gameId !== null && leg.scored.games[index]?.kind === `live`)));
    const running = row.status === `running`;
    const nextRoundAt = running ? reads.tournaments.nextRoundAt(id) : null;
    const end = endOf(row, pairings);
    const estimates = row.test === 1 ? estimatesOf(field, pairings) : [];
    return {
        ...summaryBase(row),
        startedAt: row.startedAt === null ? null : isoOf(row.startedAt),
        endedAt: row.endedAt === null ? null : isoOf(row.endedAt),
        entries: entries.map((entry) => entryView(entry, reads.presence.isOnline(entry.botId))),
        rounds,
        standings,
        live: reads.games.liveEntriesOf(liveIds.filter((gameId): gameId is string => gameId !== null)),
        ...(end === undefined ? {} : { end }),
        waiting: running
            ? reads.tournaments.waitingOf(id).flatMap((wait) => {
                  const entry = byBot.get(wait.botId);
                  return entry === undefined ? [] : [{ key: entry.key, until: new Date(wait.until).toISOString() }];
              })
            : [],
        nextRoundAt: nextRoundAt === null ? null : new Date(nextRoundAt).toISOString(),
        ...(estimates.length === 0 ? {} : { estimates }),
    };
}

function summaryBase(row: TournamentRow) {
    const person = row.origin === `person`;
    return {
        id: row.id,
        name: tournamentNameOf(row),
        // The origin check admits only these two.
        origin: row.origin as TournamentSummary[`origin`],
        createdBy: person ? creatorOf(row) : null,
        rated: row.rated === 1,
        test: row.test === 1,
        gamesPerPair: tournamentGamesPerPairSchema.parse(row.gamesPerPair),
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
    // Only a tournament that started has pairings to read.
    const begun = row.status === `running` || row.status === `finished` || row.status === `stopped` || row.status === `canceled`;
    const entries = begun ? entryRows(query, row.id) : [];
    const pairings = begun ? pairingViews(query, row.id, entries) : [];
    const field = entries.filter(inField);
    const top = row.status === `finished` || (row.test === 1 && row.status === `stopped`) ? standingsOf(field.map((entry) => entry.botId), scoredOf(pairings))[0] : undefined;
    const first = entries.find((candidate) => candidate.botId === top?.bot);
    const deleted = first?.deleted === true ? { deleted: true as const } : {};
    const winner = row.status === `finished` && first !== undefined ? { name: first.bot, ownerName: first.ownerName, ...deleted } : null;
    // A test's verdict on the bot first in it, against the rest, as its page leads with.
    const estimate = row.test === 1 && first !== undefined ? estimatesOf(field, pairings).find((each) => each.key === first.key)?.estimate : undefined;
    const end = endOf(row, pairings);
    return {
        ...summaryBase(row),
        entrants,
        winner,
        round: row.status === `running` ? roundOf(pairings) : null,
        ...(row.endedAt === null ? {} : { endedAt: isoOf(row.endedAt) }),
        ...(end === undefined ? {} : { end }),
        ...(estimate === undefined || first === undefined ? {} : { lead: { bot: first.bot, ...deleted, estimate } }),
    };
}

// The entries a list's row may name, each with its place; a bot outside
// the field has none.
function entryPlaces(query: Query, row: TournamentRow, wanted: (entry: EntryRow) => boolean): { entry: EntryRow; place: TournamentPlace }[] {
    const entries = entryRows(query, row.id);
    const chosen = entries.filter(wanted);
    if (chosen.length === 0) return [];
    const field = entries.filter(inField).map((entry) => entry.botId);
    const lines = standingsOf(field, scoredOf(pairingViews(query, row.id, entries)));
    return chosen.map((entry) => {
        const state = tournamentEntryStateSchema.parse(entry.state);
        const reason = entry.reason === null ? {} : { reason: tournamentEntryReasonSchema.parse(entry.reason) };
        const line = field.includes(entry.botId) ? lines.find((standing) => standing.bot === entry.botId) : undefined;
        return { entry, place: { state, ...reason, rank: line?.rank ?? null, points: line?.points ?? null } };
    });
}

// The owner's bot as the tournament names it: the one entry of the weekly,
// or the best placed of several in a round robin a person set up.
function yoursOf(query: Query, row: TournamentRow, ownerId: string): TournamentYours | null {
    const places = entryPlaces(query, row, (entry) => entry.ownerId === ownerId).sort((one, two) => (one.place.rank ?? Infinity) - (two.place.rank ?? Infinity));
    const found = places[0];
    return found === undefined ? null : { bot: found.entry.bot, ...(found.entry.deleted ? { deleted: true as const } : {}), place: found.place };
}

// The first round with a game still to finish, or the last once none has.
function roundOf(pairings: readonly PairingView[]): TournamentSummary[`round`] {
    const rounds = [...new Set(pairings.map((pairing) => pairing.round))].sort((one, two) => one - two);
    const last = rounds.at(-1);
    if (last === undefined) return null;
    const open = (round: number) =>
        pairings.some((pairing) => pairing.round === round && pairing.legs.some((leg) => leg.scored.games.some((game) => game.kind === `pending` || game.kind === `live`)));
    return { current: rounds.find(open) ?? last, of: rounds.length };
}

/** One tournament as the list holds it; null for an unknown id. */
export function tournamentSummary(query: Query, id: string): TournamentSummary | null {
    const row = findTournament(query, id);
    return row === undefined ? null : summaryOf(query, row);
}

/** Which tournaments a list holds: one bot's, one person's, tests alone, or every one; and whose bot each names under yours. */
export interface TournamentListFilter {
    readonly botId: string | null;
    /** A person's: set up by them, or with a bot of theirs entered. */
    readonly userId: string | null;
    readonly test: boolean;
    /** The signed-in caller, whose bot each row names. */
    readonly viewerId: string | null;
}

/**
 * The tournament list: every running one, those waiting, and the latest
 * over; for a bot, only those it entered, each with its place; for a
 * person, only theirs; and for a signed-in caller, each one their bot
 * plays names it and its place.
 */
export function tournamentList(query: Query, filter: TournamentListFilter): TournamentList {
    const narrowed: (SQL | undefined)[] = [
        filter.botId === null
            ? undefined
            : sql`${tournaments.id} in (select ${tournamentEntries.tournamentId} from ${tournamentEntries} where ${tournamentEntries.botId} = ${filter.botId})`,
        filter.userId === null
            ? undefined
            : or(
                  eq(tournaments.createdBy, filter.userId),
                  sql`${tournaments.id} in (select ${tournamentEntries.tournamentId} from ${tournamentEntries} where ${tournamentEntries.ownerId} = ${filter.userId})`,
              ),
        filter.test ? eq(tournaments.test, 1) : undefined,
    ];
    const all = (statuses: string[], order: SQL[], limit: number) =>
        selectTournaments(query)
            .where(and(inArray(tournaments.status, statuses), ...narrowed))
            .orderBy(...order)
            .limit(limit)
            .all();
    const summary = (row: TournamentRow): TournamentSummary => {
        const place = filter.botId === null ? undefined : entryPlaces(query, row, (entry) => entry.botId === filter.botId)[0]?.place;
        const yours = filter.viewerId === null ? null : yoursOf(query, row, filter.viewerId);
        return { ...summaryOf(query, row), ...(place === undefined ? {} : { bot: place }), ...(yours === null ? {} : { yours }) };
    };
    return {
        running: all([`running`], [sql`${tournaments.origin} = 'person'`, desc(tournaments.startedAt), desc(tournaments.id)], tournamentRunningListCap).map(summary),
        scheduled: all([`scheduled`], [asc(tournaments.startsAt)], tournamentWaitingCap).map(summary),
        past: all([`finished`, `stopped`, `called_off`, `canceled`], [desc(sql`coalesce(${tournaments.endedAt}, ${tournaments.startsAt})`)], tournamentListPastCap).map(summary),
    };
}

export interface TournamentApiDeps {
    query: Query;
    presence: PresenceRegistry;
    games: GameRegistry;
    gate: StartGate;
    limits: CredentialLimits & ClientLimits;
    tournaments: TournamentScheduler;
    now: () => number;
}

type Refusal = { status: number; code: string; error: string; bot?: string; retryAfter?: number };

function sendRefusal(reply: FastifyReply, refusal: Refusal): FastifyReply {
    if (refusal.retryAfter !== undefined) void reply.header(`retry-after`, String(refusal.retryAfter));
    return reply.code(refusal.status).send({ error: refusal.error, code: refusal.code, ...(refusal.bot === undefined ? {} : { bot: refusal.bot }) });
}

// The chosen level by its id, null at the bot's default; undefined for a level the bot does not declare.
function chosenLevel(bot: DuelBotRecord, id: string | undefined): SeatLevel | null | undefined {
    if (id === undefined) return null;
    const declared = bot.levels?.list.find((level) => level.id === id);
    if (declared === undefined) return undefined;
    return declared.id === bot.levels?.default ? null : seatLevelOf(declared);
}

const shortLengths: ReadonlySet<number> = new Set(roundRobinGamesPerPair);

function isUniqueViolation(error: unknown): boolean {
    return error instanceof Error && `code` in error && String(error.code).startsWith(`SQLITE_CONSTRAINT_UNIQUE`);
}

/**
 * The tournament routes: the reads, public and memoized per tournament;
 * the owner's entry while the weekly waits; and a person's round robin,
 * set up, stopped, and left by a bot's owner.
 */
export function registerTournamentApi(app: FastifyInstance, deps: TournamentApiDeps): void {
    const { query, limits, gate } = deps;
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

    // A change shows on its page and in every bot's list at once.
    const forget = (id: string) => {
        memo.delete(id);
        for (const key of memo.keys()) if (key.startsWith(`bot:`)) memo.delete(key);
    };

    const detailOf = (id: string) => {
        const detail = tournamentDetail(query, deps, id);
        return detail === null ? null : tournamentDetailSchema.parse(detail);
    };

    app.get(`/api/tournaments`, { config: { limit: `public` } }, async (request, reply) => {
        const parsed = tournamentListQuerySchema.safeParse(request.query);
        if (!parsed.success) return reply.code(400).send({ error: `the query fails validation`, code: `bad_request` });
        const name = parsed.data.bot;
        const test = parsed.data.kind === `test`;
        // The list of one bot is shared by every caller through its memo, so only the other lists name the caller's own.
        if (name === undefined) {
            const viewer = sessionUser(query, request)?.id ?? null;
            const mine = parsed.data.mine !== undefined;
            // Signed out, the caller set up nothing and owns nothing.
            if (mine && viewer === null) return reply.send(tournamentListSchema.parse({ running: [], scheduled: [], past: [] }));
            const list = tournamentList(query, { botId: null, userId: mine ? viewer : null, test, viewerId: viewer });
            const dayStart = Math.floor(deps.now() / 86_400_000) * 86_400;
            const quota = mine && viewer !== null ? { quota: { live: countRunningRoundRobinsBy(query, viewer), today: countRoundRobinsSince(query, viewer, dayStart) } } : {};
            return reply.header(`content-type`, `application/json; charset=utf-8`).send(JSON.stringify(tournamentListSchema.parse({ ...list, ...quota })));
        }
        const bot = nameSyntaxSchema.safeParse(name).success
            ? query.select({ id: bots.id }).from(bots).where(and(eq(bots.nameKey, nameKeyOf(name)), isNull(bots.deletedAt))).get()
            : undefined;
        if (bot === undefined) return reply.code(404).send({ error: `no such bot`, code: `not_found` });
        // A bot's list reads the standings of every tournament it entered, so it shares the detail's window.
        const body = memoized(`bot:${bot.id}:${String(test)}`, () => JSON.stringify(tournamentListSchema.parse(tournamentList(query, { botId: bot.id, userId: null, test, viewerId: null }))));
        return reply.header(`content-type`, `application/json; charset=utf-8`).send(body);
    });

    app.post(`/api/tournaments`, { config: { limit: `principal` } }, async (request, reply) => {
        const user = sessionUser(query, request);
        if (user === null) return reply.code(401).send({ error: `no signed-in user`, code: `unauthorized` });
        if (limits.refuse(reply, `principal`, `user:${user.id}`)) return reply;
        const parsed = createRoundRobinRequestSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: `the request fails validation`, code: `bad_request` });
        if (gate.refuse(reply)) return reply;
        const terms = parsed.data;
        const picked = terms.bots.map((wanted) => ({ wanted, bot: readDuelBot(query, { nameKey: nameKeyOf(wanted.name) }) }));
        const found = picked.flatMap(({ wanted, bot }) => (bot === undefined ? [] : [{ wanted, bot }]));
        if (found.length < picked.length) return reply.code(404).send({ error: `no such bot`, code: `not_found` });
        const failures = found.map(({ bot }) => ({ bot, reasons: duelGateFailures(bot, { starterId: user.id, timeControl: terms.timeControl }, { ...deps, reservations: deps.tournaments }) }));
        const failing = (...reasons: DuelGateFailure[]) => failures.find((each) => each.reasons.some((reason) => reasons.includes(reason)))?.bot.name;
        const gates: [DuelGateFailure[], Omit<Refusal, `bot`>][] = [
            [[`delisted`], { status: 403, code: `delisted`, error: `a bot is delisted` }],
            [[`banned`], { status: 403, code: `banned`, error: `a bot's owner is banned` }],
            [[`offline`, `closed`], { status: 400, code: `not_open`, error: `a bot is not online and taking games` }],
            [[`refused`], { status: 400, code: `duel_refused`, error: `a bot's owner takes no duels or round robins set up by others` }],
            [[`clock`], { status: 400, code: `clock_not_accepted`, error: `a bot does not accept this clock` }],
        ];
        for (const [reasons, refusal] of gates) {
            const bot = failing(...reasons);
            if (bot !== undefined) return sendRefusal(reply, { ...refusal, bot });
        }
        const levels = found.map(({ wanted, bot }) => ({ bot, level: chosenLevel(bot, wanted.level) }));
        const unknown = levels.find((each) => each.level === undefined);
        if (unknown !== undefined) return sendRefusal(reply, { status: 400, code: `unknown_level`, error: `a bot declares no such level`, bot: unknown.bot.name });
        // One person on every seat makes a test, whoever set it up.
        const test = new Set(found.map(({ bot }) => bot.ownerId)).size === 1;
        const now = Math.floor(deps.now() / 1000);
        const dayStart = Math.floor(now / 86_400) * 86_400;
        const untilTomorrow = dayStart + 86_400 - now;
        // The quotas are read where the round robin is written, as the daily caps are.
        const create = () =>
            query.transaction((tx): { id: string } | Refusal => {
                const busy = failures.find(({ bot, reasons }) => reasons.includes(`busy`) || reasons.includes(`tournament`) || countRunningOfBot(tx, bot.id) + countRunningRoundRobinsOfBot(tx, bot.id) >= duelPerBotCap);
                if (busy !== undefined) return { status: 400, code: `bot_busy`, error: `a bot is at its game cap, in the weekly, or in its most duels and round robins`, bot: busy.bot.name };
                if (!test && !shortLengths.has(terms.gamesPerPair)) return { status: 400, code: `test_only`, error: `only a test of one person's bots plays that many games a pair` };
                if (countRunningRoundRobinsBy(tx, user.id) >= roundRobinLiveCap) return { status: 400, code: `round_robin_busy`, error: `you run a round robin already` };
                if (countRoundRobinsSince(tx, user.id, dayStart) >= roundRobinDailyCap) {
                    return { status: 429, code: `daily_round_robin_cap`, error: `you set up your round robins for the day`, retryAfter: untilTomorrow };
                }
                const entrants: RoundRobinEntrant[] = levels.map(({ bot, level }) => ({
                    botId: bot.id,
                    ownerId: bot.ownerId,
                    name: bot.name,
                    rating: readRating(tx, { kind: `bot`, id: bot.id }).rating,
                    level: level ?? null,
                    version: bot.version,
                }));
                const id = insertRoundRobin(tx, { createdBy: user.id, entrants, test, gamesPerPair: terms.gamesPerPair, timeControl: terms.timeControl, openingPlies: terms.openingPlies }, now);
                return { id };
            });
        let created: { id: string } | Refusal;
        try {
            created = create();
        } catch (error) {
            // Two requests at once: the unique index holds the person to one running round robin.
            if (!isUniqueViolation(error)) throw error;
            created = { status: 400, code: `round_robin_busy`, error: `you run a round robin already` };
        }
        if (`code` in created) return sendRefusal(reply, created);
        deps.tournaments.advance(created.id);
        forget(created.id);
        return reply.code(201).send(detailOf(created.id));
    });

    app.get(`/api/tournaments/:id`, { config: { limit: `public` } }, async (request, reply) => {
        const { id } = request.params as { id: string };
        if (!tournamentIdSchema.safeParse(id).success) return reply.code(404).send({ error: `no such tournament`, code: `not_found` });
        const body = memoized(id, () => {
            const detail = detailOf(id);
            return detail === null ? null : JSON.stringify(detail);
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

    app.post(`/api/tournaments/:id/stop`, { config: { limit: `principal` } }, async (request, reply) => {
        const user = sessionUser(query, request);
        if (user === null) return reply.code(401).send({ error: `no signed-in user`, code: `unauthorized` });
        if (limits.refuse(reply, `principal`, `user:${user.id}`)) return reply;
        const { id } = request.params as { id: string };
        const row = tournamentIdSchema.safeParse(id).success ? findTournament(query, id) : undefined;
        if (row === undefined) return reply.code(404).send({ error: `no such tournament`, code: `not_found` });
        if (row.origin !== `person` || row.createdBy !== user.id) return reply.code(403).send({ error: `you did not set the round robin up`, code: `not_yours` });
        if (!deps.tournaments.stopRoundRobin(id, `creator`)) return reply.code(409).send({ error: `the round robin is already over`, code: `over` });
        forget(id);
        return reply.code(200).send(detailOf(id));
    });

    app.post(`/api/tournaments/:id/withdraw`, { config: { limit: `principal` } }, async (request, reply) => {
        const user = sessionUser(query, request);
        if (user === null) return reply.code(401).send({ error: `no signed-in user`, code: `unauthorized` });
        if (limits.refuse(reply, `principal`, `user:${user.id}`)) return reply;
        const parsed = tournamentWithdrawRequestSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: `the request fails validation`, code: `bad_request` });
        const { id } = request.params as { id: string };
        const row = tournamentIdSchema.safeParse(id).success ? findTournament(query, id) : undefined;
        const bot = readDuelBot(query, { nameKey: nameKeyOf(parsed.data.bot) });
        // The weekly holds its entrants to the end; only a round robin a person set up lets a bot go.
        if (row?.origin !== `person` || bot === undefined) return reply.code(404).send({ error: `no such round robin or bot`, code: `not_found` });
        if (bot.ownerId !== user.id) return reply.code(403).send({ error: `the bot is someone else's`, code: `not_owner` });
        const left = deps.tournaments.withdrawByOwner(id, bot.id);
        if (left === `over`) return reply.code(409).send({ error: `the round robin is over`, code: `over` });
        if (left === `not_playing`) return reply.code(409).send({ error: `the bot plays no further game in it`, code: `not_playing` });
        forget(id);
        return reply.code(200).send(detailOf(id));
    });

    app.put(`/api/tournaments/:id/entry`, { config: { limit: `principal` } }, async (request, reply) => {
        const user = sessionUser(query, request);
        if (user === null) return reply.code(401).send({ error: `no session`, code: `unauthorized` });
        if (limits.refuse(reply, `principal`, `user:${user.id}`)) return reply;
        const parsed = tournamentEntryRequestSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: `the request fails validation`, code: `bad_request` });
        const { id } = request.params as { id: string };
        const tournament = findTournament(query, id);
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
        forget(id);
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
        forget(id);
        return reply.code(204).send();
    });
}
