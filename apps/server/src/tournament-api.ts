import {
    acceptsCovers,
    acceptsSchema,
    boardCellSchema,
    createTournamentRequestSchema,
    estimateOf,
    gamesPerPairFits,
    nameKeyOf,
    nameSyntaxSchema,
    openingPliesSchema,
    seatLevelSchema,
    sideOf,
    tournamentDailyCap,
    tournamentFormatOf,
    tournamentGameCounts,
    tournamentLiveCap,
    turnsOnBoard,
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
    tournamentBotStatesSchema,
    tournamentPerBotCap,
    tournamentRunningListCap,
    tournamentStatusSchema,
    tournamentWaitingCap,
    tournamentWithdrawRequestSchema,
    type EstimateUnit,
    type BoardCell,
    type FinishReason,
    type SeatLevel,
    type TournamentBot,
    type TournamentBotState,
    type TournamentDetail,
    type TournamentEnd,
    type TournamentEntry,
    type TournamentEstimate,
    type TournamentGame,
    type TournamentLeaders,
    type TournamentList,
    type TournamentOrigin,
    type TournamentPair,
    type TournamentPlace,
    type TournamentStatus,
    type TournamentSummary,
    type TournamentYours,
} from '@hexo-arena/contract';
import { and, asc, desc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { botGates, busyBot, chosenLevel, gateRefusal, readBot, sendRefusal, type Refusal } from './bot-gates';
import { listBots } from './bots';
import { nowSeconds, type Query } from './db';
import { bots, games, moves, tournamentEntries, tournamentPairings, tournaments, users } from './db/schema';
import type { GameRegistry } from './game-registry';
import type { PresenceRegistry } from './presence';
import { TournamentExports } from './game-export';
import { isProvisional } from './rating';
import { readRating } from './rating-store';
import type { ClientLimits, CredentialLimits } from './request-limits';
import { pointOf, standingsOf, storedSlots, xSeatOf, type PairingSeat, type ScoredPairing } from './round-robin';
import { sessionUser } from './sessions';
import { shownBot, shownUser } from './shown-names';
import type { StartGate } from './site-state';
import type { TournamentScheduler } from './tournament-scheduler';
import {
    countRunningTournamentsOfBot,
    countSetUpSince,
    creatorJoin,
    creatorOf,
    creators,
    insertPersonTournament,
    nameColumns,
    runningSlotsOf,
    tournamentNameOf,
    type EndReason,
    type PersonEntrant,
} from './tournament-store';
import { utcDay } from './utc-day';
import { WindowMemo } from './window-memo';

const isoOf = (seconds: number) => new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/u, `Z`);

interface IdParams {
    id: string;
}

interface TournamentRow {
    readonly id: string;
    readonly name: string | null;
    readonly creatorName: string | null;
    readonly creatorDeletedAt: number | null;
    readonly status: TournamentStatus;
    readonly startsAt: number;
    readonly startedAt: number | null;
    readonly endedAt: number | null;
    readonly timeControl: string;
    readonly openingPlies: number;
    readonly maxEntrants: number;
    readonly origin: TournamentOrigin;
    readonly createdBy: string | null;
    readonly rated: number;
    readonly test: number;
    readonly gamesPerPair: number;
    readonly endReason: EndReason | null;
    readonly endBotId: string | null;
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
    endBotId: tournaments.endBotId,
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

// A deleted bot reads by its label alone; its number in the entry order,
// a person's seats first, keeps it apart from another deleted bot without
// either one's placeholder.
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
        .orderBy(asc(tournamentEntries.seat), asc(tournamentEntries.enteredAt), asc(bots.nameKey))
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

// A bot's rating on the ladder now, which a duel's head shows; none once deleted.
function ratingNow(query: Query, row: EntryRow): TournamentEntry[`now`] {
    if (row.deleted) return null;
    const rating = readRating(query, { kind: `bot`, id: row.botId });
    return { rating: Math.round(rating.rating), provisional: isProvisional(rating) };
}

// The checks admit only the contract's states and reasons. A bot at a
// level other than its default has no rating of its own to show; a
// duel's entry names its rating now.
function entryView(row: EntryRow, online: boolean, now?: TournamentEntry[`now`]): TournamentEntry {
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
        ...(now === undefined ? {} : { now }),
    };
}

