import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { liveGameListCap, type LiveGameEntry } from '@hexo-arena/contract';
import { fetchBots, fetchLeaderboard, fetchRecentGames, fetchTournaments } from '../api/client';
import { useAsync } from '../api/use-async';
import { FeaturedBoard } from '../home/FeaturedBoard';
import { useFeatured } from '../home/featured';
import { BotsOnline, BuildBand, LadderBlock, LiveNow, RecentResults, TournamentBlock } from '../home/blocks';
import { PlayPanel } from '../home/PlayPanel';
import { useLiveReplay, type LiveView } from '../live/use-live-replay';
import { meStore, useMe } from '../me';
import './HomeScreen.css';

const noGames: readonly LiveView[] = [];

/**
 * Home: the way into a game beside the game most worth watching, the other
 * live games, the top of the ladder, the latest results, the bots online,
 * and how to bring a bot.
 * Every block is a real read, and a block with nothing to show is left out.
 */
export function HomeScreen() {
    const me = useMe();
    const replay = useLiveReplay();
    // A live list that never loaded reads as an empty one, so the slot still
    // shows the latest result.
    const live = replay.games ?? (replay.failed ? noGames : null);
    const loadRoster = useCallback(async () => fetchBots(false), []);
    // A quiet month leaves the default board empty while players still stand
    // on the all-time ladder, so Home reads that before it calls ratings settling.
    const loadLadder = useCallback(async () => {
        const month = await fetchLeaderboard(`all`);
        return month.length > 0 ? { entries: month, allTime: false } : { entries: await fetchLeaderboard(`all`, `all`), allTime: true };
    }, []);
    const roster = useAsync(loadRoster);
    const recent = useAsync(fetchRecentGames);
    const ladder = useAsync(loadLadder);
    const tournaments = useAsync(fetchTournaments);
    const [now, setNow] = useState(() => Date.now());

    // The session read at boot knows nothing of games started since, so
    // Home asks again for the reader's own live games.
    useEffect(() => {
        void meStore.refresh();
    }, []);

    // A game starting or ending moves the roster's counts and the results,
    // and a new result can move the ladder, so each reads again on its cue.
    const liveKey = live?.map((view) => view.entry.gameId).join(` `) ?? null;
    useAfterFirst(liveKey, () => {
        roster.reload();
        recent.reload();
        setNow(Date.now());
    });
    useAfterFirst(recent.data?.games[0]?.gameId ?? null, ladder.reload);

    const latest = recent.data?.games[0] ?? null;
    const featured = useFeatured(live, recent.data === null && !recent.error ? undefined : latest);
    const featuredId = featured.kind === `live` ? featured.view.entry.gameId : null;
    const others = useMemo(() => (live ?? []).filter((view) => view.entry.gameId !== featuredId), [live, featuredId]);
    const self = me.status === `ready` ? me.me : undefined;
    const signedInAs = self?.kind === `user` ? self.name : null;
    const yours = useMemo(() => yourLiveGames(self?.liveGames ?? [], live?.map((view) => view.entry) ?? null), [self, live]);
    // With no game to feature, the slot gives its room to the panel and the
    // band moves up under them.
    const empty = featured.kind === `none`;

    return (
        <div className="home">
            <div className={empty ? `home-hero solo` : `home-hero`}>
                {/* The slot showing the latest game frozen states it, so the panel does not again. */}
                <PlayPanel me={self} roster={roster.data} yours={yours} latest={featured.kind === `last` ? null : latest} />
                {featured.kind === `pending` ? <div className="featured-skeleton skeleton" aria-hidden="true" /> : null}
                {featured.kind === `none` || featured.kind === `pending` ? null : <FeaturedBoard featured={featured} />}
            </div>
            {empty ? <BuildBand wide signedInAs={signedInAs} /> : null}
            {others.length === 0 ? null : <LiveNow games={others} />}
            <div className="home-lower">
                <div className="home-column">
                    {tournaments.data === null ? null : <TournamentBlock list={tournaments.data} now={now} />}
                    {ladder.data === null && !ladder.error ? null : <LadderBlock ladder={ladder.data?.entries ?? []} allTime={ladder.data?.allTime ?? false} roster={roster.data} failed={ladder.data === null} retry={ladder.reload} />}
                    {recent.data === null && !recent.error ? null : <RecentResults games={recent.data?.games ?? []} failed={recent.data === null} now={now} retry={recent.reload} />}
                </div>
                <div className="home-column">
                    {roster.data === null ? null : <BotsOnline roster={roster.data} />}
                    {empty ? null : <BuildBand wide={false} signedInAs={signedInAs} />}
                </div>
            </div>
        </div>
    );
}

/**
 * The reader's live games as the session named them, each as fresh as the
 * live list has it; one missing from a list short of its cap has ended.
 */
function yourLiveGames(named: readonly LiveGameEntry[], live: readonly LiveGameEntry[] | null): LiveGameEntry[] {
    if (live === null) return [...named];
    const byId = new Map(live.map((entry) => [entry.gameId, entry]));
    const full = live.length >= liveGameListCap;
    return named.flatMap((entry) => {
        const fresh = byId.get(entry.gameId);
        if (fresh !== undefined) return [fresh];
        return full ? [entry] : [];
    });
}

// Runs `act` each time `key` changes after its first value, so a cue never
// repeats the read the screen just made on mount.
function useAfterFirst(key: string | null, act: () => void): void {
    const first = useRef<string | null | undefined>(undefined);
    const latest = useRef(act);
    useEffect(() => {
        latest.current = act;
    });
    useEffect(() => {
        if (key === null) return;
        if (first.current === undefined) {
            first.current = key;
            return;
        }
        latest.current();
    }, [key]);
}
