import {
    acceptsCovers,
    acceptsSchema,
    botConcurrentGameCap,
    botDailyCap,
    expandTournamentName,
    openingPliesSchema,
    pairDailyCap,
    timeControlSchema,
    tournamentMinPresent,
    tournamentPresenceGraceMs,
    tournamentRoundGapMs,
    type FinishReason,
    type Side,
} from '@hexo-arena/contract';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { recordAdminAction } from './admin-store';
import type { Query } from './db';
import { bots, games, tournamentEntries, tournamentPairings, tournaments, users } from './db/schema';
import type { FinishedGameNote, GameRegistry } from './game-registry';
import { countBotBotGamesSince, countPairBotGamesSince, type OpeningCell } from './game-store';
import type { PresenceRegistry } from './presence';
import { readRating } from './rating-store';
import { missedTwoInARow, roundRobin, slotDone, storedSlot, xSeatOf, type PairingSeat, type ScoredPairing, type SlotResult } from './round-robin';
import { isCurrentGeneration, isPaused } from './site-state';
import { dueRuleStarts, hasRuleTournament, readTournamentRules } from './tournament-rules';
import { cancelTournament, createTournament } from './tournament-store';

/** Why an entry is left out at the start or withdrawn later. */
export type WithdrawReason = `banned` | `delisted` | `deleted`;

type SlotState = SlotResult[`kind`];

interface PairingRow {
    readonly id: string;
    readonly round: number;
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
    readonly timeControl: string;
    readonly openingPlies: number;
}

export interface SchedulerDeps {
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
    readonly now?: () => number;
}

function scored(row: PairingRow): ScoredPairing {
    return {
        round: row.round,
        first: row.firstBotId,
        second: row.secondBotId,
        games: [storedSlot(row.game1, row.game1Seat), storedSlot(row.game2, row.game2Seat)],
    };
}

function slotKey(pairingId: string, game: 1 | 2): string {
    return `${pairingId}:${String(game)}`;
}

function utcDayStart(seconds: number): number {
    return Math.floor(seconds / 86_400) * 86_400;
}

/**
 * Runs the operator's round robins in this process:
 * creates each weekly rule's tournaments in time for entries,
 * starts each when it is due,
 * plays its rounds as ordinary rated bot games announced on the bots' streams,
 * scores no-shows and withdrawals, and picks up where it stood after a restart.
 * Its state lives in the database; only grace deadlines and round gaps are
 * held in memory, and restart afresh at boot.
 */
export class TournamentScheduler {
    readonly #deps: SchedulerDeps;
    readonly #graceUntil = new Map<string, number>();
    readonly #roundReadyAt = new Map<string, number>();
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

