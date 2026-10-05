import {
    acceptsSchema,
    levelsSchema,
    tournamentGamesPerPairSchema,
    tournamentStatusSchema,
    challengeStatusSchema,
    firstPlayerSchema,
    nameKeyOf,
    openingPliesSchema,
    sideOf,
    timeControlSchema,
    tournamentEntryReasonSchema,
    tournamentEntryStateSchema,
    tournamentFormatOf,
    type AccountExport,
    type Side,
} from '@hexo-arena/contract';
import { alias } from 'drizzle-orm/sqlite-core';
import { and, asc, eq, inArray, isNotNull, or, type SQL } from 'drizzle-orm';
import type { Query } from './db';
import { adminActions, bots, challenges, gameRatings, games, moves, ratings, sessions, tournamentEntries, tournaments, users } from './db/schema';
import { seated } from './game-seats';
import { findGame, type GameRecord } from './game-store';
import { requestsOf } from './analysis-store';
import { storedAnalyzer, storedClient } from './bots';
import { namedTargetActions } from './moderation';
import { shownBot } from './shown-names';
import { creatorJoin, creators, nameColumns, tournamentNameOf } from './tournament-store';

const isoOf = (seconds: number) => new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/u, `Z`);
const isoOrNull = (seconds: number | null) => (seconds === null ? null : isoOf(seconds));

type ExportedPlayer = AccountExport[`games`][number][`players`][`x`];

function seatedOf(record: GameRecord, own: (botId: string) => boolean, userId: string): Record<Side, ExportedPlayer> {
    switch (record.kind) {
        case `human`:
            return seated(record.userSide, { name: record.user.name, kind: `user`, yours: record.userId === userId }, { name: record.bot.name, kind: `bot`, yours: own(record.botId) });
        case `guest`:
            return seated(record.guestSide, { name: record.guestName, kind: `guest`, yours: false }, { name: record.bot.name, kind: `bot`, yours: own(record.botId) });
        case `bots`:
            return seated(
                record.challengerSide,
                { name: record.challenger.name, kind: `bot`, yours: own(record.challengerBotId) },
                { name: record.dest.name, kind: `bot`, yours: own(record.destBotId) },
            );
    }
}

function playersOf(record: GameRecord, own: (botId: string) => boolean, userId: string): AccountExport[`games`][number][`players`] {
    const players = seatedOf(record, own, userId);
    const leveled = (side: Side): ExportedPlayer => {
        const level = record.levels[side];
        return level === null ? players[side] : { ...players[side], level };
    };
    return { x: leveled(`x`), o: leveled(`o`) };
}

function gamesOf(query: Query, userId: string, botIds: readonly string[]): AccountExport[`games`] {
    const seats: (SQL | undefined)[] = [eq(games.userId, userId)];
    if (botIds.length > 0) seats.push(inArray(games.botId, [...botIds]), inArray(games.challengerBotId, [...botIds]), inArray(games.destBotId, [...botIds]));
    const own = new Set(botIds);
    return query
        .select({ id: games.id, createdAt: games.createdAt, finishedAt: games.finishedAt })
        .from(games)
        .where(or(...seats))
        .orderBy(asc(games.createdAt), asc(games.id))
        .all()
        .flatMap((row) => {
            const record = findGame(query, row.id);
            if (record === undefined) return [];
            return [
                {
                    id: row.id,
                    players: playersOf(record, (botId) => own.has(botId), userId),
                    timeControl: record.timeControl,
                    openingPlies: openingPliesSchema.parse(record.opening.length),
                    opening: record.opening.map((cell) => ({ x: cell.x, y: cell.y, side: sideOf(cell.player) })),
                    moves: query
                        .select()
                        .from(moves)
                        .where(eq(moves.gameId, row.id))
                        .orderBy(asc(moves.seq))
                        .all()
                        .map((move) => ({ side: move.side, cells: [{ x: move.firstX, y: move.firstY }, { x: move.secondX, y: move.secondY }], at: isoOf(move.createdAt) })),
                    winner: record.winner,
                    reason: record.finishReason,
                    createdAt: isoOf(row.createdAt),
                    finishedAt: isoOrNull(row.finishedAt),
                    voided: record.voided,
                    ...(record.kind !== `guest` && record.unratedByChoice ? { unratedByChoice: true as const } : {}),
                    ratings: query
                        .select({ side: gameRatings.side, before: gameRatings.ratingBefore, after: gameRatings.ratingAfter, deviationAfter: gameRatings.deviationAfter })
                        .from(gameRatings)
                        .where(eq(gameRatings.gameId, row.id))
                        .orderBy(asc(gameRatings.side))
                        .all(),
                },
            ];
        });
}

