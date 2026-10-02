import {
    acceptsSchema,
    levelsSchema,
    challengeStatusSchema,
    firstPlayerSchema,
    nameKeyOf,
    openingPliesSchema,
    sideOf,
    timeControlSchema,
    tournamentEntryReasonSchema,
    tournamentEntryStateSchema,
    type AccountExport,
    type Side,
} from '@hexo-arena/contract';
import { alias } from 'drizzle-orm/sqlite-core';
import { and, asc, eq, inArray, isNotNull, or, type SQL } from 'drizzle-orm';
import type { Query } from './db';
import { adminActions, bots, challenges, gameRatings, games, moves, ratings, sessions, tournamentEntries, tournaments, users } from './db/schema';
import { findGame, type GameRecord } from './game-store';
import { namedTargetActions } from './moderation';
import { shownBot } from './shown-names';

const isoOf = (seconds: number) => new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/u, `Z`);
const isoOrNull = (seconds: number | null) => (seconds === null ? null : isoOf(seconds));

function seatsOf(record: GameRecord, own: (botId: string) => boolean, userId: string): AccountExport[`games`][number][`players`] {
    type Exported = AccountExport[`games`][number][`players`][`x`];
    const leveled = (side: Side, seat: Exported): Exported => {
        const level = record.levels[side];
        return level === null ? seat : { ...seat, level };
    };
    const seated = (side: Side, first: Exported, second: Exported) =>
        side === `x` ? { x: leveled(`x`, first), o: leveled(`o`, second) } : { x: leveled(`x`, second), o: leveled(`o`, first) };
    if (record.kind === `human`) {
        return seated(record.userSide, { name: record.user.name, kind: `user`, yours: record.userId === userId }, { name: record.bot.name, kind: `bot`, yours: own(record.botId) });
    }
    if (record.kind === `guest`) {
        return seated(record.guestSide, { name: record.guestName, kind: `guest`, yours: false }, { name: record.bot.name, kind: `bot`, yours: own(record.botId) });
    }
    return seated(
        record.challengerSide,
        { name: record.challenger.name, kind: `bot`, yours: own(record.challengerBotId) },
        { name: record.dest.name, kind: `bot`, yours: own(record.destBotId) },
    );
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
                    players: seatsOf(record, (botId) => own.has(botId), userId),
                    timeControl: record.timeControl,
                    openingPlies: openingPliesSchema.parse(record.opening.length),
                    opening: record.opening.map((cell) => ({ x: cell.x, y: cell.y, side: sideOf(cell.player) })),
                    moves: query
                        .select()
                        .from(moves)
                        .where(eq(moves.gameId, row.id))
                        .orderBy(asc(moves.seq))
                        .all()
                        // The side check admits only x and o.
                        .map((move) => ({ side: move.side as Side, cells: [{ x: move.firstX, y: move.firstY }, { x: move.secondX, y: move.secondY }], at: isoOf(move.createdAt) })),
                    winner: record.winner,
                    reason: record.finishReason,
                    createdAt: isoOf(row.createdAt),
                    finishedAt: isoOrNull(row.finishedAt),
                    voided: record.voided,
                    ratings: query
                        .select({ side: gameRatings.side, before: gameRatings.ratingBefore, after: gameRatings.ratingAfter, deviationAfter: gameRatings.deviationAfter })
                        .from(gameRatings)
                        .where(eq(gameRatings.gameId, row.id))
                        .orderBy(asc(gameRatings.side))
                        .all()
                        // The side check admits only x and o.
                        .map((rating) => ({ ...rating, side: rating.side as Side })),
                },
            ];
        });
}

const challengerBots = alias(bots, `challenger_bot`);
const destBots = alias(bots, `dest_bot`);

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
        account: { id: user.id, name: user.name, discordId: user.discordId, createdAt: isoOf(user.createdAt), bannedAt: isoOrNull(user.bannedAt) },
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
            accepts: bot.accepts === null ? null : acceptsSchema.parse(JSON.parse(bot.accepts)),
            levels: bot.levels === null ? null : levelsSchema.parse(JSON.parse(bot.levels)),
            delistedAt: isoOrNull(bot.delistedAt),
            deletedAt: isoOrNull(bot.deletedAt),
            rating: ratingOf(ratings.botId, bot.id),
        })),
        games: gamesOf(query, userId, botIds),
        tournamentEntries: query
            .select({
                tournamentId: tournamentEntries.tournamentId,
                tournament: tournaments.name,
                bot: bots.name,
                botDeletedAt: bots.deletedAt,
                state: tournamentEntries.state,
                reason: tournamentEntries.reason,
                ratingAtStart: tournamentEntries.ratingAtStart,
                enteredAt: tournamentEntries.enteredAt,
            })
            .from(tournamentEntries)
            .innerJoin(tournaments, eq(tournaments.id, tournamentEntries.tournamentId))
            .innerJoin(bots, eq(bots.id, tournamentEntries.botId))
            .where(eq(tournamentEntries.ownerId, userId))
            .orderBy(asc(tournamentEntries.enteredAt))
            .all()
            // The state and reason checks admit only the contract's values.
            .map(({ botDeletedAt, ...entry }) => ({
                ...entry,
                bot: shownBot(entry.bot, botDeletedAt).name,
                state: tournamentEntryStateSchema.parse(entry.state),
                reason: entry.reason === null ? null : tournamentEntryReasonSchema.parse(entry.reason),
                enteredAt: isoOf(entry.enteredAt),
            })),
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