    /** One pass: create what the weekly rules call for, start what is due, then move the running tournament on. */
    tick(): void {
        if (this.#deps.draining()) return;
        const now = this.#now();
        this.#createFromRules(now);
        // A pause starts nothing, a due tournament included, which starts on
        // the first pass after the resume; the grace counts again from there.
        if (isPaused(this.#query)) {
            this.#graceUntil.clear();
            return;
        }
        const running = this.#running();
        // A start is a pass of its own; the first round begins on the next.
        if (running === null) {
            this.#startDue(now);
            return;
        }
        this.#advance(running, now);
    }

    /** Whether a bot is reserved by the running tournament, so it takes no other new game. */
    isReserved(botId: string): boolean {
        return (
            this.#query
                .select({ botId: tournamentEntries.botId })
                .from(tournamentEntries)
                .innerJoin(tournaments, eq(tournaments.id, tournamentEntries.tournamentId))
                .where(and(eq(tournamentEntries.botId, botId), eq(tournamentEntries.state, `playing`), eq(tournaments.status, `running`)))
                .get() !== undefined
        );
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
        const running = this.#running();
        if (running === null) return;
        this.#query
            .update(tournamentEntries)
            .set({ state: `withdrawn`, reason })
            .where(and(eq(tournamentEntries.tournamentId, running.id), eq(tournamentEntries.botId, botId), eq(tournamentEntries.state, `playing`)))
            .run();
    }

    /**
     * Cancels a tournament: its live games end aborted and unrated, and its
     * finished games stay rated. Answers as the store does.
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
                status: tournaments.status,
            })
            .from(games)
            .innerJoin(tournamentPairings, eq(tournamentPairings.id, games.pairingId))
            .innerJoin(tournaments, eq(tournaments.id, tournamentPairings.tournamentId))
            .where(eq(games.id, finished.gameId))
            .get();
        if (slot?.pairingId == null || (slot.game !== 1 && slot.game !== 2) || slot.status !== `running`) return;
        if ((slot.game === 1 ? slot.state1 : slot.state2) !== `live`) return;
        if (finished.reason === `aborted` && !isCurrentGeneration(this.#query, this.#deps.generation)) return;
        this.#settle(slot.pairingId, slot.game, this.#outcomeOf(slot.game, finished.winner, finished.reason));
        this.#checkWithdrawals(slot.pairingId);
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

    #running(): RunningTournament | null {
        return (
            this.#query
                .select({ id: tournaments.id, timeControl: tournaments.timeControl, openingPlies: tournaments.openingPlies })
                .from(tournaments)
                .where(eq(tournaments.status, `running`))
                .get() ?? null
        );
    }

    // Starts the earliest tournament whose time has come: connected,
    // eligible entrants play, and too few calls it off.
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
        const day = utcDayStart(seconds);
        const field = clockFits.filter((entry) => botDailyCap - countBotBotGamesSince(this.#query, entry.botId, day) >= needed);
        const stateOf = (botId: string): { state: string; reason: string | null } => {
            if (!present.some((entry) => entry.botId === botId)) return { state: `absent`, reason: null };
            if (!clockFits.some((entry) => entry.botId === botId)) return { state: `left_out`, reason: `clock` };
            if (!field.some((entry) => entry.botId === botId)) return { state: `left_out`, reason: `daily_cap` };
            return { state: field.length < tournamentMinPresent ? `entered` : `playing`, reason: null };
        };
        this.#query.transaction((tx) => {
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
                return;
            }
            tx.update(tournaments).set({ status: `running`, startedAt: seconds }).where(eq(tournaments.id, due.id)).run();
            // The strongest at the start take the fixed seats of the schedule.
            const order = [...field]
                .map((entry) => ({ ...entry, rating: readRating(tx, { kind: `bot`, id: entry.botId }).rating }))
                .sort((one, two) => two.rating - one.rating || one.name.localeCompare(two.name))
                .map((entry) => entry.botId);
            for (const round of roundRobin(order)) {
                for (const pairing of round.pairings) {
                    tx.insert(tournamentPairings)
                        .values({ id: `p_${randomUUID()}`, tournamentId: due.id, round: round.round, firstBotId: pairing.first, secondBotId: pairing.second })
                        .run();
                }
            }
        });
    }

    #pairings(tournamentId: string): PairingRow[] {
        return this.#query
            .select({
                id: tournamentPairings.id,
                round: tournamentPairings.round,
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
            .orderBy(asc(tournamentPairings.round))
            .all();
    }

    #advance(tournament: RunningTournament, now: number): void {
        const pairings = this.#pairings(tournament.id);
        const open = pairings.filter((row) => !scored(row).games.every(slotDone));
        const round = open[0]?.round;
        if (round === undefined) {
            this.#query
                .update(tournaments)
                .set({ status: `finished`, endedAt: Math.floor(now / 1000) })
                .where(eq(tournaments.id, tournament.id))
                .run();
            return;
        }
        const inRound = pairings.filter((row) => row.round === round);
        const begun = inRound.some((row) => row.game1 !== `pending`);
        // Each round after the first waits out the gap from when the one before it ended.
        if (!begun && round > 1) {
            const key = `${tournament.id}:${String(round)}`;
            const readyAt = this.#roundReadyAt.get(key) ?? now + tournamentRoundGapMs;
            this.#roundReadyAt.set(key, readyAt);
            if (now < readyAt) return;
        }
        const withdrawn = new Set(
            this.#query
                .select({ botId: tournamentEntries.botId })
                .from(tournamentEntries)
                .where(and(eq(tournamentEntries.tournamentId, tournament.id), eq(tournamentEntries.state, `withdrawn`)))
                .all()
                .map((row) => row.botId),
        );
        for (const pairing of inRound) this.#advancePairing(tournament, pairing, withdrawn, now);
    }

    // Plays a pairing's next game: game 1, then game 2 once game 1 is over.
    #advancePairing(tournament: RunningTournament, pairing: PairingRow, withdrawn: ReadonlySet<string>, now: number): void {
        for (const game of [1, 2] as const) {
            const state = game === 1 ? pairing.game1 : pairing.game2;
            if (state === `live`) return;
            if (state !== `pending`) continue;
            const settled = this.#startSlot(tournament, pairing, game, withdrawn, now);
            if (!settled) return;
            // A slot settled at once lets game 2 begin within this pass.
            pairing = this.#pairings(tournament.id).find((row) => row.id === pairing.id) ?? pairing;
        }
        this.#checkWithdrawals(pairing.id);
    }

    // Starts a slot's game, or settles it without one; answers whether the
    // slot is over.
    #startSlot(tournament: RunningTournament, pairing: PairingRow, game: 1 | 2, withdrawn: ReadonlySet<string>, now: number): boolean {
        const key = slotKey(pairing.id, game);
        const out = [withdrawn.has(pairing.firstBotId), withdrawn.has(pairing.secondBotId)] as const;
        if (out[0] || out[1]) {
            this.#settle(pairing.id, game, { state: `forfeit`, seat: out[0] && out[1] ? `both` : out[0] ? `first` : `second` });
            this.#graceUntil.delete(key);
            return true;
        }
        const ready = (botId: string) => this.#deps.presence.isOnline(botId) && this.#deps.games.activeGameCount(botId) < botConcurrentGameCap;
        const here = [ready(pairing.firstBotId), ready(pairing.secondBotId)] as const;
        if (here[0] && here[1]) {
            this.#graceUntil.delete(key);
            const day = utcDayStart(Math.floor(now / 1000));
            const capped =
                countPairBotGamesSince(this.#query, { one: pairing.firstBotId, two: pairing.secondBotId }, day) >= pairDailyCap ||
                countBotBotGamesSince(this.#query, pairing.firstBotId, day) >= botDailyCap ||
                countBotBotGamesSince(this.#query, pairing.secondBotId, day) >= botDailyCap;
            if (capped) {
                this.#settle(pairing.id, game, { state: `not_played`, seat: null });
                return true;
            }
            this.#play(tournament, pairing, game);
            return false;
        }
        const deadline = this.#graceUntil.get(key) ?? now + tournamentPresenceGraceMs;
        this.#graceUntil.set(key, deadline);
        if (now < deadline) return false;
        this.#graceUntil.delete(key);
        this.#settle(pairing.id, game, { state: `no_show`, seat: !here[0] && !here[1] ? `both` : !here[0] ? `first` : `second` });
        return true;
    }

    #play(tournament: RunningTournament, pairing: PairingRow, game: 1 | 2): void {
        const name = (botId: string) => this.#query.select({ name: bots.name }).from(bots).where(eq(bots.id, botId)).get()?.name ?? botId;
        const [x, o] = game === 1 ? [pairing.firstBotId, pairing.secondBotId] : [pairing.secondBotId, pairing.firstBotId];
        // The pairing column holds the opening as its game wrote it.
        const stored = pairing.openingCells === null ? null : (JSON.parse(pairing.openingCells) as OpeningCell[]);
        // The slot is live before its game exists, so a finish heard at once
        // finds it; a game that never got created reads as pending at boot.
        this.#settle(pairing.id, game, { state: `live`, seat: null });
        const { opening } = this.#deps.games.createTournamentGame({
            x: { id: x, name: name(x) },
            o: { id: o, name: name(o) },
            timeControl: timeControlSchema.parse(JSON.parse(tournament.timeControl)),
            openingPlies: openingPliesSchema.parse(tournament.openingPlies),
            opening: stored,
            pairing: { id: pairing.id, game },
        });
        if (stored === null) {
            this.#query.update(tournamentPairings).set({ openingCells: JSON.stringify(opening) }).where(eq(tournamentPairings.id, pairing.id)).run();
        }
    }

    #settle(pairingId: string, game: 1 | 2, outcome: { state: SlotState; seat: string | null }): void {
        this.#query
            .update(tournamentPairings)
            .set(game === 1 ? { game1: outcome.state, game1Seat: outcome.seat } : { game2: outcome.state, game2Seat: outcome.seat })
            .where(eq(tournamentPairings.id, pairingId))
            .run();
    }

    // Withdraws a bot of the pairing that has now missed two in a row.
    #checkWithdrawals(pairingId: string): void {
        const row = this.#query
            .select({ tournamentId: tournamentPairings.tournamentId, first: tournamentPairings.firstBotId, second: tournamentPairings.secondBotId })
            .from(tournamentPairings)
            .where(eq(tournamentPairings.id, pairingId))
            .get();
        if (row === undefined) return;
        const pairings = this.#pairings(row.tournamentId).map(scored);
        for (const botId of [row.first, row.second]) {
            if (!missedTwoInARow(botId, pairings)) continue;
            this.#query
                .update(tournamentEntries)
                .set({ state: `withdrawn`, reason: `missed` })
                .where(and(eq(tournamentEntries.tournamentId, row.tournamentId), eq(tournamentEntries.botId, botId), eq(tournamentEntries.state, `playing`)))
                .run();
        }
    }

    // The boot sweep has aborted every game a stopped process left live; a
    // tournament game it caught replays once from its opening and sides, and
    // a game that ended before the stop is recorded as it ended.
    #resume(): void {
        const running = this.#running();
        if (running === null) return;
        for (const pairing of this.#pairings(running.id)) {
            for (const game of [1, 2] as const) {
                if ((game === 1 ? pairing.game1 : pairing.game2) !== `live`) continue;
                const played = this.#query
                    .select({ winner: games.winner, reason: games.finishReason })
                    .from(games)
                    .where(and(eq(games.pairingId, pairing.id), eq(games.pairingGame, game), isNotNull(games.finishedAt)))
                    .orderBy(asc(games.createdAt))
                    .all();
                const last = played.at(-1);
                if (last === undefined) {
                    this.#settle(pairing.id, game, { state: `pending`, seat: null });
                } else if (last.reason !== `aborted`) {
                    // The checks admit only these sides and reasons.
                    this.#settle(pairing.id, game, this.#outcomeOf(game, last.winner as Side | null, last.reason as FinishReason));
                } else {
                    const replayed = played.filter((row) => row.reason === `aborted`).length > 1;
                    this.#settle(pairing.id, game, replayed ? { state: `aborted`, seat: null } : { state: `pending`, seat: null });
                }
            }
        }
    }
}
