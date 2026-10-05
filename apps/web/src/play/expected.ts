import { useEffect, useState } from 'react';
import { expectedScore } from '@hexo-arena/contract';
import { fetchPlayerRecord } from '../api/client';
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
    const key = `${name ?? ``} ${bot}`;
    const [read, setRead] = useState<{ key: string; score: number | null } | null>(null);
    useEffect(() => {
        if (name === null) return;
        let cancelled = false;
        Promise.all([fetchPlayerRecord(name), fetchPlayerRecord(bot)]).then(
            ([own, against]) => {
                if (!cancelled) setRead({ key, score: expectedScore(own, against) });
            },
            () => {
                if (!cancelled) setRead({ key, score: null });
            },
        );
        return () => {
            cancelled = true;
        };
    }, [key, name, bot]);
    if (name === null) return { kind: `none` };
    if (read?.key !== key) return { kind: `loading` };
    return read.score === null ? { kind: `none` } : { kind: `ready`, score: read.score };
}
