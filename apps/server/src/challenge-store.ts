import {
    firstPlayerSchema,
    openingPliesSchema,
    timeControlSchema,
    type ChallengeStatus,
    type FirstPlayer,
    type OpeningPlies,
    type TimeControl,
} from '@hexo-arena/contract';
import { and, eq, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { randomUUID } from 'node:crypto';
import { nowSeconds, type Query } from './db';
import { bots, challenges } from './db/schema';

export interface ChallengeRecord {
    readonly id: string;
    readonly challengerBotId: string;
    readonly destBotId: string;
    readonly challengerName: string;
    readonly destName: string;
    readonly requestKey: string;
    readonly timeControl: TimeControl;
    readonly openingPlies: OpeningPlies;
    readonly firstPlayer: FirstPlayer;
    readonly status: ChallengeStatus;
    readonly gameId: string | null;
    readonly createdAt: number;
}

export interface NewChallenge {
    readonly challengerBotId: string;
    readonly destBotId: string;
    readonly requestKey: string;
    readonly timeControl: TimeControl;
    readonly openingPlies: OpeningPlies;
    readonly firstPlayer: FirstPlayer;
}

const challengerBots = alias(bots, `challenger_bot`);
const destBots = alias(bots, `dest_bot`);

const recordColumns = {
    id: challenges.id,
    challengerBotId: challenges.challengerBotId,
    destBotId: challenges.destBotId,
    challengerName: challengerBots.name,
    destName: destBots.name,
    requestKey: challenges.requestKey,
    timeControl: challenges.timeControl,
    openingPlies: challenges.openingPlies,
    firstPlayer: challenges.firstPlayer,
    status: challenges.status,
    gameId: challenges.gameId,
    createdAt: challenges.createdAt,
};

function toRecord(row: {
    id: string;
    challengerBotId: string;
    destBotId: string;
    challengerName: string;
    destName: string;
    requestKey: string;
    timeControl: string;
    openingPlies: number;
    firstPlayer: string;
    status: string;
    gameId: string | null;
    createdAt: number;
}): ChallengeRecord {
    // Rows are written through the schemas that read them back; a parse
    // failure means the store itself is broken.
    return {
        id: row.id,
        challengerBotId: row.challengerBotId,
        destBotId: row.destBotId,
        challengerName: row.challengerName,
        destName: row.destName,
        requestKey: row.requestKey,
        timeControl: timeControlSchema.parse(JSON.parse(row.timeControl)),
        openingPlies: openingPliesSchema.parse(row.openingPlies),
        firstPlayer: firstPlayerSchema.parse(row.firstPlayer),
        status: row.status as ChallengeStatus,
        gameId: row.gameId,
        createdAt: row.createdAt,
    };
}

// One row per challenger and request key; the conflict answer carries the
// idempotency, so a racing duplicate re-reads instead of inserting.
export function insertChallenge(
    query: Query,
    challenge: NewChallenge,
): { kind: `inserted`; id: string } | { kind: `exists` } {
    const id = `c_${randomUUID()}`;
    return query.transaction((tx) => {
        const claimed = tx
            .insert(challenges)
            .values({
                id,
                challengerBotId: challenge.challengerBotId,
                destBotId: challenge.destBotId,
                requestKey: challenge.requestKey,
                timeControl: JSON.stringify(challenge.timeControl),
                openingPlies: challenge.openingPlies,
                firstPlayer: challenge.firstPlayer,
                status: `created`,
                createdAt: nowSeconds(),
            })
            .onConflictDoNothing()
            .run().changes;
        return claimed === 1 ? { kind: `inserted`, id } : { kind: `exists` };
    });
}

export function findChallenge(query: Query, id: string): ChallengeRecord | undefined {
    const row = query
        .select(recordColumns)
        .from(challenges)
        .innerJoin(challengerBots, eq(challenges.challengerBotId, challengerBots.id))
        .innerJoin(destBots, eq(challenges.destBotId, destBots.id))
        .where(eq(challenges.id, id))
        .get();
    return row === undefined ? undefined : toRecord(row);
}

export function findChallengeByRequest(
    query: Query,
    challengerBotId: string,
    requestKey: string,
): ChallengeRecord | undefined {
    const row = query
        .select(recordColumns)
        .from(challenges)
        .innerJoin(challengerBots, eq(challenges.challengerBotId, challengerBots.id))
        .innerJoin(destBots, eq(challenges.destBotId, destBots.id))
        .where(
            and(eq(challenges.challengerBotId, challengerBotId), eq(challenges.requestKey, requestKey)),
        )
        .get();
    return row === undefined ? undefined : toRecord(row);
}

export function countPendingForDest(query: Query, destBotId: string): number {
    const [row] = query
        .select({ n: sql<number>`count(*)` })
        .from(challenges)
        .where(and(eq(challenges.destBotId, destBotId), eq(challenges.status, `created`)))
        .all();
    return row?.n ?? 0;
}

// A decision lands only while the row is still pending, so an expired or
// twice-acted challenge cannot be decided again.
export function decideChallenge(
    query: Query,
    id: string,
    decision: { status: `accepted` | `declined` | `canceled` | `expired`; gameId?: string },
): boolean {
    const updated = query
        .update(challenges)
        .set({
            status: decision.status,
            ...(decision.gameId !== undefined && { gameId: decision.gameId }),
            decidedAt: nowSeconds(),
        })
        .where(and(eq(challenges.id, id), eq(challenges.status, `created`)))
        .run().changes;
    return updated === 1;
}

// The boot owner of challenges a dead process left pending; nobody is
// connected yet, so there is nothing to tell.
export function expireStaleChallenges(query: Query, ttlSeconds: number): void {
    query.update(challenges)
        .set({ status: `expired`, decidedAt: nowSeconds() })
        .where(
            and(
                eq(challenges.status, `created`),
                lt(challenges.createdAt, sql`${nowSeconds()} - ${ttlSeconds}`),
            ),
        )
        .run();
}
