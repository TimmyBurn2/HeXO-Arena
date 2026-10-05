import { nameKeyOf, nameSyntaxSchema, placeholderNamePattern, type Side } from '@hexo-arena/contract';
import { and, eq, isNull, sql, type SQLWrapper } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Query } from './db';
import { bots, games, users } from './db/schema';
import type { PlayerRef } from './rating';

/** The side across the board from `side`. */
export function otherSide(side: Side): Side {
    return side === `x` ? `o` : `x`;
}

/** Two seats on their sides: `first` on `firstSide`, `second` across from it. */
export function seated<T>(firstSide: Side, first: T, second: T): Record<Side, T> {
    return firstSide === `x` ? { x: first, o: second } : { x: second, o: first };
}

/** The bot's side in a person's game: user_side names the person's. */
export const botSideAgainstPerson = sql`(case ${games.userSide} when 'x' then 'o' else 'x' end)`;

// challenger_side names the challenger's side, so the challenged bot sits across.
const destSide = sql`(case ${games.challengerSide} when 'x' then 'o' else 'x' end)`;

/**
 * One seat column a player can sit in, with that seat's side and the
 * opponent's column and kind.
 */
export interface GameSeat {
    readonly column: AnySQLiteColumn;
    readonly side: SQLWrapper;
    readonly opponent: SQLWrapper;
    readonly opponentKind: PlayerRef[`kind`];
}

/**
 * Every seat a player can hold: a person sits in user_id; a bot in bot_id
 * against a person, and as challenger or challenged against a bot.
 */
export function seatsOf(player: PlayerRef): readonly GameSeat[] {
    if (player.kind === `human`) return [{ column: games.userId, side: games.userSide, opponent: games.botId, opponentKind: `bot` }];
    return [
        { column: games.botId, side: botSideAgainstPerson, opponent: games.userId, opponentKind: `human` },
        { column: games.challengerBotId, side: games.challengerSide, opponent: games.destBotId, opponentKind: `bot` },
        { column: games.destBotId, side: destSide, opponent: games.challengerBotId, opponentKind: `bot` },
    ];
}

/** A player by name, an account before a bot; null for a name no live player holds, a deletion's placeholder included. */
export function resolvePlayer(query: Query, name: string): (PlayerRef & { readonly name: string }) | null {
    if (!nameSyntaxSchema.safeParse(name).success || placeholderNamePattern.test(nameKeyOf(name))) return null;
    const key = nameKeyOf(name);
    const user = query.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.nameKey, key), isNull(users.deletedAt))).get();
    if (user !== undefined) return { kind: `human`, ...user };
    const bot = query.select({ id: bots.id, name: bots.name }).from(bots).where(and(eq(bots.nameKey, key), isNull(bots.deletedAt))).get();
    return bot === undefined ? null : { kind: `bot`, ...bot };
}