const challengerBots = alias(bots, `challenger_bot`);
const destBots = alias(bots, `dest_bot`);

// The duels and round robins the account set up, each with its format and its bots in the order it named them.
function tournamentsOf(query: Query, userId: string): AccountExport[`tournaments`] {
    const rows = query
        .select({
            id: tournaments.id,
            origin: tournaments.origin,
            maxEntrants: tournaments.maxEntrants,
            gamesPerPair: tournaments.gamesPerPair,
            test: tournaments.test,
            rated: tournaments.rated,
            status: tournaments.status,
            createdAt: tournaments.createdAt,
            endedAt: tournaments.endedAt,
        })
        .from(tournaments)
        .where(eq(tournaments.createdBy, userId))
        .orderBy(asc(tournaments.createdAt), asc(tournaments.id))
        .all();
    return rows.map((row) => ({
        id: row.id,
        format: tournamentFormatOf(row),
        bots: query
            .select({ name: bots.name, deletedAt: bots.deletedAt })
            .from(tournamentEntries)
            .innerJoin(bots, eq(bots.id, tournamentEntries.botId))
            .where(eq(tournamentEntries.tournamentId, row.id))
            .orderBy(asc(tournamentEntries.seat), asc(bots.nameKey))
            .all()
            .map((bot) => shownBot(bot.name, bot.deletedAt).name),
        gamesPerPair: tournamentGamesPerPairSchema.parse(row.gamesPerPair),
        test: row.test === 1,
        rated: row.rated === 1,
        // The status check admits only the contract's statuses.
        status: tournamentStatusSchema.parse(row.status),
        createdAt: isoOf(row.createdAt),
        endedAt: isoOrNull(row.endedAt),
    }));
}

/**
 * Every row tied to one account, as its owner downloads it: never a token,
 * a token's hash, or a sign-in's state; other players named as the site
 * shows them, and a deleted bot of the account's own by its label too.
 */
