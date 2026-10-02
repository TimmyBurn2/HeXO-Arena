// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BotListing, FinishedGameEntry, GamePlayer, LeaderboardEntry, LiveGameEntry, Me, TournamentList } from '@hexo-arena/contract';
import { meStore } from '../src/me';
import { HomeScreen } from '../src/screens/HomeScreen';

const bot = (name: string, rating: number): GamePlayer => ({ name, rating, provisional: false, kind: `bot` });

function listing(name: string, rating: number, online = true): BotListing {
    return {
        name,
        ownerName: `owner`,
        online,
        openForChallenges: online,
        rating,
        provisional: true,
        liveGames: 0,
        accepts: { turnMs: [5_000, 60_000], match: true, unlimited: true },
    };
}

function live(gameId: string, x: GamePlayer, o: GamePlayer): LiveGameEntry {
    return {
        gameId,
        players: { x, o },
        timeControl: { mode: `unlimited` },
        toMove: `x`,
        rated: true,
        cells: [{ x: 0, y: 0, side: `x` }],
        clock: { mode: `unlimited` },
    };
}

function result(index: number): FinishedGameEntry {
    return {
        gameId: `g-${String(index)}`,
        players: { x: bot(`hextide`, 1700 + index), o: bot(`pebble`, 1500) },
        winner: `x`,
        reason: `six-in-a-row`,
        timeControl: { mode: `unlimited` },
        openingPlies: 1,
        turns: 12,
        finishedAt: new Date(Date.now() - (index + 1) * 600_000).toISOString(),
        rated: true,
        voided: false,
    };
}

interface Reads {
    me?: Me;
    live?: LiveGameEntry[];
    bots?: BotListing[];
    ladder?: LeaderboardEntry[];
    // The all-time board, when it differs from the 30-day one.
    allTime?: LeaderboardEntry[];
    finished?: FinishedGameEntry[];
    tournaments?: TournamentList;
}

// Every read answers by path; a game read answers not found, so the slot
// keeps to the live list.
function serve(reads: Reads): void {
    vi.stubGlobal(
        `fetch`,
        vi.fn((url: string) => {
            const path = url.split(`?`)[0];
            const body =
                path === `/api/me`
                    ? (reads.me ?? null)
                    : path === `/api/games`
                      ? (reads.live ?? [])
                      : path === `/api/bots`
                        ? (reads.bots ?? [])
                        : path === `/api/leaderboard`
                          ? ((url.includes(`active=all`) ? reads.allTime : undefined) ?? reads.ladder ?? [])
                          : path === `/api/games/finished`
                            ? { games: reads.finished ?? [], next: null, previous: null, page: 1 }
                            : path === `/api/tournaments`
                              ? (reads.tournaments ?? { running: null, scheduled: [], past: [] })
                              : undefined;
            return Promise.resolve(body === undefined ? new Response(`{}`, { status: 404 }) : new Response(JSON.stringify(body)));
        }),
    );
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    meStore.reset();
});

const blocks = () => screen.queryAllByRole(`heading`, { level: 2 }).map((heading) => heading.textContent);

