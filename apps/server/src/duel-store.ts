import {
    acceptsSchema,
    boardCellSchema,
    duelEndReasonSchema,
    duelGamesSchema,
    duelStatusSchema,
    levelsSchema,
    openingPliesSchema,
    seatLevelSchema,
    timeControlSchema,
    type Accepts,
    type DuelEndReason,
    type DuelGames,
    type DuelKind,
    type DuelSide,
    type DuelStatus,
    type FinishReason,
    type Levels,
    type OpeningPlies,
    type SeatLevel,
    type Side,
    type TimeControl,
} from '@hexo-arena/contract';
import { and, asc, count, eq, gte, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { Query } from './db';
import { bots, duels, games, moves, users } from './db/schema';
import type { OpeningCell } from './game-store';
import { shortId } from './random';

/** One of a duel's two bots by its stored order: a's id sorts below b's. */
export type DuelKey = `a` | `b`;

/** A duel as stored, its columns read through the schemas that wrote them. */
export interface DuelRow {
    readonly id: string;
    readonly startedBy: string | null;
    readonly botIds: Readonly<Record<DuelKey, string>>;
    /** Which stored bot its starter named first. */
    readonly first: DuelKey;
    /** Which stored bot plays x in game 1. */
    readonly xInGame1: DuelKey;
    /** One person owns both bots. */
    readonly test: boolean;
    readonly games: DuelGames;
    readonly timeControl: TimeControl;
    readonly openingPlies: OpeningPlies;
    readonly levels: Readonly<Record<DuelKey, SeatLevel | null>>;
    readonly ratings: Readonly<Record<DuelKey, number>>;
    readonly versions: Readonly<Record<DuelKey, string | null>>;
    readonly rated: boolean;
    readonly status: DuelStatus;
    readonly endReason: DuelEndReason | null;
    readonly endBot: DuelKey | null;
    readonly createdAt: number;
    readonly endedAt: number | null;
}

/** A game row of a duel; a replayed game leaves its aborted row before it under the same number. */
export interface DuelGameRow {
    readonly id: string;
    readonly game: number;
    /** The bot that played x: a duel game stores it as the challenger, on x. */
    readonly xBotId: string;
    readonly winner: Side | null;
    readonly reason: FinishReason | null;
    readonly finishedAt: number | null;
    readonly opening: readonly OpeningCell[];
    /** The turns its players made, the opening's aside. */
    readonly moves: number;
}

export function otherKey(key: DuelKey): DuelKey {
    return key === `a` ? `b` : `a`;
}

/** The stored bot playing x in a game: the lot's in game 1, and the sides alternate. */
export function xKeyOf(row: Pick<DuelRow, `xInGame1`>, game: number): DuelKey {
    return game % 2 === 1 ? row.xInGame1 : otherKey(row.xInGame1);
}

/** A stored bot as the starter named it. */
export function sideOfKey(row: Pick<DuelRow, `first`>, key: DuelKey): DuelSide {
    return key === row.first ? `first` : `second`;
}

export function keyOfBot(row: Pick<DuelRow, `botIds`>, botId: string): DuelKey | null {
    return row.botIds.a === botId ? `a` : row.botIds.b === botId ? `b` : null;
}

const readLevel = (stored: string | null) => (stored === null ? null : seatLevelSchema.parse(JSON.parse(stored)));

const duelColumns = {
    id: duels.id,
    startedBy: duels.startedBy,
    botAId: duels.botAId,
    botBId: duels.botBId,
    aFirst: duels.aFirst,
    aX: duels.aX,
    test: duels.test,
    games: duels.games,
    timeControl: duels.timeControl,
    openingPlies: duels.openingPlies,
    aLevel: duels.aLevel,
    bLevel: duels.bLevel,
    aRating: duels.aRating,
    bRating: duels.bRating,
    aVersion: duels.aVersion,
    bVersion: duels.bVersion,
    rated: duels.rated,
    status: duels.status,
    endReason: duels.endReason,
    endBot: duels.endBot,
    createdAt: duels.createdAt,
    endedAt: duels.endedAt,
};

function selectDuels(query: Query) {
    return query.select(duelColumns).from(duels);
}

type StoredDuel = NonNullable<ReturnType<ReturnType<typeof selectDuels>[`get`]>>;

// Written as the live-pair index writes it: a bound value here, beside an OR
// on the bots, trips SQLite's query planner, where the literal lets it use the index.
const running = sql`${duels.status} = 'running'`;

const seatsBot = (botId: string) => or(eq(duels.botAId, botId), eq(duels.botBId, botId));

// Rows are written through the schemas that read them back, and the
// checks admit only these values.
function duelRowOf(row: StoredDuel): DuelRow {
    return {
        id: row.id,
        startedBy: row.startedBy,
        botIds: { a: row.botAId, b: row.botBId },
        first: row.aFirst === 1 ? `a` : `b`,
        xInGame1: row.aX === 1 ? `a` : `b`,
        test: row.test === 1,
        games: duelGamesSchema.parse(row.games),
        timeControl: timeControlSchema.parse(JSON.parse(row.timeControl)),
        openingPlies: openingPliesSchema.parse(row.openingPlies),
        levels: { a: readLevel(row.aLevel), b: readLevel(row.bLevel) },
        ratings: { a: row.aRating, b: row.bRating },
        versions: { a: row.aVersion, b: row.bVersion },
        rated: row.rated === 1,
        status: duelStatusSchema.parse(row.status),
        endReason: row.endReason === null ? null : duelEndReasonSchema.parse(row.endReason),
        endBot: row.endBot === `a` || row.endBot === `b` ? row.endBot : null,
        createdAt: row.createdAt,
        endedAt: row.endedAt,
    };
}

export interface NewDuel {
    readonly startedBy: string;
    readonly botIds: Readonly<Record<DuelKey, string>>;
    readonly first: DuelKey;
    readonly xInGame1: DuelKey;
    readonly test: boolean;
    readonly games: DuelGames;
    readonly timeControl: TimeControl;
    readonly openingPlies: OpeningPlies;
    readonly levels: Readonly<Record<DuelKey, SeatLevel | null>>;
    readonly ratings: Readonly<Record<DuelKey, number>>;
    readonly versions: Readonly<Record<DuelKey, string | null>>;
    readonly rated: boolean;
    readonly createdAt: number;
}

/** Stores a running duel and answers its id. */
export function insertDuel(query: Query, values: NewDuel): string {
    const id = shortId(`d_`);
    const level = (key: DuelKey) => {
        const stored = values.levels[key];
        return stored === null ? null : JSON.stringify(stored);
    };
    query
        .insert(duels)
        .values({
            id,
            startedBy: values.startedBy,
            botAId: values.botIds.a,
            botBId: values.botIds.b,
            aFirst: values.first === `a` ? 1 : 0,
            aX: values.xInGame1 === `a` ? 1 : 0,
            test: values.test ? 1 : 0,
            games: values.games,
            timeControl: JSON.stringify(values.timeControl),
            openingPlies: values.openingPlies,
            aLevel: level(`a`),
            bLevel: level(`b`),
            aRating: values.ratings.a,
            bRating: values.ratings.b,
            aVersion: values.versions.a,
            bVersion: values.versions.b,
            rated: values.rated ? 1 : 0,
            createdAt: values.createdAt,
        })
        .run();
    return id;
}

export function findDuel(query: Query, id: string): DuelRow | undefined {
    const row = selectDuels(query).where(eq(duels.id, id)).get();
    return row === undefined ? undefined : duelRowOf(row);
}

/** Every running duel, oldest first, so the earliest started is served first. */
export function runningDuels(query: Query): DuelRow[] {
    return selectDuels(query).where(running).orderBy(asc(duels.createdAt), asc(duels.id)).all().map(duelRowOf);
}

/** The running duels a bot plays in. */
export function runningDuelsOfBot(query: Query, botId: string): DuelRow[] {
    return selectDuels(query).where(and(running, seatsBot(botId))).all().map(duelRowOf);
}

/** Which duels a list holds: one bot's, one person's, one kind, or every one. */
export interface DuelFilter {
    readonly running: boolean;
    readonly botId: string | null;
    /** A person's: started by them, or played by a bot they own. */
    readonly userId: string | null;
    readonly kind: DuelKind | null;
    readonly limit: number;
}

function personsDuels(userId: string): SQL | undefined {
    return or(
        eq(duels.startedBy, userId),
        sql`${duels.botAId} in (select ${bots.id} from ${bots} where ${bots.ownerId} = ${userId})`,
        sql`${duels.botBId} in (select ${bots.id} from ${bots} where ${bots.ownerId} = ${userId})`,
    );
}

/** Duels to list, newest first: running ones by when they began, those over by when they ended. */
export function listedDuels(query: Query, filter: DuelFilter): DuelRow[] {
    return selectDuels(query)
        .where(
            and(
                filter.running ? running : sql`${duels.status} <> 'running'`,
                filter.botId === null ? undefined : seatsBot(filter.botId),
                filter.userId === null ? undefined : personsDuels(filter.userId),
                filter.kind === null ? undefined : eq(duels.test, filter.kind === `test` ? 1 : 0),
            ),
        )
        .orderBy(filter.running ? sql`${duels.createdAt} desc` : sql`${duels.endedAt} desc`, sql`${duels.id} desc`)
        .limit(filter.limit)
        .all()
        .map(duelRowOf);
}

/** A duel's games in the order they began, replays after the games they replace. */
export function duelGameRows(query: Query, duelId: string): DuelGameRow[] {
    return query
        .select({
            id: games.id,
            game: games.duelGame,
            xBotId: games.challengerBotId,
            winner: games.winner,
            reason: games.finishReason,
            finishedAt: games.finishedAt,
            openingCells: games.openingCells,
            moves: sql<number>`(select count(*) from ${moves} where ${moves.gameId} = ${games.id})`,
        })
        .from(games)
        .where(eq(games.duelId, duelId))
        .orderBy(asc(games.duelGame), asc(sql`${games}.rowid`))
        .all()
        .map((row) => {
            // The duel check gives every duel game a number and a challenger, and the side, winner, and reason checks admit only these values.
            if (row.game === null || row.xBotId === null) throw new Error(`a duel game lacks its number or its bots: ${row.id}`);
            return {
                id: row.id,
                game: row.game,
                xBotId: row.xBotId,
                winner: row.winner as Side | null,
                reason: row.reason as FinishReason | null,
                finishedAt: row.finishedAt,
                opening: boardCellSchema.array().parse(JSON.parse(row.openingCells)),
                moves: row.moves,
            };
        });
}

/** The latest row of each game number, a replay standing for the game it replaced. */
export function latestGames(rows: readonly DuelGameRow[]): Map<number, DuelGameRow> {
    const latest = new Map<number, DuelGameRow>();
    for (const row of rows) latest.set(row.game, row);
    return latest;
}

/** How a duel ends: every game played, or early, with the reason and the bot it names. */
export type DuelEnding =
    | { readonly status: `finished` }
    | { readonly status: `cut_short` | `stopped`; readonly reason: DuelEndReason; readonly bot: DuelKey | null };

/** Ends a running duel; answers whether it was still running. */
export function endDuel(query: Query, id: string, ending: DuelEnding, at: number): boolean {
    const changes = query
        .update(duels)
        .set({
            status: ending.status,
            endReason: ending.status === `finished` ? null : ending.reason,
            endBot: ending.status === `finished` ? null : ending.bot,
            endedAt: at,
        })
        .where(and(eq(duels.id, id), running))
        .run().changes;
    return changes === 1;
}

/** Every running duel, as the operator's status counts them. */
export function countRunningDuels(query: Query): number {
    return query.select({ n: count() }).from(duels).where(running).get()?.n ?? 0;
}

/** The running duels one person started. */
export function countRunningStartedBy(query: Query, userId: string): number {
    return query.select({ n: count() }).from(duels).where(and(eq(duels.startedBy, userId), running)).get()?.n ?? 0;
}

/** The duels one person started since an epoch second, over or not. */
export function countStartedSince(query: Query, userId: string, sinceSeconds: number): number {
    return query.select({ n: count() }).from(duels).where(and(eq(duels.startedBy, userId), gte(duels.createdAt, sinceSeconds))).get()?.n ?? 0;
}

/** The running duels a bot plays in. */
export function countRunningOfBot(query: Query, botId: string): number {
    return query.select({ n: count() }).from(duels).where(and(running, seatsBot(botId))).get()?.n ?? 0;
}

/** Whether two bots already play a running duel, in the stored order of the pair. */
export function pairRunning(query: Query, botIds: Readonly<Record<DuelKey, string>>): boolean {
    return (
        query
            .select({ id: duels.id })
            .from(duels)
            .where(and(eq(duels.botAId, botIds.a), eq(duels.botBId, botIds.b), running))
            .get() !== undefined
    );
}

/** Every running duel's pair of bots, for the duel states the setup reads. */
export function runningPairs(query: Query): { a: string; b: string }[] {
    return query.select({ a: duels.botAId, b: duels.botBId }).from(duels).where(running).all();
}

/** What the gates read of a bot that may play a duel. */
export interface DuelBotRecord {
    readonly id: string;
    readonly name: string;
    readonly ownerId: string;
    readonly deleted: boolean;
    readonly delisted: boolean;
    readonly ownerBanned: boolean;
    readonly accepts: Accepts | undefined;
    readonly levels: Levels | null;
    readonly version: string | null;
    readonly duelsByOthers: boolean;
}

const botStateColumns = {
    id: bots.id,
    name: bots.name,
    ownerId: bots.ownerId,
    deletedAt: bots.deletedAt,
    delistedAt: bots.delistedAt,
    ownerBannedAt: users.bannedAt,
    accepts: bots.accepts,
    levels: bots.levels,
    version: bots.version,
    duelsByOthers: bots.duelsByOthers,
};

/** A bot by id or by the fold of a live name, as the duel gates read it. */
export function readDuelBot(query: Query, by: { id: string } | { nameKey: string }): DuelBotRecord | undefined {
    const row = query
        .select(botStateColumns)
        .from(bots)
        .innerJoin(users, eq(users.id, bots.ownerId))
        .where(`id` in by ? eq(bots.id, by.id) : and(eq(bots.nameKey, by.nameKey), isNull(bots.deletedAt)))
        .get();
    if (row === undefined) return undefined;
    return {
        id: row.id,
        name: row.name,
        ownerId: row.ownerId,
        deleted: row.deletedAt !== null,
        delisted: row.delistedAt !== null,
        ownerBanned: row.ownerBannedAt !== null,
        accepts: row.accepts === null ? undefined : acceptsSchema.parse(JSON.parse(row.accepts)),
        levels: row.levels === null ? null : levelsSchema.parse(JSON.parse(row.levels)),
        version: row.version,
        duelsByOthers: row.duelsByOthers === 1,
    };
}
