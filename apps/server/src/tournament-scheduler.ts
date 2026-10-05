import {
    acceptsCovers,
    acceptsSchema,
    boardCellSchema,
    botConcurrentGameCap,
    botDailyCap,
    expandTournamentName,
    openingPliesSchema,
    pairDailyCap,
    presenceGraceMs,
    seatLevelSchema,
    timeControlSchema,
    tournamentMinPresent,
    tournamentRoundGapMs,
    type FinishReason,
    type OpeningPlies,
    type SeatLevel,
    type Side,
    type TimeControl,
    type TournamentEntryReason,
} from '@hexo-arena/contract';
import { and, asc, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { recordAdminAction } from './admin-store';
import type { Query } from './db';
import { bots, games, tournamentEntries, tournamentPairings, tournaments, users } from './db/schema';
import { duelGateFailures, levelNow, type DuelGateFailure } from './duel-runner';
import { readDuelBot, type DuelBotRecord } from './duel-store';
import type { FinishedGameNote, GameRegistry } from './game-registry';
import { countBotBotGamesSince, countPairBotGamesSince } from './game-store';
import type { PresenceRegistry } from './presence';
import { readRating } from './rating-store';
import { missedTooManyInARow, slotDone, storedSlot, xSeatOf, type PairingSeat, type ScoredPairing, type SlotResult } from './round-robin';
import { isCurrentGeneration, isPaused } from './site-state';
import { dueRuleStarts, hasRuleTournament, readTournamentRules } from './tournament-rules';
import { cancelTournament, createTournament, insertPairings, runningRoundRobinsBy, stopRoundRobin as markStopped, type StopReason } from './tournament-store';
import { utcDay } from './utc-day';

// Why a bot is taken out of every tournament, as a running one's withdrawn entry records it.
type WithdrawReason = `banned` | `delisted` | `deleted`;

type SlotState = SlotResult[`kind`];

interface PairingRow {
    readonly id: string;
    readonly round: number;
    readonly leg: number;
    readonly firstBotId: string;
    readonly secondBotId: string;
    readonly openingCells: string | null;
    readonly game1: string;
    readonly game1Seat: string | null;
    readonly game2: string;
    readonly game2Seat: string | null;
}

interface RunningTournament {
    readonly id: string;
    readonly origin: `operator` | `person`;
    readonly createdBy: string | null;
    readonly timeControl: TimeControl;
    readonly openingPlies: OpeningPlies;
}

/** A slot's wait for bots not ready, and when it is scored a no-show. */
interface Grace {
    readonly tournamentId: string;
    readonly until: number;
    readonly missing: readonly string[];
}

interface SchedulerDeps {
    readonly query: Query;
    readonly presence: PresenceRegistry;
    readonly games: GameRegistry;
    readonly generation: number;
    // Whether this process is draining for a deploy, so it starts nothing.
    readonly draining: () => boolean;
    // How soon a weekly rule's tournament may start, as tournament-create
    // holds the operator to.
    readonly leadMs: number;
    // Who the audit rows of a weekly rule's tournaments name.
    readonly actor: string;
    // The pause between rounds; a test that plays rounds on the real clock shortens it.
    readonly roundGapMs?: number;
    readonly now?: () => number;
}

// A bot taken out of play, no longer taking games from the person who set
// the round robin up, or held by the weekly until it ends, is not ready
// within any grace, so it leaves at once.
const lasting: ReadonlyMap<DuelGateFailure, TournamentEntryReason> = new Map([
    [`deleted`, `deleted`],
    [`delisted`, `delisted`],
    [`banned`, `banned`],
    [`refused`, `refused`],
    [`tournament`, `tournament`],
]);

function scored(row: PairingRow): ScoredPairing {
    return {
        round: row.round,
        leg: row.leg,
        first: row.firstBotId,
        second: row.secondBotId,
        games: [storedSlot(row.game1, row.game1Seat), storedSlot(row.game2, row.game2Seat)],
    };
}

function slotKey(pairingId: string, game: 1 | 2): string {
    return `${pairingId}:${String(game)}`;
}

const pairOf = (row: PairingRow) => `${row.firstBotId} ${row.secondBotId}`;

const done = (row: PairingRow) => scored(row).games.every(slotDone);

/**
 * Runs every round robin in this process, the operator's and those people
 * set up: creates each weekly rule's tournaments in time for entries,
 * starts each weekly when it is due, and a person's as it is set up,
 * plays their rounds as bot games announced on the bots' streams, rated
 * in the weekly and never in a person's, scores no-shows and withdrawals,
 * and picks up where each stood after a restart.
 * Its state lives in the database; only grace deadlines and round gaps are
 * held in memory, and restart afresh at boot.
 */
export class TournamentScheduler {
    readonly #deps: SchedulerDeps;
    readonly #graces = new Map<string, Grace>();
    readonly #roundReadyAt = new Map<string, { round: number; at: number }>();
    #timer: ReturnType<typeof setInterval> | null = null;

    constructor(deps: SchedulerDeps) {
        this.#deps = deps;
        this.#resume();
        this.#createFromRules(this.#now());
    }

    get #query(): Query {
        return this.#deps.query;
    }

    #now(): number {
        return (this.#deps.now ?? Date.now)();
    }

    /** Ticks every interval until stopped; a timer that holds no process open. */
    start(intervalMs: number): void {
        this.#timer = setInterval(() => {
            this.tick();
        }, intervalMs);
        this.#timer.unref();
    }

    stop(): void {
        if (this.#timer !== null) clearInterval(this.#timer);
        this.#timer = null;
    }

    /** One pass: create what the weekly rules call for, move every running tournament on, then start the weekly when it is due. */
    tick(): void {
        if (this.#deps.draining()) return;
        const now = this.#now();
        this.#createFromRules(now);
        // A pause starts nothing, a due tournament included, which starts on
        // the first pass after the resume; the grace counts again from there.
        if (isPaused(this.#query)) {
            this.#graces.clear();
            return;
        }
        const running = this.#running();
        for (const tournament of running) this.#advance(tournament, now);
        // A start is a pass of its own; the first round begins on the next.
        if (!running.some((tournament) => tournament.origin === `operator`)) this.#startDue(now);
    }

    /** Moves one tournament on at once, as setting a round robin up does for its first round. */
    advance(id: string): void {
        if (this.#deps.draining() || isPaused(this.#query)) return;
        const tournament = this.#running().find((each) => each.id === id);
        if (tournament !== undefined) this.#advance(tournament, this.#now());
    }

    /** Whether a bot is reserved by the operator's running tournament, so it takes no other new game. */
    isReserved(botId: string): boolean {
        return (
            this.#query
                .select({ botId: tournamentEntries.botId })
                .from(tournamentEntries)
                .innerJoin(tournaments, eq(tournaments.id, tournamentEntries.tournamentId))
                .where(
                    and(
                        eq(tournamentEntries.botId, botId),
                        eq(tournamentEntries.state, `playing`),
                        eq(tournaments.status, `running`),
                        eq(tournaments.origin, `operator`),
                    ),
                )
                .get() !== undefined
        );
    }

    /** The bots a running tournament's games wait for, each with the earliest end of its wait. */
    waitingOf(tournamentId: string): { botId: string; until: number }[] {
        const waits = new Map<string, number>();
        for (const grace of this.#graces.values()) {
            if (grace.tournamentId !== tournamentId) continue;
            for (const botId of grace.missing) waits.set(botId, Math.min(waits.get(botId) ?? grace.until, grace.until));
        }
        return [...waits].map(([botId, until]) => ({ botId, until }));
    }

    /** When a running tournament's next round starts, while it waits out the gap after the last. */
    nextRoundAt(tournamentId: string): number | null {
        return this.#roundReadyAt.get(tournamentId)?.at ?? null;
    }

    /**
     * Takes a bot out of every tournament: a waiting entry is removed, a
     * playing one withdrawn, its games still to come scoring for its
     * opponents; its finished games stand and a live one plays on.
     */
    withdraw(botId: string, reason: WithdrawReason): void {
        const waiting = this.#query
            .select({ id: tournaments.id })
            .from(tournaments)
            .where(eq(tournaments.status, `scheduled`))
            .all()
            .map((row) => row.id);
        if (waiting.length > 0) {
            this.#query.delete(tournamentEntries).where(and(eq(tournamentEntries.botId, botId), inArray(tournamentEntries.tournamentId, waiting))).run();
        }
        for (const tournament of this.#running()) this.#leave(tournament.id, botId, reason);
    }

    /**
     * Withdraws a bot from every running round robin someone other than its
     * owner set up, once its owner turns duels by others off.
     */
    withdrawRefused(botId: string): void {
        const owner = this.#query.select({ ownerId: bots.ownerId }).from(bots).where(eq(bots.id, botId)).get()?.ownerId;
        for (const tournament of this.#running()) {
            if (tournament.origin === `person` && tournament.createdBy !== owner) this.#leave(tournament.id, botId, `refused`);
        }
    }

    /**
     * Its owner withdraws a bot from a running round robin a person set up:
     * its live game plays on and counts, and its games still to come score
     * for its opponents.
     */
    withdrawByOwner(tournamentId: string, botId: string): `withdrawn` | `over` | `not_playing` {
        const tournament = this.#query.select({ status: tournaments.status }).from(tournaments).where(eq(tournaments.id, tournamentId)).get();
        if (tournament?.status !== `running`) return `over`;
        return this.#leave(tournamentId, botId, `owner`) ? `withdrawn` : `not_playing`;
    }

    /**
     * Stops a running round robin a person set up: no further game starts,
     * every game still to come is not played, and a live one plays on to
     * its result, since ending it would be an escape from a losing position.
     */
    stopRoundRobin(id: string, reason: StopReason): boolean {
        const stopped = this.#query.transaction((tx) => {
            if (!markStopped(tx, id, reason, Math.floor(this.#now() / 1000))) return false;
            this.#settleUnplayed(tx, id);
            return true;
        });
        if (stopped) this.#forget(id);
        return stopped;
    }

    /** Stops every running round robin a person set up, once their account is banned or deleted. */
    stopSetUpBy(userId: string, reason: Exclude<StopReason, `creator`>): void {
        for (const id of runningRoundRobinsBy(this.#query, userId)) this.stopRoundRobin(id, reason);
    }

    /**
     * Cancels a tournament: its live games end aborted and unrated, and its
     * finished games stay as they were. Answers as the store does.
     */
    cancel(id: string): ReturnType<typeof cancelTournament> & { aborted?: number } {
        const live = this.#query
            .select({ gameId: games.id })
            .from(games)
            .innerJoin(tournamentPairings, eq(tournamentPairings.id, games.pairingId))
            .where(and(eq(tournamentPairings.tournamentId, id), sql`${games.finishedAt} is null`))
            .all();
        const outcome = cancelTournament(this.#query, id, Math.floor(this.#now() / 1000));
        if (outcome.kind !== `canceled`) return outcome;
        this.#forget(id);
        let aborted = 0;
        for (const { gameId } of live) if (this.#deps.games.abort(gameId)) aborted += 1;
        return { ...outcome, aborted };
    }

    /** Records how a tournament game ended; a game the drain cut stays live, to replay at the next boot. */
    gameFinished(finished: FinishedGameNote): void {
        const slot = this.#query
            .select({
                pairingId: games.pairingId,
                game: games.pairingGame,
                state1: tournamentPairings.game1,
                state2: tournamentPairings.game2,
                tournamentId: tournamentPairings.tournamentId,
                status: tournaments.status,
            })
            .from(games)
            .innerJoin(tournamentPairings, eq(tournamentPairings.id, games.pairingId))
            .innerJoin(tournaments, eq(tournaments.id, tournamentPairings.tournamentId))
            .where(eq(games.id, finished.gameId))
            .get();
        if (slot?.pairingId == null || (slot.game !== 1 && slot.game !== 2)) return;
        if (slot.status !== `running` && slot.status !== `stopped`) return;
        if ((slot.game === 1 ? slot.state1 : slot.state2) !== `live`) return;
        if (finished.reason === `aborted` && !isCurrentGeneration(this.#query, this.#deps.generation)) return;
        this.#settle(this.#query, slot.pairingId, slot.game, this.#outcomeOf(slot.game, finished.winner, finished.reason));
        // A stopped round robin plays its live games out and starts nothing after them.
        if (slot.status === `stopped`) this.#settleUnplayed(this.#query, slot.tournamentId);
        else this.#checkWithdrawals(slot.pairingId);
    }

    #outcomeOf(game: 1 | 2, winner: Side | null, reason: FinishReason): { state: SlotState; seat: string | null } {
        if (reason === `aborted`) return { state: `aborted`, seat: null };
        const xSeat = xSeatOf(game);
        const seat: PairingSeat | null = winner === null ? null : winner === `x` ? xSeat : xSeat === `first` ? `second` : `first`;
        return { state: `played`, seat };
    }

    // A start whose tournament exists in any state is done with,
    // so a restart or a clock step creates no week twice;
    // a full waiting cap leaves the start to a later pass.
    #createFromRules(now: number): void {
        for (const rule of readTournamentRules(this.#query)) {
            for (const startsAt of dueRuleStarts(rule, now, this.#deps.leadMs)) {
                this.#query.transaction((tx) => {
                    if (hasRuleTournament(tx, rule.id, startsAt)) return;
                    const name = expandTournamentName(rule.namePattern, startsAt * 1000);
                    const created = createTournament(
                        tx,
                        { name, startsAt, timeControl: rule.timeControl, openingPlies: rule.openingPlies, maxEntrants: rule.maxEntrants, ruleId: rule.id },
                        Math.floor(now / 1000),
                        this.#deps.leadMs,
                    );
                    if (created.kind !== `created`) return;
                    recordAdminAction(tx, { actor: this.#deps.actor, action: `tournament-create`, target: name, reason: `weekly rule ${String(rule.id)}` });
                });
            }
        }
    }

    // The operator's first, then the earliest started, so the weekly is served first.
    #running(): RunningTournament[] {
        return this.#query
            .select({
                id: tournaments.id,
                origin: tournaments.origin,
                createdBy: tournaments.createdBy,
                timeControl: tournaments.timeControl,
                openingPlies: tournaments.openingPlies,
            })
            .from(tournaments)
            .where(eq(tournaments.status, `running`))
            .orderBy(sql`${tournaments.origin} = 'person'`, asc(tournaments.startedAt), asc(tournaments.id))
            .all()
            .map((row) => ({
                id: row.id,
                origin: row.origin,
                createdBy: row.createdBy,
                timeControl: timeControlSchema.parse(JSON.parse(row.timeControl)),
                openingPlies: openingPliesSchema.parse(row.openingPlies),
            }));
    }

    // Starts the earliest tournament whose time has come: connected,
    // eligible entrants play, and too few calls it off. Its field leaves
    // every round robin a person set up, as the weekly holds its entrants.
    #startDue(now: number): void {
        const seconds = Math.floor(now / 1000);
        const due = this.#query
            .select({ id: tournaments.id, timeControl: tournaments.timeControl })
            .from(tournaments)
            .where(and(eq(tournaments.status, `scheduled`), sql`${tournaments.startsAt} <= ${seconds}`))
            .orderBy(asc(tournaments.startsAt))
            .get();
        if (due === undefined) return;
        const clock = timeControlSchema.parse(JSON.parse(due.timeControl));
        const entries = this.#query
            .select({
                botId: tournamentEntries.botId,
                name: bots.name,
                accepts: bots.accepts,
                delistedAt: bots.delistedAt,
                deletedAt: bots.deletedAt,
                bannedAt: users.bannedAt,
            })
            .from(tournamentEntries)
            .innerJoin(bots, eq(bots.id, tournamentEntries.botId))
            .innerJoin(users, eq(users.id, tournamentEntries.ownerId))
            .where(eq(tournamentEntries.tournamentId, due.id))
            .all();
        const present = entries.filter(
            (entry) => this.#deps.presence.isOnline(entry.botId) && entry.delistedAt === null && entry.deletedAt === null && entry.bannedAt === null,
        );
        const clockFits = present.filter((entry) => acceptsCovers(entry.accepts === null ? undefined : acceptsSchema.parse(JSON.parse(entry.accepts)), clock));
        const needed = 2 * (clockFits.length - 1);
        const day = utcDay(seconds).start;
        const field = clockFits.filter((entry) => botDailyCap - countBotBotGamesSince(this.#query, entry.botId, day) >= needed);
        const stateOf = (botId: string): { state: string; reason: string | null } => {
            if (!present.some((entry) => entry.botId === botId)) return { state: `absent`, reason: null };
            if (!clockFits.some((entry) => entry.botId === botId)) return { state: `left_out`, reason: `clock` };
            if (!field.some((entry) => entry.botId === botId)) return { state: `left_out`, reason: `daily_cap` };
            return { state: field.length < tournamentMinPresent ? `entered` : `playing`, reason: null };
        };
        const started = this.#query.transaction((tx) => {
            for (const entry of entries) {
                const { state, reason } = stateOf(entry.botId);
                const rating = state === `playing` ? readRating(tx, { kind: `bot`, id: entry.botId }).rating : null;
                tx.update(tournamentEntries)
                    .set({ state, reason, ratingAtStart: rating })
                    .where(and(eq(tournamentEntries.tournamentId, due.id), eq(tournamentEntries.botId, entry.botId)))
                    .run();
            }
            if (field.length < tournamentMinPresent) {
                tx.update(tournaments).set({ status: `called_off`, endedAt: seconds }).where(eq(tournaments.id, due.id)).run();
                return false;
            }
            tx.update(tournaments).set({ status: `running`, startedAt: seconds }).where(eq(tournaments.id, due.id)).run();
            // The strongest at the start take the fixed seats of the schedule.
            const order = [...field]
                .map((entry) => ({ ...entry, rating: readRating(tx, { kind: `bot`, id: entry.botId }).rating }))
                .sort((one, two) => two.rating - one.rating || one.name.localeCompare(two.name))
                .map((entry) => entry.botId);
            insertPairings(tx, due.id, order, 1);
            return true;
        });
        if (!started) return;
        for (const entry of field) {
            for (const tournament of this.#running()) if (tournament.origin === `person`) this.#leave(tournament.id, entry.botId, `tournament`);
        }
    }

    #pairings(tournamentId: string): PairingRow[] {
        return this.#query
            .select({
                id: tournamentPairings.id,
                round: tournamentPairings.round,
                leg: tournamentPairings.leg,
                firstBotId: tournamentPairings.firstBotId,
                secondBotId: tournamentPairings.secondBotId,
                openingCells: tournamentPairings.openingCells,
                game1: tournamentPairings.game1,
                game1Seat: tournamentPairings.game1Seat,
                game2: tournamentPairings.game2,
                game2Seat: tournamentPairings.game2Seat,
            })
            .from(tournamentPairings)
            .where(eq(tournamentPairings.tournamentId, tournamentId))
            .orderBy(asc(tournamentPairings.round), asc(tournamentPairings.leg))
            .all();
    }

    #withdrawn(tournamentId: string): Set<string> {
        return new Set(
            this.#query
                .select({ botId: tournamentEntries.botId })
                .from(tournamentEntries)
                .where(and(eq(tournamentEntries.tournamentId, tournamentId), eq(tournamentEntries.state, `withdrawn`)))
                .all()
                .map((row) => row.botId),
        );
    }

    #advance(tournament: RunningTournament, now: number): void {
        const pairings = this.#pairings(tournament.id);
        const round = pairings.find((row) => !done(row))?.round;
        if (round === undefined) {
            this.#query
                .update(tournaments)
                .set({ status: `finished`, endedAt: Math.floor(now / 1000) })
                .where(and(eq(tournaments.id, tournament.id), eq(tournaments.status, `running`)))
                .run();
            this.#forget(tournament.id);
            return;
        }
        const inRound = pairings.filter((row) => row.round === round);
        const begun = inRound.some((row) => row.game1 !== `pending`);
        // Each round after the first waits out the gap from when the one before it ended.
        if (!begun && round > 1) {
            const held = this.#roundReadyAt.get(tournament.id);
            const readyAt = held?.round === round ? held.at : now + (this.#deps.roundGapMs ?? tournamentRoundGapMs);
            this.#roundReadyAt.set(tournament.id, { round, at: readyAt });
            if (now < readyAt) return;
        }
        this.#roundReadyAt.delete(tournament.id);
        // A pair plays its openings one after another, the next once the one before is over.
        const pairs = new Map<string, PairingRow[]>();
        for (const row of inRound) pairs.set(pairOf(row), [...(pairs.get(pairOf(row)) ?? []), row]);
        for (const legs of pairs.values()) {
            for (const leg of legs) {
                if (done(leg)) continue;
                this.#advancePairing(tournament, leg, now);
                const after = this.#pairings(tournament.id).find((row) => row.id === leg.id);
                if (after === undefined || !done(after)) break;
            }
        }
    }

    // Plays a pairing's next game: game 1, then game 2 once game 1 is over.
    #advancePairing(tournament: RunningTournament, pairing: PairingRow, now: number): void {
        for (const game of [1, 2] as const) {
            const state = game === 1 ? pairing.game1 : pairing.game2;
            if (state === `live`) return;
            if (state !== `pending`) continue;
            const settled = this.#startSlot(tournament, pairing, game, now);
            if (!settled) return;
            // A slot settled at once lets game 2 begin within this pass.
            pairing = this.#pairings(tournament.id).find((row) => row.id === pairing.id) ?? pairing;
        }
        this.#checkWithdrawals(pairing.id);
    }

    // Starts a slot's game, or settles it without one; answers whether the
    // slot is over.
    #startSlot(tournament: RunningTournament, pairing: PairingRow, game: 1 | 2, now: number): boolean {
        const key = slotKey(pairing.id, game);
        const seats = [pairing.firstBotId, pairing.secondBotId] as const;
        if (tournament.origin === `person`) this.#leaveIfGone(tournament, seats);
        const withdrawn = this.#withdrawn(tournament.id);
        const out = [withdrawn.has(seats[0]), withdrawn.has(seats[1])] as const;
        if (out[0] || out[1]) {
            this.#settle(this.#query, pairing.id, game, { state: `forfeit`, seat: out[0] && out[1] ? `both` : out[0] ? `first` : `second` });
            this.#graces.delete(key);
            return true;
        }
        const here = seats.map((botId) => this.#ready(tournament, botId));
        if (here[0] === true && here[1] === true) {
            this.#graces.delete(key);
            if (tournament.origin === `operator` && this.#capped(seats, now)) {
                this.#settle(this.#query, pairing.id, game, { state: `not_played`, seat: null });
                return true;
            }
            this.#play(tournament, pairing, game);
            return false;
        }
        const missing = seats.filter((_, index) => here[index] !== true);
        const deadline = this.#graces.get(key)?.until ?? now + presenceGraceMs;
        this.#graces.set(key, { tournamentId: tournament.id, until: deadline, missing });
        if (now < deadline) return false;
        this.#graces.delete(key);
        this.#settle(this.#query, pairing.id, game, { state: `no_show`, seat: here[0] !== true && here[1] !== true ? `both` : here[0] !== true ? `first` : `second` });
        return true;
    }

    // The weekly's entering is consent, so its bots need only be connected
    // and below their game cap; a person's round robin passes the gates a
    // duel does, as the person who set it up would start one.
    #ready(tournament: RunningTournament, botId: string): boolean {
        if (tournament.origin === `operator`) return this.#deps.presence.isOnline(botId) && this.#deps.games.activeGameCount(botId) < botConcurrentGameCap;
        const bot = readDuelBot(this.#query, { id: botId });
        return bot !== undefined && this.#gateFailures(tournament, bot).length === 0;
    }

    #gateFailures(tournament: RunningTournament, bot: DuelBotRecord): DuelGateFailure[] {
        return duelGateFailures(bot, { starterId: tournament.createdBy, timeControl: tournament.timeControl }, {
            presence: this.#deps.presence,
            games: this.#deps.games,
            reservations: { isReserved: (botId: string) => this.isReserved(botId) },
        });
    }

    // A bot gone for good leaves a person's round robin at once, rather than
    // waiting out a grace for every game it has left.
    #leaveIfGone(tournament: RunningTournament, seats: readonly string[]): void {
        for (const botId of seats) {
            const bot = readDuelBot(this.#query, { id: botId });
            const reason = bot === undefined ? `deleted` : this.#gateFailures(tournament, bot).flatMap((failure) => lasting.get(failure) ?? [])[0];
            if (reason !== undefined) this.#leave(tournament.id, botId, reason);
        }
    }

    // Withdraws a playing bot; answers whether it was playing.
    #leave(tournamentId: string, botId: string, reason: TournamentEntryReason): boolean {
        return (
            this.#query
                .update(tournamentEntries)
                .set({ state: `withdrawn`, reason })
                .where(and(eq(tournamentEntries.tournamentId, tournamentId), eq(tournamentEntries.botId, botId), eq(tournamentEntries.state, `playing`)))
                .run().changes === 1
        );
    }

    // The weekly's games are rated, so each counts toward the daily caps.
    #capped(seats: readonly [string, string], now: number): boolean {
        const day = utcDay(Math.floor(now / 1000)).start;
        return (
            countPairBotGamesSince(this.#query, { one: seats[0], two: seats[1] }, day) >= pairDailyCap ||
            countBotBotGamesSince(this.#query, seats[0], day) >= botDailyCap ||
            countBotBotGamesSince(this.#query, seats[1], day) >= botDailyCap
        );
    }

    #play(tournament: RunningTournament, pairing: PairingRow, game: 1 | 2): void {
        const [x, o] = game === 1 ? [pairing.firstBotId, pairing.secondBotId] : [pairing.secondBotId, pairing.firstBotId];
        const seat = (botId: string) => readDuelBot(this.#query, { id: botId });
        const xBot = seat(x);
        const oBot = seat(o);
        // Both rows stand: a bot deleted outright takes its pairings with it.
        if (xBot === undefined || oBot === undefined) return;
        // The pairing column holds the opening as its game wrote it.
        const stored = pairing.openingCells === null ? null : boardCellSchema.array().parse(JSON.parse(pairing.openingCells));
        // The slot is live before its game exists, so a finish heard at once
        // finds it; a game that never got created reads as pending at boot.
        this.#settle(this.#query, pairing.id, game, { state: `live`, seat: null });
        const person = tournament.origin === `person`;
        const { opening } = this.#deps.games.createScheduledGame({
            x: { id: x, name: xBot.name },
            o: { id: o, name: oBot.name },
            ...(person ? { levels: { x: levelNow(xBot, this.#entryLevel(tournament.id, x)), o: levelNow(oBot, this.#entryLevel(tournament.id, o)) } } : {}),
            unratedByChoice: person,
            test: person && xBot.ownerId === oBot.ownerId,
            timeControl: tournament.timeControl,
            openingPlies: tournament.openingPlies,
            opening: stored,
            tag: { kind: `pairing`, id: pairing.id, game },
        });
        if (stored === null) {
            this.#query.update(tournamentPairings).set({ openingCells: JSON.stringify(opening) }).where(eq(tournamentPairings.id, pairing.id)).run();
        }
    }

    #entryLevel(tournamentId: string, botId: string): SeatLevel | null {
        const level = this.#query
            .select({ level: tournamentEntries.level })
            .from(tournamentEntries)
            .where(and(eq(tournamentEntries.tournamentId, tournamentId), eq(tournamentEntries.botId, botId)))
            .get()?.level;
        return level == null ? null : seatLevelSchema.parse(JSON.parse(level));
    }

    #settle(query: Query, pairingId: string, game: 1 | 2, outcome: { state: SlotState; seat: string | null }): void {
        query
            .update(tournamentPairings)
            .set(game === 1 ? { game1: outcome.state, game1Seat: outcome.seat } : { game2: outcome.state, game2Seat: outcome.seat })
            .where(eq(tournamentPairings.id, pairingId))
            .run();
    }

    // Every game of a tournament still to start is not played; a second
    // game waits while its first plays on, and follows once it ends.
    #settleUnplayed(query: Query, tournamentId: string): void {
        const of = eq(tournamentPairings.tournamentId, tournamentId);
        query.update(tournamentPairings).set({ game1: `not_played`, game1Seat: null }).where(and(of, eq(tournamentPairings.game1, `pending`))).run();
        query
            .update(tournamentPairings)
            .set({ game2: `not_played`, game2Seat: null })
            .where(and(of, eq(tournamentPairings.game2, `pending`), ne(tournamentPairings.game1, `live`)))
            .run();
    }

    #forget(tournamentId: string): void {
        for (const [key, grace] of this.#graces) if (grace.tournamentId === tournamentId) this.#graces.delete(key);
        this.#roundReadyAt.delete(tournamentId);
    }

    // Withdraws a bot of the pairing that has now missed too many in a row.
    #checkWithdrawals(pairingId: string): void {
        const row = this.#query
            .select({ tournamentId: tournamentPairings.tournamentId, first: tournamentPairings.firstBotId, second: tournamentPairings.secondBotId })
            .from(tournamentPairings)
            .where(eq(tournamentPairings.id, pairingId))
            .get();
        if (row === undefined) return;
        const pairings = this.#pairings(row.tournamentId).map(scored);
        for (const botId of [row.first, row.second]) {
            if (missedTooManyInARow(botId, pairings)) this.#leave(row.tournamentId, botId, `missed`);
        }
    }

    // The boot sweep has aborted every game a stopped process left live; a
    // tournament game it caught replays once from its opening and sides, and
    // a game that ended before the stop is recorded as it ended. A stopped
    // round robin replays nothing, its cut game not played.
    #resume(): void {
        const open = this.#query
            .select({ id: tournaments.id, status: tournaments.status })
            .from(tournaments)
            .where(or(eq(tournaments.status, `running`), eq(tournaments.status, `stopped`)))
            .all();
        for (const tournament of open) {
            const stopped = tournament.status === `stopped`;
            for (const pairing of this.#pairings(tournament.id)) {
                for (const game of [1, 2] as const) {
                    if ((game === 1 ? pairing.game1 : pairing.game2) !== `live`) continue;
                    const played = this.#query
                        .select({ winner: games.winner, reason: games.finishReason })
                        .from(games)
                        .where(and(eq(games.pairingId, pairing.id), eq(games.pairingGame, game), isNotNull(games.finishedAt)))
                        .orderBy(asc(games.createdAt))
                        .all();
                    const last = played.at(-1);
                    if (last?.reason != null && last.reason !== `aborted`) {
                        this.#settle(this.#query, pairing.id, game, this.#outcomeOf(game, last.winner, last.reason));
                    } else if (stopped) {
                        this.#settle(this.#query, pairing.id, game, { state: `not_played`, seat: null });
                    } else if (last === undefined) {
                        this.#settle(this.#query, pairing.id, game, { state: `pending`, seat: null });
                    } else {
                        const replayed = played.filter((row) => row.reason === `aborted`).length > 1;
                        this.#settle(this.#query, pairing.id, game, replayed ? { state: `aborted`, seat: null } : { state: `pending`, seat: null });
                    }
                }
            }
            if (stopped) this.#settleUnplayed(this.#query, tournament.id);
        }
    }
}
