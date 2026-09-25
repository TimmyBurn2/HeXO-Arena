import {
    challengeSchema,
    type Challenge,
    type FirstPlayer,
    type StreamEvent,
    type TimeControl,
} from '@hexarena/contract';
import type { Query } from './db';
import {
    decideChallenge,
    findChallenge,
    findChallengeByRequest,
    insertChallenge,
    type ChallengeRecord,
} from './challenge-store';
import { botConcurrentGameCap, type GameRegistry } from './game-registry';
import type { PresenceRegistry } from './presence';
import { streamPlayerOf } from './rating-store';

export const challengeTtlMs = 60_000;
export const challengeInboxCap = 10;
export const pairDailyCap = 20;
export const botDailyCap = 100;

export const challengeTtlSeconds = challengeTtlMs / 1000;

type Timer = ReturnType<typeof setTimeout>;

interface LiveChallenge {
    readonly record: ChallengeRecord;
    readonly expiresAt: number;
    ttlTimer: Timer;
}

export type CreateChallengeOutcome =
    | { kind: `created`; view: Challenge }
    | { kind: `replay`; view: Challenge };

export type ChallengeActionOutcome = { kind: `ok` } | { kind: `bot_busy` } | { kind: `unknown` };

export interface ChallengeDeps {
    query: Query;
    presence: PresenceRegistry;
    games: GameRegistry;
}

function viewOf(query: Query, record: ChallengeRecord, status: Challenge[`status`]): Challenge {
    return challengeSchema.parse({
        challengeId: record.id,
        challenger: streamPlayerOf(query, { kind: `bot`, id: record.challengerBotId }, record.challengerName),
        destUser: streamPlayerOf(query, { kind: `bot`, id: record.destBotId }, record.destName),
        timeControl: record.timeControl,
        openingStones: record.openingStones,
        firstPlayer: record.firstPlayer,
        status,
    });
}

/**
 * The bot-vs-bot inbox: pending challenges with a TTL, their transitions
 * and their stream events, and the accept handoff into a normal game.
 */
export class ChallengeRegistry {
    readonly #pending = new Map<string, LiveChallenge>();
    readonly #query: Query;
    readonly #presence: PresenceRegistry;
    readonly #games: GameRegistry;

    constructor(deps: ChallengeDeps) {
        this.#query = deps.query;
        this.#presence = deps.presence;
        this.#games = deps.games;
    }

    pendingInboxCount(destBotId: string): number {
        let count = 0;
        for (const live of this.#pending.values()) {
            if (live.record.destBotId === destBotId) count += 1;
        }
        return count;
    }

