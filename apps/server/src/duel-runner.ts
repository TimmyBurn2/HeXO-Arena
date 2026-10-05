import { botDailyCap, pairDailyCap, presenceGraceMs } from '@hexo-arena/contract';
import { eq } from 'drizzle-orm';
import { botGates, levelNow, readBot, type BotGateFailure, type BotRecord } from './bot-gates';
import type { Query } from './db';
import { games } from './db/schema';
import type { FinishedGameNote, GameRegistry } from './game-registry';
import { countBotBotGamesSince, countPairBotGamesSince, type OpeningCell } from './game-store';
import type { PresenceRegistry } from './presence';
import {
    endDuel,
    findDuel,
    keyOfBot,
    latestGames,
    otherKey,
    runningDuels,
    runningDuelsOfBot,
    duelGameRows,
    xKeyOf,
    type DuelEnding,
    type DuelKey,
    type DuelRow,
} from './duel-store';
import { isCurrentGeneration, isPaused } from './site-state';
import { utcDay } from './utc-day';

// A bot taken out of play, or held by a tournament until it ends, is not
// ready within any grace, so its duel ends at once.
const lasting: ReadonlySet<BotGateFailure> = new Set([`deleted`, `delisted`, `banned`, `tournament`]);

interface DuelRunnerDeps {
    readonly query: Query;
    readonly presence: PresenceRegistry;
    readonly games: GameRegistry;
    readonly generation: number;
    // Whether this process is draining for a deploy, so it starts nothing.
    readonly draining: () => boolean;
    readonly reservations: { isReserved: (botId: string) => boolean };
    readonly now?: () => number;
}

// A bot the next game of a duel waits for, and when the wait ends.
interface DuelWait {
    readonly key: DuelKey;
    readonly until: number;
}

/**
 * Plays every running duel one game at a time: the next game starts on
 * the first pass after the last ended once both bots pass every gate again,
 * a bot not ready within the grace cuts the duel short, and a game the
 * deploy drain cut replays once at the next boot.
 * Its state lives in the database; only grace deadlines are held in memory,
 * and restart afresh at boot.
 */
export class DuelRunner {
    readonly #deps: DuelRunnerDeps;
    readonly #waits = new Map<string, DuelWait & { reason: BotGateFailure }>();
    #timer: ReturnType<typeof setInterval> | null = null;