export function accountExport(query: Query, userId: string, nowMs: number): AccountExport {
    const user = query.select().from(users).where(eq(users.id, userId)).get();
    if (user === undefined) throw new Error(`exporting an account that does not exist: ${userId}`);
    const botRows = query.select().from(bots).where(eq(bots.ownerId, userId)).orderBy(asc(bots.createdAt)).all();
    const botIds = botRows.map((bot) => bot.id);
    const ratingOf = (column: typeof ratings.userId | typeof ratings.botId, id: string) =>
        query.select({ rating: ratings.rating, deviation: ratings.deviation, volatility: ratings.volatility }).from(ratings).where(eq(column, id)).get() ?? null;
    const named = new Set([nameKeyOf(user.name), ...botRows.filter((bot) => bot.deletedAt === null).map((bot) => bot.nameKey)]);
    return {
        exportedAt: isoOf(Math.floor(nowMs / 1000)),
        account: { id: user.id, name: user.name, discordId: user.discordId, createdAt: isoOf(user.createdAt), bannedAt: isoOrNull(user.bannedAt), analysisOptOut: user.analysisOptOut === 1 },
        sessions: query
            .select({ createdAt: sessions.createdAt, expiresAt: sessions.expiresAt, discordUsername: sessions.discordUsername, discordDisplayName: sessions.discordDisplayName })
            .from(sessions)
            .where(eq(sessions.userId, userId))
            .orderBy(asc(sessions.createdAt))
            .all()
            .map((session) => ({ ...session, createdAt: isoOf(session.createdAt), expiresAt: isoOf(session.expiresAt) })),
        rating: ratingOf(ratings.userId, userId),
        bots: botRows.map((bot) => ({
            id: bot.id,
            name: shownBot(bot.name, bot.deletedAt).name,
            createdAt: isoOf(bot.createdAt),
            about: bot.about,
            version: bot.version,
            repoUrl: bot.repoUrl,
            ownerAbout: bot.ownerAbout,
            ownerRepoUrl: bot.ownerRepoUrl,
            client: storedClient(bot) ?? null,
            accepts: bot.accepts === null ? null : acceptsSchema.parse(JSON.parse(bot.accepts)),
            levels: bot.levels === null ? null : levelsSchema.parse(JSON.parse(bot.levels)),
            analyzer: storedAnalyzer(bot),
            delistedAt: isoOrNull(bot.delistedAt),
            deletedAt: isoOrNull(bot.deletedAt),
            rating: ratingOf(ratings.botId, bot.id),
        })),
        games: gamesOf(query, userId, botIds),
        tournamentEntries: query
            .select({
                tournamentId: tournamentEntries.tournamentId,
                ...nameColumns,
                bot: bots.name,
                botDeletedAt: bots.deletedAt,
                state: tournamentEntries.state,
                reason: tournamentEntries.reason,
                ratingAtStart: tournamentEntries.ratingAtStart,
                enteredAt: tournamentEntries.enteredAt,
            })
            .from(tournamentEntries)
            .innerJoin(tournaments, eq(tournaments.id, tournamentEntries.tournamentId))
            .leftJoin(creators, creatorJoin)
            .innerJoin(bots, eq(bots.id, tournamentEntries.botId))
            .where(eq(tournamentEntries.ownerId, userId))
            .orderBy(asc(tournamentEntries.enteredAt))
            .all()
            // The state and reason checks admit only the contract's values.
            .map(({ botDeletedAt, name, origin, maxEntrants, creatorName, creatorDeletedAt, ...entry }) => ({
                ...entry,
                tournament: tournamentNameOf({ name, origin, maxEntrants, creatorName, creatorDeletedAt }),
                bot: shownBot(entry.bot, botDeletedAt).name,
                state: tournamentEntryStateSchema.parse(entry.state),
                reason: entry.reason === null ? null : tournamentEntryReasonSchema.parse(entry.reason),
                enteredAt: isoOf(entry.enteredAt),
            })),
        tournaments: tournamentsOf(query, userId),
        challenges:
            botIds.length === 0
                ? []
                : query
                      .select({
                          id: challenges.id,
                          challenger: challengerBots.name,
                          challengerDeletedAt: challengerBots.deletedAt,
                          challenged: destBots.name,
                          challengedDeletedAt: destBots.deletedAt,
                          timeControl: challenges.timeControl,
                          openingPlies: challenges.openingPlies,
                          firstPlayer: challenges.firstPlayer,
                          status: challenges.status,
                          gameId: challenges.gameId,
                          createdAt: challenges.createdAt,
                          decidedAt: challenges.decidedAt,
                      })
                      .from(challenges)
                      .innerJoin(challengerBots, eq(challengerBots.id, challenges.challengerBotId))
                      .innerJoin(destBots, eq(destBots.id, challenges.destBotId))
                      .where(or(inArray(challenges.challengerBotId, botIds), inArray(challenges.destBotId, botIds)))
                      .orderBy(asc(challenges.createdAt))
                      .all()
                      // The stored values were written through these schemas, and the checks admit only theirs.
                      .map(({ challengerDeletedAt, challengedDeletedAt, ...challenge }) => ({
                          ...challenge,
                          challenger: shownBot(challenge.challenger, challengerDeletedAt).name,
                          challenged: shownBot(challenge.challenged, challengedDeletedAt).name,
                          timeControl: timeControlSchema.parse(JSON.parse(challenge.timeControl)),
                          openingPlies: openingPliesSchema.parse(challenge.openingPlies),
                          firstPlayer: firstPlayerSchema.parse(challenge.firstPlayer),
                          status: challengeStatusSchema.parse(challenge.status),
                          createdAt: isoOf(challenge.createdAt),
                          decidedAt: isoOrNull(challenge.decidedAt),
                      })),
        analyses: requestsOf(query, userId).map((request) => ({ id: request.id, gameId: request.gameId, status: request.status, requestedAt: isoOf(request.createdAt) })),
        moderation: query
            .select({ action: adminActions.action, target: adminActions.target, reason: adminActions.reason, at: adminActions.at })
            .from(adminActions)
            .where(and(isNotNull(adminActions.target), inArray(adminActions.action, namedTargetActions)))
            .orderBy(asc(adminActions.id))
            .all()
            .filter((row) => (row.target ?? ``).split(` `).some((word) => named.has(nameKeyOf(word))))
            .map((row) => ({ ...row, at: isoOf(row.at) })),
    };
}