    create(input: {
        challenger: { id: string; name: string };
        dest: { id: string; name: string };
        timeControl: TimeControl;
        openingStones: number;
        firstPlayer: FirstPlayer;
        requestKey: string;
    }): CreateChallengeOutcome {
        // Idempotency outranks the gates: the creation already happened,
        // so the gates of this moment cannot unmake it.
        const existing = findChallengeByRequest(this.#query, input.challenger.id, input.requestKey);
        if (existing !== undefined) return { kind: `replay`, view: viewOf(this.#query, existing, existing.status) };
        const id = insertChallenge(this.#query, {
            challengerBotId: input.challenger.id,
            destBotId: input.dest.id,
            requestKey: input.requestKey,
            timeControl: input.timeControl,
            openingStones: input.openingStones,
            firstPlayer: input.firstPlayer,
        });
        if (id.kind === `exists`) {
            const raced = findChallengeByRequest(this.#query, input.challenger.id, input.requestKey);
            // The unique key just conflicted, so the row exists.
            if (raced === undefined) throw new Error(`challenge row vanished on conflict`);
            return { kind: `replay`, view: viewOf(this.#query, raced, raced.status) };
        }
        const record = findChallenge(this.#query, id.id);
        // The insert just created the row.
        if (record === undefined) throw new Error(`challenge row vanished on insert: ${id.id}`);
        const live: LiveChallenge = {
            record,
            expiresAt: Date.now() + challengeTtlMs,
            ttlTimer: setTimeout(() => {
                this.#expire(live);
            }, challengeTtlMs),
        };
        this.#pending.set(id.id, live);
        this.#presence.send(input.dest.id, {
            type: `challenge`,
            challenge: viewOf(this.#query, record, `created`),
        });
        return { kind: `created`, view: viewOf(this.#query, record, `created`) };
    }

    // Only the challenged bot accepts, and only the one gate that can have
    // moved since creation is re-checked: its own concurrent cap.
    accept(destBotId: string, challengeId: string): ChallengeActionOutcome {
        const live = this.#pendingFor(destBotId, challengeId);
        if (live === null) return { kind: `unknown` };
        if (this.#games.activeGameCount(destBotId) >= botConcurrentGameCap) {
            return { kind: `bot_busy` };
        }
        const { gameId } = this.#games.createBotGame({
            challenger: { id: live.record.challengerBotId, name: live.record.challengerName },
            dest: { id: live.record.destBotId, name: live.record.destName },
            timeControl: live.record.timeControl,
            openingStones: live.record.openingStones,
            firstPlayer: live.record.firstPlayer,
        });
        this.#decide(live, `accepted`, gameId);
        return { kind: `ok` };
    }

    decline(destBotId: string, challengeId: string): ChallengeActionOutcome {
        const live = this.#pendingFor(destBotId, challengeId);
        if (live === null) return { kind: `unknown` };
        this.#decide(live, `declined`);
        this.#presence.send(live.record.challengerBotId, {
            type: `challengeDeclined`,
            challenge: viewOf(this.#query, live.record, `declined`),
        });
        return { kind: `ok` };
    }

    cancel(challengerBotId: string, challengeId: string): ChallengeActionOutcome {
        const live = this.#pending.get(challengeId);
        if (live === undefined || live.record.challengerBotId !== challengerBotId) {
            return { kind: `unknown` };
        }
        if (Date.now() >= live.expiresAt) {
            this.#expire(live);
            return { kind: `unknown` };
        }
        this.#decide(live, `canceled`);
        this.#presence.send(live.record.destBotId, {
            type: `challengeCanceled`,
            reason: `canceled`,
            challenge: viewOf(this.#query, live.record, `canceled`),
        });
        return { kind: `ok` };
    }

    // A bot taken out of play takes its pending challenges with it, in both
    // directions; both sides hear of it, since either may still be
    // connected.
    withdrawFor(botId: string): number {
        let withdrawn = 0;
        for (const live of [...this.#pending.values()]) {
            const { challengerBotId, destBotId } = live.record;
            if (challengerBotId !== botId && destBotId !== botId) continue;
            this.#decide(live, `canceled`);
            const view = viewOf(this.#query, live.record, `canceled`);
            for (const side of [challengerBotId, destBotId]) {
                this.#presence.send(side, { type: `challengeCanceled`, reason: `canceled`, challenge: view });
            }
            withdrawn += 1;
        }
        return withdrawn;
    }

    // Pending inbox lines replay on reconnect, so a bot that dropped its
    // stream mid-off still sees what waits for it.
    replayForBot(botId: string): StreamEvent[] {
        const events: StreamEvent[] = [];
        for (const live of this.#pending.values()) {
            if (live.record.destBotId !== botId) continue;
            events.push({
                type: `challenge`,
                challenge: viewOf(this.#query, live.record, `created`),
            });
        }
        return events;
    }

    // A pending challenge whose actor is wrong, gone, or past its TTL is
    // simply unknown: the TTL timer owns marking expiry.
    #pendingFor(destBotId: string, challengeId: string): LiveChallenge | null {
        const live = this.#pending.get(challengeId);
        if (live === undefined || live.record.destBotId !== destBotId) return null;
        if (Date.now() >= live.expiresAt) {
            this.#expire(live);
            return null;
        }
        return live;
    }

    // Expiry reaches both sides; every other transition reaches exactly the
    // side that did not act.
    #expire(live: LiveChallenge): void {
        if (!this.#pending.has(live.record.id)) return;
        this.#decide(live, `expired`);
        const view = viewOf(this.#query, live.record, `expired`);
        this.#presence.send(live.record.challengerBotId, {
            type: `challengeCanceled`,
            reason: `expired`,
            challenge: view,
        });
        this.#presence.send(live.record.destBotId, {
            type: `challengeCanceled`,
            reason: `expired`,
            challenge: view,
        });
    }

    #decide(live: LiveChallenge, status: `accepted` | `declined` | `canceled` | `expired`, gameId?: string): void {
        if (!this.#pending.delete(live.record.id)) return;
        clearTimeout(live.ttlTimer);
        decideChallenge(this.#query, live.record.id, { status, ...(gameId !== undefined && { gameId }) });
    }

    // The boot sweep owns rows a dead process left pending; shutdown only
    // stops the timers, because the sweep will own them on the next boot.
    stop(): void {
        for (const live of [...this.#pending.values()]) {
            clearTimeout(live.ttlTimer);
        }
        this.#pending.clear();
    }
}
