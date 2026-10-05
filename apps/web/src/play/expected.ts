import { useCallback } from 'react';
import { expectedScore } from '@hexo-arena/contract';
import { fetchPlayerRecord } from '../api/client';
import { useAsync } from '../api/use-async';
import { useMe } from '../me';

// The signed-in player's expected score against a bot: none for a guest, whose games are unrated, or its reads under way.
type ExpectedScore = { kind: `none` } | { kind: `loading` } | { kind: `ready`; score: number };

/**
 * The signed-in player's expected score against a bot, from both records
 * and the rating fold's own function.
 * A read that fails leaves none, since the line is extra to the card.
 */
export function useExpectedScore(bot: string): ExpectedScore {
    const me = useMe();
    const name = me.status === `ready` && me.me?.kind === `user` ? me.me.name : null;
    const load = useCallback(async () => {
        if (name === null) return null;
        const [own, against] = await Promise.all([fetchPlayerRecord(name), fetchPlayerRecord(bot)]);
        return expectedScore(own, against);
    }, [name, bot]);
    // A score belongs to the pair it was read for, so another pick waits for its own.
    const read = useAsync(load, { keep: false });
    if (name === null || read.error) return { kind: `none` };
    return read.data === null ? { kind: `loading` } : { kind: `ready`, score: read.data };
}
