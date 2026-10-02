import { deletedBotName, deletedPlayerName } from '@hexo-arena/contract';

/**
 * A participant as public answers name it: a deleted one by its label and
 * its mark, never by its placeholder, whose number would let a reader
 * follow one deleted person from game to game.
 */
export interface ShownName {
    readonly name: string;
    readonly deleted?: true;
}

export function shownUser(name: string, deletedAt: number | null): ShownName {
    return deletedAt === null ? { name } : { name: deletedPlayerName, deleted: true };
}

export function shownBot(name: string, deletedAt: number | null): ShownName {
    return deletedAt === null ? { name } : { name: deletedBotName, deleted: true };
}