// What a slot's latest game says once over: how it ended and its turns on the board.
interface SlotGame {
    readonly id: string;
    readonly reason: FinishReason | null;
    readonly turns: number | null;
}

interface LegView {
    readonly scored: ScoredPairing;
    readonly games: readonly (SlotGame | null)[];
    // The opening the leg's first game drew, which its second replays.
    readonly opening: readonly BoardCell[] | null;
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
            openingCells: tournamentPairings.openingCells,
        })
        .from(tournamentPairings)
        .where(eq(tournamentPairings.tournamentId, tournamentId))
        .orderBy(asc(tournamentPairings.round), asc(tournamentPairings.leg), asc(tournamentPairings.id))
        .all();
    if (rows.length === 0) return [];
    const byBot = new Map(entries.map((entry) => [entry.botId, entry]));
    // The latest game of each slot, a replay over the game it replaced.
    const slotGames = new Map<string, SlotGame>();
    for (const game of query
        .select({
            id: games.id,
            pairingId: games.pairingId,
            pairingGame: games.pairingGame,
            reason: games.finishReason,
            openingCells: games.openingCells,
            moves: sql<number>`(select count(*) from ${moves} where ${moves.gameId} = ${games.id})`,
        })
        .from(games)
        .where(inArray(games.pairingId, rows.map((row) => row.id)))
        .orderBy(asc(games.createdAt))
        .all()) {
        const turns = game.reason === null ? null : turnsOnBoard(boardCellSchema.array().parse(JSON.parse(game.openingCells)).length) + game.moves;
        slotGames.set(`${game.pairingId ?? ``}:${String(game.pairingGame)}`, { id: game.id, reason: game.reason, turns });
    }
    const meetings = new Map<string, { round: number; firstBotId: string; secondBotId: string; legs: LegView[] }>();
    for (const row of rows) {
        const key = `${String(row.round)} ${row.firstBotId} ${row.secondBotId}`;
        const meeting = meetings.get(key) ?? { round: row.round, firstBotId: row.firstBotId, secondBotId: row.secondBotId, legs: [] };
        const slots = storedSlots(row);
        meeting.legs.push({
            scored: { round: row.round, leg: row.leg, first: row.firstBotId, second: row.secondBotId, games: slots },
            games: slots.map((_, index) => slotGames.get(`${row.id}:${String(index + 1)}`) ?? null),
            opening: row.openingCells === null ? null : boardCellSchema.array().parse(JSON.parse(row.openingCells)),
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

// A game as the pages read it; a duel's carries how it ended, its turns, and its opening, which its games list and live side show.
function gameView(pairing: PairingView, leg: LegView, index: number, duel: boolean): TournamentGame {
    const result = leg.scored.games[index] ?? { kind: `pending` };
    const game = leg.games[index] ?? null;
    const keyOf = (seat: PairingSeat) => (seat === `first` ? pairing.first.key : pairing.second.key);
    const point = pointOf(result);
    const absent = result.kind === `no_show` ? result.missing : result.kind === `forfeit` ? result.withdrawn : null;
    const over = result.kind === `played` || result.kind === `aborted`;
    const view = {
        x: keyOf(xSeatOf(index + 1)),
        gameId: game?.id ?? null,
        outcome: result.kind,
        point: point === null ? null : keyOf(point),
        missing: absent === null ? [] : absent === `both` ? [pairing.first.key, pairing.second.key] : [keyOf(absent)],
    };
    if (!duel) return view;
    return {
        ...view,
        reason: over ? (game?.reason ?? null) : null,
        turns: result.kind === `played` ? (game?.turns ?? null) : null,
        opening: leg.opening === null ? null : leg.opening.map((cell) => ({ x: cell.x, y: cell.y, side: sideOf(cell.player) })),
    };
}

const gamesOf = (pairing: PairingView, duel: boolean) => pairing.legs.flatMap((leg) => leg.scored.games.map((_, index) => gameView(pairing, leg, index, duel)));

// The round under way, or the last one begun; null before any began. A
// game never played, as a stopped round robin leaves those to come, begins nothing.
function lastBegunRound(pairings: readonly PairingView[]): number | null {
    const begun = pairings
        .filter((pairing) => pairing.legs.some((leg) => leg.scored.games.some((game) => game.kind !== `pending` && game.kind !== `not_played`)))
        .map((pairing) => pairing.round);
    return begun.length === 0 ? null : Math.max(...begun);
}

function endOf(row: TournamentRow, pairings: readonly PairingView[], entries: readonly EntryRow[]): TournamentEnd | undefined {
    if (row.status === `canceled`) return { reason: `operator`, round: lastBegunRound(pairings) };
    // The end check gives a stopped or cut short tournament, and only it, a reason.
    if (row.endReason === null) return undefined;
    const bot = row.endBotId === null ? undefined : entries.find((entry) => entry.botId === row.endBotId);
    return { reason: row.endReason, round: lastBegunRound(pairings), ...(bot === undefined ? {} : { bot: botOf(bot, bot.botId) }) };
}

// Each bot of a test against all the others together, counted by each
// pair's openings, since an opening's two games share it: its points in
// the games played, a game without a winner a half to each.
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

// What a tournament's page reads beyond the database: who is online, its live games, and the waits the scheduler holds.
interface TournamentReads {
    readonly presence: Pick<PresenceRegistry, `isOnline`>;
    readonly games: Pick<GameRegistry, `liveEntriesOf`>;
    readonly tournaments: Pick<TournamentScheduler, `waitingOf` | `nextRoundAt`>;
}

// A tournament as its page reads it; null for an unknown id.
function tournamentDetail(query: Query, reads: TournamentReads, id: string): TournamentDetail | null {
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
    const duel = tournamentFormatOf(row) === `duel`;
    const rounds = roundNumbers.map((round) => {
        const inRound = pairings.filter((pairing) => pairing.round === round);
        const seated = new Set(inRound.flatMap((pairing) => [pairing.first.key, pairing.second.key]));
        const resting = field.find((entry) => !seated.has(entry.key));
        return {
            round,
            pairings: inRound.map((pairing) => ({
                first: pairing.first,
                second: pairing.second,
                games: gamesOf(pairing, duel),
            })),
            rest: resting === undefined ? null : botOf(resting, resting.botId),
        };
    });
    const liveIds = pairings.flatMap((pairing) => pairing.legs.flatMap((leg) => leg.games.flatMap((game, index) => (game !== null && leg.scored.games[index]?.kind === `live` ? [game.id] : []))));
    const running = row.status === `running`;
    const nextRoundAt = running ? reads.tournaments.nextRoundAt(id) : null;
    const end = endOf(row, pairings, entries);
    const estimates = row.test === 1 ? estimatesOf(field, pairings) : [];
    return {
        ...summaryBase(row),
        startedAt: row.startedAt === null ? null : isoOf(row.startedAt),
        endedAt: row.endedAt === null ? null : isoOf(row.endedAt),
        entries: entries.map((entry) => entryView(entry, reads.presence.isOnline(entry.botId), duel ? ratingNow(query, entry) : undefined)),
        rounds,
        standings,
        live: reads.games.liveEntriesOf(liveIds),
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
        origin: row.origin,
        format: tournamentFormatOf(row),
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
    const begun = row.status === `running` || row.status === `finished` || row.status === `stopped` || row.status === `cut_short` || row.status === `canceled`;
    const entries = begun ? entryRows(query, row.id) : [];
    const pairings = begun ? pairingViews(query, row.id, entries) : [];
    const field = entries.filter(inField);
    const lines = standingsOf(
        field.map((entry) => entry.botId),
        scoredOf(pairings),
    );
    const endedEarly = row.status === `stopped` || row.status === `cut_short`;
    const top = row.status === `finished` || (row.test === 1 && endedEarly) ? lines[0] : undefined;
    const first = entries.find((candidate) => candidate.botId === top?.bot);
    const deleted = first?.deleted === true ? { deleted: true as const } : {};
    const winner = row.status === `finished` && first !== undefined ? { name: first.bot, ownerName: first.ownerName, ...deleted } : null;
    // A test's verdict on the bot first in it, against the rest, as its page leads with.
    const estimate = row.test === 1 && first !== undefined ? estimatesOf(field, pairings).find((each) => each.key === first.key)?.estimate : undefined;
    const end = endOf(row, pairings, entries);
    const pair = tournamentFormatOf(row) === `duel` ? pairOf(entries, pairings, lines) : undefined;
    const leaders = pair === undefined ? leadersOf(entries, pairings, lines) : undefined;
    return {
        ...summaryBase(row),
        entrants,
        winner,
        round: row.status === `running` ? roundOf(pairings) : null,
        ...(row.endedAt === null ? {} : { endedAt: isoOf(row.endedAt) }),
        ...(end === undefined ? {} : { end }),
        ...(estimate === undefined || first === undefined ? {} : { lead: { bot: first.bot, ...deleted, estimate } }),
        ...(pair === undefined ? {} : { pair }),
        ...(leaders === undefined ? {} : { leaders }),
    };
}

// The game slots that score for someone: played, a no-show, or a forfeit.
const scoring = new Set([`played`, `no_show`, `forfeit`]);

// A round robin's bots first in the standings, their points, and the games each played that scored; none before a point.
function leadersOf(entries: readonly EntryRow[], pairings: readonly PairingView[], lines: ReturnType<typeof standingsOf>): TournamentLeaders | undefined {
    const top = lines.filter((line) => line.rank === 1);
    const first = top[0];
    if (first === undefined || first.points === 0) return undefined;
    const games = scoredOf(pairings)
        .filter((pairing) => pairing.first === first.bot || pairing.second === first.bot)
        .reduce((sum, pairing) => sum + pairing.games.filter((game) => scoring.has(game.kind)).length, 0);
    const bots = top.flatMap((line) => {
        const entry = entries.find((candidate) => candidate.botId === line.bot);
        return entry === undefined ? [] : [{ name: entry.bot, ...(entry.deleted ? { deleted: true as const } : {}) }];
    });
    const [lead, ...rest] = bots;
    return lead === undefined ? undefined : { bots: [lead, ...rest], points: first.points, games };
}

// A duel's two bots in the order named, their points, and every game, as a list row's score cells draw them.
function pairOf(entries: readonly EntryRow[], pairings: readonly PairingView[], lines: ReturnType<typeof standingsOf>): TournamentPair | undefined {
    const [one, two] = entries;
    const pairing = pairings[0];
    if (one === undefined || two === undefined || pairing === undefined) return undefined;
    const side = (entry: EntryRow) => ({ ...botOf(entry, entry.botId), points: lines.find((line) => line.bot === entry.botId)?.points ?? 0 });
    return { first: side(one), second: side(two), games: gamesOf(pairing, false) };
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

// Which tournaments a list holds: one bot's, one person's, tests alone, or every one; and whose bot each names under yours.
interface TournamentListFilter {
    readonly botId: string | null;
    // A person's: set up by them, or with a bot of theirs entered.
    readonly userId: string | null;
    readonly test: boolean;
    // The signed-in caller, whose bot each row names.
    readonly viewerId: string | null;
}

// The tournament list: every running one, those waiting, and the latest
// over; for a bot, only those it entered, each with its place; for a
// person, only theirs; and for a signed-in caller, each one their bot
// plays names it and its place.
function tournamentList(query: Query, filter: TournamentListFilter): TournamentList {
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
    const all = (statuses: TournamentStatus[], order: SQL[], limit: number) =>
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
        past: all([`finished`, `stopped`, `cut_short`, `called_off`, `canceled`], [desc(sql`coalesce(${tournaments.endedAt}, ${tournaments.startsAt})`)], tournamentListPastCap).map(summary),
    };
}

interface TournamentApiDeps {
    query: Query;
    presence: PresenceRegistry;
    games: GameRegistry;
    gate: StartGate;
    limits: CredentialLimits & ClientLimits;
    tournaments: TournamentScheduler;
    // The lot that picks which bot plays x in a pair's single game.
    random: () => number;
    now: () => number;
}

// Every listed bot's switch and its running duels and round robins, as the
// bot list orders them; a bot kept in more than its cap from before the cap
// held reads as full.
function tournamentBotStates(query: Query): TournamentBotState[] {
    const switches = new Map(query.select({ id: bots.id, on: bots.duelsByOthers }).from(bots).all().map((row) => [row.id, row.on === 1]));
    return listBots(query).map((bot) => ({
        name: bot.name,
        duelsByOthers: switches.get(bot.id) ?? true,
        running: Math.min(countRunningTournamentsOfBot(query, bot.id), tournamentPerBotCap),
    }));
}

const eventLengths: ReadonlySet<number> = new Set(tournamentGameCounts);

const tournamentBusy: Refusal = { status: 400, code: `tournament_busy`, error: `you run your most duels and round robins at once` };

function isUniqueViolation(error: unknown): boolean {
    return error instanceof Error && `code` in error && String(error.code).startsWith(`SQLITE_CONSTRAINT_UNIQUE`);
}

/**
 * The tournament routes: the reads, public and memoized per tournament;
 * the owner's entry while the weekly waits; and a person's duel or round
 * robin, set up, stopped, and left by a bot's owner.
 */
export function registerTournamentApi(app: FastifyInstance, deps: TournamentApiDeps): void {
    const { query, limits, gate } = deps;
    const memo = new WindowMemo<string>({ windowMs: tournamentDetailMemoMs, now: deps.now });
    const exports = new TournamentExports();

    // A change shows on its page, in every bot's list, and in the bots' states at once.
    const forget = (id: string) => {
        memo.forget((key) => key === id || key.startsWith(`bot:`) || key === `bots`);
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
            const dayStart = utcDay(Math.floor(deps.now() / 1000)).start;
            const quota = mine && viewer !== null ? { quota: { live: runningSlotsOf(query, viewer).length, today: countSetUpSince(query, viewer, dayStart) } } : {};
            return reply.header(`content-type`, `application/json; charset=utf-8`).send(JSON.stringify(tournamentListSchema.parse({ ...list, ...quota })));
        }
        const bot = nameSyntaxSchema.safeParse(name).success
            ? query.select({ id: bots.id }).from(bots).where(and(eq(bots.nameKey, nameKeyOf(name)), isNull(bots.deletedAt))).get()
            : undefined;
        if (bot === undefined) return reply.code(404).send({ error: `no such bot`, code: `not_found` });
        // A bot's list reads the standings of every tournament it entered, so it shares the detail's window.
        const body = memo.read(`bot:${bot.id}:${String(test)}`, () => JSON.stringify(tournamentListSchema.parse(tournamentList(query, { botId: bot.id, userId: null, test, viewerId: null }))));
        return reply.header(`content-type`, `application/json; charset=utf-8`).send(body);
    });

    app.post(`/api/tournaments`, { config: { limit: `principal` } }, async (request, reply) => {
        const user = sessionUser(query, request);
        if (user === null) return reply.code(401).send({ error: `no signed-in user`, code: `unauthorized` });
        if (limits.refuse(reply, `principal`, `user:${user.id}`)) return reply;
        const parsed = createTournamentRequestSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: `the request fails validation`, code: `bad_request` });
        if (gate.refuse(reply)) return reply;
        const terms = parsed.data;
        const picked = terms.bots.map((wanted) => ({ wanted, bot: readBot(query, { nameKey: nameKeyOf(wanted.name) }) }));
        const found = picked.flatMap(({ wanted, bot }) => (bot === undefined ? [] : [{ wanted, bot }]));
        if (found.length < picked.length) return reply.code(404).send({ error: `no such bot`, code: `not_found` });
        const field = found.map(({ bot }) => ({ bot, reasons: botGates(bot, { starterId: user.id, timeControl: terms.timeControl }, { ...deps, reservations: deps.tournaments }) }));
        const refused = gateRefusal(field);
        if (refused !== null) return sendRefusal(reply, refused);
        const levels = found.map(({ wanted, bot }) => ({ bot, level: chosenLevel(bot, wanted.level) }));
        const unknown = levels.find((each) => each.level === undefined);
        if (unknown !== undefined) return sendRefusal(reply, { status: 400, code: `unknown_level`, error: `a bot declares no such level`, bot: unknown.bot.name });
        // One person on every seat makes a test, whoever set it up.
        const test = new Set(found.map(({ bot }) => bot.ownerId)).size === 1;
        const now = Math.floor(deps.now() / 1000);
        const { start: dayStart, secondsLeft: untilTomorrow } = utcDay(now);
        // The quotas are read where the tournament is written, as the daily caps are.
        const create = () =>
            query.transaction((tx): { id: string } | Refusal => {
                const busy = busyBot(field, (botId) => countRunningTournamentsOfBot(tx, botId), tournamentPerBotCap);
                if (busy !== undefined) return { status: 400, code: `bot_busy`, error: `a bot is at its game cap, in the weekly, or in its most duels and round robins`, bot: busy.name };
                if (!test && !eventLengths.has(terms.gamesPerPair)) return { status: 400, code: `test_only`, error: `only a test of one person's bots plays that many games a pair` };
                if (!gamesPerPairFits(found.length, terms.gamesPerPair, test)) return { status: 400, code: `too_many_games`, error: `a bot would play more games than one tournament holds` };
                const held = runningSlotsOf(tx, user.id);
                const liveSlot = Array.from({ length: tournamentLiveCap }, (_, index) => index + 1).find((slot) => !held.includes(slot));
                if (liveSlot === undefined) return tournamentBusy;
                if (countSetUpSince(tx, user.id, dayStart) >= tournamentDailyCap) {
                    return { status: 429, code: `daily_tournament_cap`, error: `you set up your duels and round robins for the day`, retryAfter: untilTomorrow };
                }
                const entrants: PersonEntrant[] = levels.map(({ bot, level }) => ({
                    botId: bot.id,
                    ownerId: bot.ownerId,
                    name: bot.name,
                    rating: readRating(tx, { kind: `bot`, id: bot.id }).rating,
                    level: level ?? null,
                    version: bot.version,
                }));
                const id = insertPersonTournament(
                    tx,
                    { createdBy: user.id, entrants, test, gamesPerPair: terms.gamesPerPair, timeControl: terms.timeControl, openingPlies: terms.openingPlies, liveSlot },
                    now,
                    deps.random,
                );
                return { id };
            });
        let created: { id: string } | Refusal;
        try {
            created = create();
        } catch (error) {
            // Two requests at once: the unique index holds the person to their live slots.
            if (!isUniqueViolation(error)) throw error;
            created = tournamentBusy;
        }
        if (`code` in created) return sendRefusal(reply, created);
        deps.tournaments.advance(created.id);
        forget(created.id);
        return reply.code(201).send(detailOf(created.id));
    });

    app.get(`/api/tournaments/bots`, { config: { limit: `public` } }, async (_request, reply) => {
        const body = memo.read(`bots`, () => JSON.stringify(tournamentBotStatesSchema.parse(tournamentBotStates(query))));
        return reply.header(`content-type`, `application/json; charset=utf-8`).send(body);
    });

    app.get<{ Params: IdParams }>(`/api/tournaments/:id`, { config: { limit: `public` } }, async (request, reply) => {
        const { id } = request.params;
        if (!tournamentIdSchema.safeParse(id).success) return reply.code(404).send({ error: `no such tournament`, code: `not_found` });
        const body = memo.read(id, () => {
            const detail = detailOf(id);
            return detail === null ? null : JSON.stringify(detail);
        });
        if (body === null) return reply.code(404).send({ error: `no such tournament`, code: `not_found` });
        return reply.header(`content-type`, `application/json; charset=utf-8`).send(body);
    });

    app.get<{ Params: IdParams }>(`/api/tournaments/:id/export`, { config: { limit: `public` } }, async (request, reply) => {
        const { id } = request.params;
        if (!tournamentIdSchema.safeParse(id).success) return reply.code(404).send({ error: `no such tournament`, code: `not_found` });
        if (limits.refuseExport(reply, request)) return reply;
        const detail = tournamentDetail(query, deps, id);
        if (detail === null) return reply.code(404).send({ error: `no such tournament`, code: `not_found` });
        const file = exports.read(query, detail, deps.now());
        return reply.header(`content-type`, `application/zip`).header(`content-disposition`, `attachment; filename="${file.fileName}"`).send(file.body);
    });

    app.post<{ Params: IdParams }>(`/api/tournaments/:id/stop`, { config: { limit: `principal` } }, async (request, reply) => {
        const user = sessionUser(query, request);
        if (user === null) return reply.code(401).send({ error: `no signed-in user`, code: `unauthorized` });
        if (limits.refuse(reply, `principal`, `user:${user.id}`)) return reply;
        const { id } = request.params;
        const row = tournamentIdSchema.safeParse(id).success ? findTournament(query, id) : undefined;
        if (row === undefined) return reply.code(404).send({ error: `no such tournament`, code: `not_found` });
        if (row.origin !== `person` || row.createdBy !== user.id) return reply.code(403).send({ error: `you did not set it up`, code: `not_yours` });
        if (!deps.tournaments.stopPersonTournament(id, `creator`)) return reply.code(409).send({ error: `it is already over`, code: `over` });
        forget(id);
        return reply.code(200).send(detailOf(id));
    });

    app.post<{ Params: IdParams }>(`/api/tournaments/:id/withdraw`, { config: { limit: `principal` } }, async (request, reply) => {
        const user = sessionUser(query, request);
        if (user === null) return reply.code(401).send({ error: `no signed-in user`, code: `unauthorized` });
        if (limits.refuse(reply, `principal`, `user:${user.id}`)) return reply;
        const parsed = tournamentWithdrawRequestSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: `the request fails validation`, code: `bad_request` });
        const { id } = request.params;
        const row = tournamentIdSchema.safeParse(id).success ? findTournament(query, id) : undefined;
        const bot = readBot(query, { nameKey: nameKeyOf(parsed.data.bot) });
        // The weekly holds its entrants to the end; only a tournament a person set up lets a bot go.
        if (row?.origin !== `person` || bot === undefined) return reply.code(404).send({ error: `no such duel, round robin, or bot`, code: `not_found` });
        if (bot.ownerId !== user.id) return reply.code(403).send({ error: `the bot is someone else's`, code: `not_owner` });
        const left = deps.tournaments.withdrawByOwner(id, bot.id);
        if (left === `over`) return reply.code(409).send({ error: `it is over`, code: `over` });
        if (left === `not_playing`) return reply.code(409).send({ error: `the bot plays no further game in it`, code: `not_playing` });
        forget(id);
        return reply.code(200).send(detailOf(id));
    });

    app.put<{ Params: IdParams }>(`/api/tournaments/:id/entry`, { config: { limit: `principal` } }, async (request, reply) => {
        const user = sessionUser(query, request);
        if (user === null) return reply.code(401).send({ error: `no session`, code: `unauthorized` });
        if (limits.refuse(reply, `principal`, `user:${user.id}`)) return reply;
        const parsed = tournamentEntryRequestSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: `the request fails validation`, code: `bad_request` });
        const { id } = request.params;
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

    app.delete<{ Params: IdParams }>(`/api/tournaments/:id/entry`, { config: { limit: `principal` } }, async (request, reply) => {
        const user = sessionUser(query, request);
        if (user === null) return reply.code(401).send({ error: `no session`, code: `unauthorized` });
        if (limits.refuse(reply, `principal`, `user:${user.id}`)) return reply;
        const { id } = request.params;
        const tournament = query.select({ status: tournaments.status }).from(tournaments).where(eq(tournaments.id, id)).get();
        if (tournament === undefined) return reply.code(404).send({ error: `no such tournament`, code: `not_found` });
        if (tournament.status !== `scheduled`) return reply.code(409).send({ error: `the tournament no longer waits`, code: `closed` });
        query.delete(tournamentEntries).where(and(eq(tournamentEntries.tournamentId, id), eq(tournamentEntries.ownerId, user.id))).run();
        forget(id);
        return reply.code(204).send();
    });
}