describe('HomeScreen', () => {
    it('on day one offers the disabled play card and the build band, and nothing else', async () => {
        serve({});
        render(<HomeScreen />);
        expect(await screen.findByText(`No bots online right now`)).toBeTruthy();
        expect(screen.getByRole(`heading`, { level: 1, name: `Play HeXO` })).toBeTruthy();
        expect(screen.getByText(`HeXO Arena runs no bots of its own; the ladder is whatever you bring.`)).toBeTruthy();
        expect(screen.queryByRole(`link`, { name: /^Play a bot/u })).toBeNull();
        await waitFor(() => {
            expect(blocks()).toEqual([`Build a bot`]);
        });
        expect(screen.getByRole(`link`, { name: `Start building` }).getAttribute(`href`)).toBe(`/connect`);
    });

    it('show the all-time ladder when nobody ranked played this month, leading to it', async () => {
        const allTime: LeaderboardEntry[] = [`apex`, `summit`].map((name, index) => ({
            rank: index + 1,
            name,
            kind: `bot`,
            rating: 2000 - 100 * index,
            games: 60,
            lastPlayedAt: `2026-08-01T08:00:00Z`,
            ownerName: `owner`,
            online: false,
        }));
        serve({ bots: [listing(`apex`, 2000)], ladder: [], allTime, finished: [result(0)] });
        render(<HomeScreen />);
        const block = (await screen.findByRole(`heading`, { name: `Ladder` })).closest(`section`);
        if (block === null) throw new Error(`no ladder block`);
        expect(within(block).getByText(`All time; no ranked player played in the last 30 days.`)).toBeTruthy();
        expect(within(block).getByRole(`link`, { name: `Full ladder` }).getAttribute(`href`)).toBe(`/ladder?active=all`);
        expect(block.querySelectorAll(`.rung`)).toHaveLength(2);
        expect([...block.querySelectorAll(`.rung-owner a`)].map((link) => link.getAttribute(`href`))).toEqual([`/players/owner`, `/players/owner`]);
        expect(screen.queryByRole(`heading`, { name: `Settling ratings` })).toBe(null);
    });

    it('with a few players lists the bots by rating while no rating has settled, and offers the ready ones', async () => {
        serve({ bots: [listing(`pebble`, 1400), listing(`hextide`, 1600), listing(`lantern`, 1500, false)], finished: [result(0)] });
        render(<HomeScreen />);
        const settling = (await screen.findByRole(`heading`, { name: `Settling ratings` })).closest(`section`);
        if (settling === null) throw new Error(`no settling block`);
        expect(within(settling).getAllByRole(`listitem`).map((row) => row.textContent)).toEqual([`hextideBOT1600?`, `lanternBOT1500?`, `pebbleBOT1400?`]);
        expect(screen.getByRole(`link`, { name: /^Play a bot/u }).textContent).toBe(`Play a bot2 bots ready`);
        expect(screen.getByRole(`link`, { name: /^Play hextide/u }).getAttribute(`href`)).toBe(`/play?bot=hextide`);
        const last = screen.getByRole(`link`, { name: `hextide vs pebble` });
        expect(last.getAttribute(`href`)).toBe(`/game/g-0`);
        expect(last.parentElement?.textContent).toBe(`Last game: hextide vs pebble; hextide won with six in a row`);
    });

    it('when busy features the best game and lists the rest, the ladder, and eight results without rating moves', async () => {
        const games = [live(`a`, bot(`low`, 1200), bot(`lower`, 1100)), live(`b`, bot(`apex`, 2000), bot(`summit`, 1900)), live(`c`, bot(`mid`, 1500), bot(`middle`, 1400))];
        const ladder: LeaderboardEntry[] = [`apex`, `summit`, `mid`, `middle`, `low`].map((name, index) => ({
            rank: index + 1,
            name,
            kind: `bot`,
            rating: 2000 - 100 * index,
            games: 60,
            lastPlayedAt: `2026-10-01T08:00:00Z`,
            ownerName: `owner`,
            online: true,
        }));
        serve({ live: games, bots: [listing(`apex`, 2000)], ladder, finished: Array.from({ length: 12 }, (_, index) => result(index)) });
        render(<HomeScreen />);
        expect((await screen.findByRole(`link`, { name: `Watch apex vs summit` })).getAttribute(`href`)).toBe(`/game/b`);
        await waitFor(() => {
            expect(blocks()).toEqual([`Live now`, `Ladder`, `Recent results`, `Bots online`, `Build a bot`]);
        });
        const recent = screen.getByRole(`heading`, { name: `Recent results` }).closest(`section`);
        if (recent === null) throw new Error(`no results block`);
        expect(within(recent).getByRole(`link`, { name: `All games` }).getAttribute(`href`)).toBe(`/games`);
        const rows = within(recent).getAllByRole(`listitem`).map((item) => within(item).getByRole(`link`));
        expect(rows.map((row) => row.getAttribute(`href`))).toEqual(Array.from({ length: 8 }, (_, index) => `/game/g-${String(index)}`));
        // A result names who won and how, never a rating or its move.
        expect(rows.every((row) => !/\d{3,}|[+-]\d/u.test(row.textContent))).toBe(true);
        expect(screen.getAllByRole(`link`, { name: /^Full ladder$/u })).toHaveLength(1);
        expect(document.querySelectorAll(`.rung`)).toHaveLength(3);
    });

    it('shows the tournament running now, or one starting within a day, and none further off', async () => {
        const summary = { id: `t_autumnrobin1`, name: `Autumn round robin`, status: `scheduled` as const, startsAt: new Date(Date.now() + 3 * 3_600_000 + 30_000).toISOString(), timeControl: { mode: `turn` as const, turnTimeMs: 10_000 }, openingPlies: 5 as const, entrants: 4, maxEntrants: 12, winner: null, round: null };
        serve({ tournaments: { running: null, scheduled: [summary], past: [] } });
        const { unmount } = render(<HomeScreen />);
        expect((await screen.findByRole(`link`, { name: `Autumn round robin` })).getAttribute(`href`)).toBe(`/tournaments/t_autumnrobin1`);
        expect(screen.getByText(`4 of 12 bots entered`)).toBeTruthy();
        expect(screen.getByText(`in 3 h 0 min`)).toBeTruthy();
        unmount();
        serve({ tournaments: { running: { ...summary, status: `running`, round: { current: 2, of: 3 } }, scheduled: [], past: [] } });
        const second = render(<HomeScreen />);
        expect(await screen.findByText(`4 bots; turn clock 10 s`)).toBeTruthy();
        expect(screen.getByText(`live`)).toBeTruthy();
        second.unmount();
        serve({ tournaments: { running: null, scheduled: [{ ...summary, startsAt: new Date(Date.now() + 30 * 3_600_000).toISOString() }], past: [] } });
        render(<HomeScreen />);
        await screen.findByText(`No bots online right now`);
        expect(screen.queryByRole(`heading`, { name: `Tournament` })).toBeNull();
    });

    it('leads back to the reader\'s own live games, and drops one that ended', async () => {
        const mine = live(`mine`, { name: `tom`, rating: 1500, provisional: false, kind: `user` }, bot(`hextide`, 1600));
        const gone = live(`gone`, bot(`pebble`, 1400), { name: `tom`, rating: 1500, provisional: false, kind: `user` });
        serve({ me: { kind: `user`, name: `tom`, rating: 1500, provisional: false, discord: null, liveGames: [mine, gone] }, live: [mine] });
        meStore.start();
        render(<HomeScreen />);
        const yours = (await screen.findByRole(`heading`, { name: `Your games` })).closest(`section`);
        if (yours === null) throw new Error(`no games block`);
        await waitFor(() => {
            expect(within(yours).getAllByRole(`link`).map((link) => [link.textContent, link.getAttribute(`href`)])).toEqual([[`Against hextideYour turn`, `/game/mine`]]);
        });
    });
});