    constructor(deps: DuelRunnerDeps) {
        this.#deps = deps;
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

    /**
     * One pass over every running duel.
     * A pause starts no game, and each grace counts again from the resume.
     */
    tick(): void {
        if (this.#deps.draining()) return;
        if (isPaused(this.#query)) {
            this.#waits.clear();
            return;
        }
        const now = this.#now();
        for (const row of runningDuels(this.#query)) this.#advance(row, now);
    }

    /** Moves one duel on at once, as its creation does for its first game. */
    advance(id: string): void {
        if (this.#deps.draining() || isPaused(this.#query)) return;
        const row = findDuel(this.#query, id);
        if (row?.status === `running`) this.#advance(row, this.#now());
    }

    /** The bot a running duel waits for, if any. */
    waitingOf(id: string): DuelWait | null {
        const wait = this.#waits.get(id);
        return wait === undefined ? null : { key: wait.key, until: wait.until };
    }

    /**
     * Stops a running duel: no further game starts, and a live one plays on,
     * since ending it unrated would be an escape from a losing position.
     */
    stopDuel(id: string, by: { reason: `starter` | `owner` | `operator`; bot: DuelKey | null }): `stopped` | `over` | `not_found` {
        const row = findDuel(this.#query, id);
        if (row === undefined) return `not_found`;
        if (row.status !== `running`) return `over`;
        this.#end(row, { status: `stopped`, reason: by.reason, bot: by.bot });
        return `stopped`;
    }

    /** Cuts short every running duel a bot plays, once it or its owner is taken out; a live game plays on. */
    endForBot(botId: string, reason: `banned` | `delisted` | `deleted`): void {
        for (const row of runningDuelsOfBot(this.#query, botId)) this.#end(row, { status: `cut_short`, reason, bot: keyOfBot(row, botId) });
    }

    /**
     * Hears every finish: the last game finishes its duel, and a game the
     * operator aborted cuts its duel short, a pair being unfair to complete
     * without it; a game the drain cut stays to replay at the next boot.
     */
    gameFinished(finished: FinishedGameNote): void {
        const tagged = this.#query.select({ duelId: games.duelId, game: games.duelGame }).from(games).where(eq(games.id, finished.gameId)).get();
        if (tagged?.duelId == null || tagged.game === null) return;
        const row = findDuel(this.#query, tagged.duelId);
        if (row?.status !== `running`) return;
        if (finished.reason === `aborted`) {
            if (isCurrentGeneration(this.#query, this.#deps.generation)) this.#end(row, { status: `cut_short`, reason: `aborted`, bot: null });
            return;
        }
        if (tagged.game === row.games) this.#end(row, { status: `finished` });
    }

    #end(row: DuelRow, ending: DuelEnding): void {
        this.#waits.delete(row.id);
        endDuel(this.#query, row.id, ending, Math.floor(this.#now() / 1000));
    }

    #advance(row: DuelRow, now: number): void {
        const rows = duelGameRows(this.#query, row.id);
        const latest = latestGames(rows);
        const reached = Math.max(0, ...latest.keys());
        const last = latest.get(reached);
        if (last !== undefined && last.finishedAt === null) return;
        let next: number;
        let opening: readonly OpeningCell[] | null;
        if (last?.reason === `aborted`) {
            // Only the deploy drain or a crash leaves a running duel an
            // aborted game: it replays once, on its own opening and sides.
            if (rows.filter((game) => game.game === reached && game.reason === `aborted`).length > 1) {
                this.#end(row, { status: `cut_short`, reason: `aborted`, bot: null });
                return;
            }
            next = reached;
            opening = last.opening;
        } else {
            next = reached + 1;
            if (next > row.games) {
                this.#end(row, { status: `finished` });
                return;
            }
            // A pair's second game replays the stones its first game drew.
            opening = next % 2 === 0 ? (latest.get(next - 1)?.opening ?? null) : null;
        }
        const a = readBot(this.#query, { id: row.botIds.a });
        const b = readBot(this.#query, { id: row.botIds.b });
        // A bot deleted outright takes its duel with it, so both rows stand here.
        if (a === undefined || b === undefined) return;
        const bots = { a, b };
        const terms = { starterId: row.startedBy, timeControl: row.timeControl };
        const blocked = ([`a`, `b`] as const).flatMap((key) => botGates(bots[key], terms, this.#deps).map((reason) => ({ key, reason })));
        const lost = blocked.find((failure) => lasting.has(failure.reason));
        if (lost !== undefined) {
            this.#end(row, { status: `cut_short`, reason: lost.reason, bot: lost.key });
            return;
        }
        const waiting = blocked[0];
        if (waiting !== undefined) {
            const until = this.#waits.get(row.id)?.until ?? now + presenceGraceMs;
            this.#waits.set(row.id, { key: waiting.key, until, reason: waiting.reason });
            if (now >= until) this.#end(row, { status: `cut_short`, reason: waiting.reason, bot: waiting.key });
            return;
        }
        this.#waits.delete(row.id);
        if (row.rated && this.#capped(row, now)) return;
        this.#play(row, next, opening, bots);
    }

    // A rated duel's game counts toward the daily caps like any rated bot
    // game, so each checks them again at its start; a refused one ends the duel.
    #capped(row: DuelRow, now: number): boolean {
        const day = utcDay(Math.floor(now / 1000)).start;
        if (countPairBotGamesSince(this.#query, { one: row.botIds.a, two: row.botIds.b }, day) >= pairDailyCap) {
            this.#end(row, { status: `cut_short`, reason: `daily_cap`, bot: null });
            return true;
        }
        const capped = ([`a`, `b`] as const).find((key) => countBotBotGamesSince(this.#query, row.botIds[key], day) >= botDailyCap);
        if (capped === undefined) return false;
        this.#end(row, { status: `cut_short`, reason: `daily_cap`, bot: capped });
        return true;
    }

    #play(row: DuelRow, game: number, opening: readonly OpeningCell[] | null, bots: Record<DuelKey, BotRecord>): void {
        const x = xKeyOf(row, game);
        const o = otherKey(x);
        this.#deps.games.createScheduledGame({
            x: { id: bots[x].id, name: bots[x].name },
            o: { id: bots[o].id, name: bots[o].name },
            levels: { x: levelNow(bots[x], row.levels[x]), o: levelNow(bots[o], row.levels[o]) },
            unratedByChoice: !row.rated,
            test: row.test,
            timeControl: row.timeControl,
            openingPlies: row.openingPlies,
            opening,
            tag: { kind: `duel`, id: row.id, game },
        });
    }
}
