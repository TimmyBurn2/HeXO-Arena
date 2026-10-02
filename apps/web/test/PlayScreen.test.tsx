// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BotListing, LiveGameEntry, Me } from '@hexo-arena/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onlyLegal } from './legal-deploy';
import { meStore } from '../src/me';
import { navigate } from '../src/router/use-route';
import { playStorageKey } from '../src/play/setup';
import { siteStatusStore } from '../src/site-status';
import { PlayScreen } from '../src/screens/PlayScreen';

const full = { turnMs: [5000, 300000], match: true, unlimited: true };
const bot = (name: string, rating: number, extra: Partial<BotListing> = {}): BotListing => ({
    name,
    ownerName: `owner`,
    online: true,
    openForChallenges: true,
    rating,
    provisional: false,
    liveGames: 0,
    accepts: full,
    ...extra,
});

const roster: BotListing[] = [
    bot(`sealbot`, 1712, { liveGames: 4 }),
    bot(`hextide`, 1690, { accepts: { turnMs: [5000, 60000], match: true, unlimited: false } }),
    bot(`devbot-c`, 1514),
    bot(`quietlake`, 1420, { provisional: true, accepts: { turnMs: [10000, 60000], match: false, unlimited: false } }),
    bot(`pebble`, 1388, { openForChallenges: false }),
    bot(`lantern`, 1500, { online: false, openForChallenges: false }),
];

const tom: Me = { kind: `user`, name: `tom`, rating: 1503, provisional: false, discord: null, liveGames: [] };
const snapshot = {
    gameId: `g1`,
    players: {
        x: { name: `tom`, rating: 1503, provisional: false, kind: `user` },
        o: { name: `devbot-c`, rating: 1514, provisional: false, kind: `bot` },
    },
    you: `x`,
    openingPlies: 5,
    board: { cells: [{ x: 0, y: 0, side: `x` }] },
    timeControl: { mode: `turn`, turnTimeMs: 10_000 },
    status: `in-progress`,
    toMove: `x`,
    clock: { mode: `turn`, remainingTurnMs: 10_000 },
};

interface Served {
    posts: { url: string; body: unknown }[];
    listReads: number;
}

type Answer = (body: unknown) => Response;

// The API as one test sees it: who is here, the bot list, and how a start answers.
function serve(options: { me?: Me; bots?: BotListing[] | (() => BotListing[]); start?: Answer; guest?: Answer; tournament?: string[] } = {}): Served {
    const served: Served = { posts: [], listReads: 0 };
    let me = options.me === undefined ? tom : options.me;
    vi.stubGlobal(
        `fetch`,
        vi.fn((url: string, init?: RequestInit) => {
            const body: unknown = typeof init?.body === `string` ? JSON.parse(init.body) : undefined;
            if (url === `/api/me`) return Promise.resolve(new Response(JSON.stringify(me)));
            if (url.startsWith(`/api/bots`)) {
                served.listReads += 1;
                const bots = typeof options.bots === `function` ? options.bots() : (options.bots ?? roster);
                return Promise.resolve(new Response(JSON.stringify(bots)));
            }
            if (url === `/api/auth/guest`) {
                served.posts.push({ url, body });
                const answer = options.guest?.(body) ?? new Response(JSON.stringify({ kind: `guest`, name: `Guest k3f9`, liveGames: [] }), { status: 201 });
                if (answer.status === 201) me = { kind: `guest`, name: `Guest k3f9`, liveGames: [] };
                return Promise.resolve(answer);
            }
            if (url === `/api/games`) {
                served.posts.push({ url, body });
                const answer = options.start?.(body) ?? new Response(JSON.stringify(snapshot), { status: 201 });
                if (answer.status === 401) me = null;
                return Promise.resolve(answer);
            }
            if (url === `/api/tournaments` && options.tournament !== undefined) {
                const running = { id: `t_autumnrobin1`, name: `Autumn round robin`, status: `running`, startsAt: `2026-10-01T18:00:00Z`, timeControl: { mode: `turn`, turnTimeMs: 10_000 }, openingPlies: 5, entrants: 3, maxEntrants: 12, winner: null, round: { current: 1, of: 3 } };
                return Promise.resolve(new Response(JSON.stringify({ running, scheduled: [], past: [] })));
            }
            if (url === `/api/tournaments/t_autumnrobin1` && options.tournament !== undefined) {
                const entries = options.tournament.map((name) => ({ bot: name, ownerName: `owner`, online: true, ratingAtStart: 1500, state: `playing` }));
                const detail = { id: `t_autumnrobin1`, name: `Autumn round robin`, status: `running`, startsAt: `2026-10-01T18:00:00Z`, startedAt: `2026-10-01T18:00:00Z`, endedAt: null, timeControl: { mode: `turn`, turnTimeMs: 10_000 }, openingPlies: 5, maxEntrants: 12, entries, rounds: [], standings: [], live: [] };
                return Promise.resolve(new Response(JSON.stringify(detail)));
            }
            return Promise.resolve(new Response(null, { status: 404 }));
        }),
    );
    meStore.reset();
    meStore.start();
    return served;
}

const refused = (status: number, code: string, headers: Record<string, string> = {}): Answer => () =>
    new Response(JSON.stringify({ error: `no`, code }), { status, headers });

async function ready(): Promise<HTMLElement> {
    return screen.findByRole(`region`, { name: `Game setup` });
}

function title(): string | null {
    return document.querySelector(`.setup-head h2`)?.textContent ?? null;
}

beforeEach(() => {
    window.history.replaceState(null, ``, `/play`);
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    meStore.reset();
    window.localStorage.clear();
    window.history.replaceState(null, ``, `/`);
});

describe('PlayScreen', () => {
    it('list the ready bots by rating, the busy one dimmed after, and count the rest', async () => {
        serve();
        render(<PlayScreen />);
        await ready();
        const rows = [...document.querySelectorAll(`.play-roster .roster-row`)];
        expect(rows.map((row) => row.querySelector(`.player-name`)?.textContent)).toEqual([`hextide`, `devbot-c`, `quietlake`, `sealbot`]);
        expect(screen.getByText(`3 bots ready`)).toBeTruthy();
        const busy = rows[3];
        expect(busy?.getAttribute(`aria-disabled`)).toBe(`true`);
        expect(busy?.querySelector(`input`)?.disabled).toBe(true);
        expect(busy?.textContent).toContain(`In 4 games; try again shortly`);
        expect(rows[0]?.textContent).toContain(`By owner`);
        expect(rows[0]?.textContent).toContain(`turn 5 to 60 s, match`);
        const foot = document.querySelector(`.play-roster .roster-foot`) as HTMLElement;
        expect(foot.textContent).toBe(`2 more bots are offline or closed; see Bots.`);
        expect(within(foot).getByRole(`link`, { name: `Bots` }).getAttribute(`href`)).toBe(`/bots`);
    });

    it('open on the ready bot nearest the rating and write the setup into the address', async () => {
        serve();
        render(<PlayScreen />);
        await ready();
        expect(title()).toBe(`Play devbot-c`);
        expect(window.location.pathname + window.location.search).toBe(`/play?bot=devbot-c&clock=t10`);
        expect(document.title).toBe(`Play devbot-c - HeXO Arena`);
        const history = window.history.length;
        fireEvent.click(screen.getByRole(`radio`, { name: /^hextide/u }));
        expect(title()).toBe(`Play hextide`);
        expect(window.location.search).toBe(`?bot=hextide&clock=t10`);
        expect(window.history.length).toBe(history);
    });

    it('open on a visitor as a new player, and on the bot a link names, pinned with its reason when not ready', async () => {
        serve({ me: null });
        render(<PlayScreen />);
        await ready();
        expect(title()).toBe(`Play quietlake`);
        cleanup();
        window.history.replaceState(null, ``, `/play?bot=pebble`);
        serve();
        render(<PlayScreen />);
        await ready();
        expect(title()).toBe(`Play pebble`);
        const first = document.querySelector(`.play-roster .roster-row`);
        expect(first?.textContent).toContain(`Closed for challenges`);
        expect(screen.getByText(`pebble is closed for challenges right now; pick another bot`)).toBeTruthy();
        expect(screen.getByRole(`button`, { name: `Start game` }).getAttribute(`aria-disabled`)).toBe(`true`);
        expect(document.querySelector(`.play-roster .roster-foot`)?.textContent).toBe(`1 more bot is offline or closed; see Bots.`);
    });

    it('open on the last bot played here when it is ready, with the last clock it takes', async () => {
        window.localStorage.setItem(playStorageKey, JSON.stringify({ opponent: `hextide`, clock: `t20` }));
        serve();
        render(<PlayScreen />);
        await ready();
        expect(title()).toBe(`Play hextide`);
        expect(screen.getByRole(`radio`, { name: `Turn clock, 20 seconds` })).toHaveProperty(`checked`, true);
    });

    it('draw the clocks a bot refuses as disabled tiles with the reason, and say what it takes', async () => {
        window.history.replaceState(null, ``, `/play?bot=quietlake`);
        serve();
        render(<PlayScreen />);
        await ready();
        const match = screen.getByRole(`radio`, { name: `Match clock, 5 minutes plus 3 seconds` });
        expect(match).toHaveProperty(`disabled`, true);
        expect(document.getElementById(match.getAttribute(`aria-describedby`) ?? ``)?.textContent).toBe(`quietlake does not accept this clock`);
        expect(screen.getByRole(`radio`, { name: `Turn clock, 10 seconds` })).toHaveProperty(`checked`, true);
        expect(screen.getByText(`quietlake accepts turn clocks of 10 to 60 s only.`)).toBeTruthy();
        fireEvent.click(screen.getByRole(`radio`, { name: /^devbot-c/u }));
        expect(screen.queryByText(/accepts turn clocks/u)).toBe(null);
    });

    it('set a clock by hand with steppers inside what the bot takes, and back to the presets', async () => {
        window.history.replaceState(null, ``, `/play?bot=quietlake`);
        serve();
        render(<PlayScreen />);
        await ready();
        fireEvent.click(screen.getByRole(`button`, { name: `Custom clock` }));
        const turn = screen.getByRole(`spinbutton`, { name: `Turn clock` });
        expect(turn.getAttribute(`aria-valuetext`)).toBe(`10 seconds`);
        expect(turn.getAttribute(`aria-valuemin`)).toBe(`10`);
        expect(turn.getAttribute(`aria-valuemax`)).toBe(`60`);
        expect(screen.getByRole(`button`, { name: `Decrease Turn clock` }).getAttribute(`aria-disabled`)).toBe(`true`);
        fireEvent.click(screen.getByRole(`button`, { name: `Increase Turn clock` }));
        fireEvent.keyDown(turn, { key: `ArrowUp` });
        expect(turn.getAttribute(`aria-valuetext`)).toBe(`20 seconds`);
        fireEvent.keyDown(turn, { key: `End` });
        expect(turn.textContent).toBe(`60 s`);
        expect(window.location.search).toBe(`?bot=quietlake&clock=t60`);
        fireEvent.keyDown(turn, { key: `ArrowDown` });
        expect(window.location.search).toBe(`?bot=quietlake&clock=turn-55`);
        expect(screen.getByRole(`button`, { name: `Match` }).getAttribute(`aria-disabled`)).toBe(`true`);
        fireEvent.click(screen.getByRole(`button`, { name: `Presets` }));
        expect(screen.getByRole(`radio`, { name: `Turn clock, 10 seconds` })).toHaveProperty(`checked`, true);
    });

    it('open a match clock by hand from the address, main time and increment in their bounds', async () => {
        window.history.replaceState(null, ``, `/play?bot=devbot-c&clock=match-7-4`);
        serve();
        render(<PlayScreen />);
        await ready();
        const main = screen.getByRole(`spinbutton`, { name: `Main time` });
        expect(main.getAttribute(`aria-valuetext`)).toBe(`7 minutes`);
        expect(screen.getByRole(`spinbutton`, { name: `Increment` }).getAttribute(`aria-valuetext`)).toBe(`plus 4 seconds`);
        fireEvent.keyDown(main, { key: `Home` });
        expect(main.textContent).toBe(`1 min`);
        expect(screen.getByRole(`button`, { name: `Match` }).getAttribute(`aria-pressed`)).toBe(`true`);
    });

    it('keep the opening one quiet row until opened, then show an example of the chosen count', async () => {
        serve();
        render(<PlayScreen />);
        await ready();
        const row = document.querySelector(`details.opening`);
        expect(row?.hasAttribute(`open`)).toBe(false);
        expect(row?.querySelector(`summary`)?.textContent).toBe(`Opening5 stones`);
        expect(screen.queryByRole(`img`)).toBe(null);
        act(() => {
            row?.setAttribute(`open`, ``);
            row?.dispatchEvent(new Event(`toggle`));
        });
        expect(screen.getByRole(`img`, { name: `An example opening of 5 stones` }).querySelectorAll(`.stone-art`)).toHaveLength(5);
        expect(screen.getByText(`The origin and 4 random stones near it; each game draws its own.`)).toBeTruthy();
        fireEvent.click(screen.getByRole(`radio`, { name: `1` }));
        expect(screen.getByRole(`img`, { name: `An example opening of 1 stone` }).querySelectorAll(`.stone-art`)).toHaveLength(1);
        expect(screen.getByText(`Only the origin; no random stones.`)).toBeTruthy();
        expect(window.location.search).toBe(`?bot=devbot-c&clock=t10&opening=1`);
    });

    it('start a rated game for someone signed in and remember the opponent and clock, not the opening', async () => {
        const served = serve();
        render(<PlayScreen />);
        await ready();
        expect(screen.getByText(`Rated; sides are drawn at random`)).toBeTruthy();
        fireEvent.click(screen.getByRole(`button`, { name: `Start game` }), { detail: 1 });
        await waitFor(() => {
            expect(window.location.pathname).toBe(`/game/g1`);
        });
        expect(served.posts).toEqual([{ url: `/api/games`, body: { bot: `devbot-c`, timeControl: { mode: `turn`, turnTimeMs: 10_000 }, openingPlies: 5 } }]);
        expect(JSON.parse(window.localStorage.getItem(playStorageKey) ?? ``)).toEqual({ opponent: `devbot-c`, clock: `t10` });
    });

    it('offer a signed-out visitor a guest game or a sign-in, with one notice under both', async () => {
        window.history.replaceState(null, ``, `/play?bot=devbot-c`);
        const served = serve({ me: null });
        render(<PlayScreen />);
        await ready();
        expect(screen.getByText(`Play as a guest, unrated, or sign in for a rated game.`)).toBeTruthy();
        const signIn = screen.getByRole(`link`, { name: `Sign in with Discord` });
        expect(signIn.getAttribute(`href`)).toBe(`/api/auth/discord/login?next=%2Fplay%3Fbot%3Ddevbot-c%26clock%3Dt10`);
        const notice = screen.getByText(/^By playing as a guest you accept the/u);
        expect(notice.textContent).toBe(
            `By playing as a guest you accept the Terms, including the minimum age of 16. Your email stays with Discord, and a first sign-in asks for your public name; see\u00a0Privacy.`,
        );
        expect(within(notice).getByRole(`link`, { name: `Terms` }).getAttribute(`href`)).toBe(`/legal/terms`);
        fireEvent.click(screen.getByRole(`button`, { name: `Play as guest` }), { detail: 1 });
        await waitFor(() => {
            expect(window.location.pathname).toBe(`/game/g1`);
        });
        expect(served.posts.map((post) => post.url)).toEqual([`/api/auth/guest`, `/api/games`]);
    });

    it('leave out the terms sentence and the privacy link the deployment has no documents for', async () => {
        onlyLegal(`imprint`);
        window.history.replaceState(null, ``, `/play?bot=devbot-c`);
        serve({ me: null });
        render(<PlayScreen />);
        await ready();
        const notice = document.querySelector(`.start-notice`);
        expect(notice?.textContent).toBe(`Your email stays with Discord, and a first sign-in asks for your public name.`);
        expect(notice?.querySelector(`a`)).toBe(null);
    });

    it('say when the guest limit is full, and when a guest session does not start', async () => {
        serve({ me: null, guest: refused(429, `guest_limit`, { 'retry-after': `60` }) });
        render(<PlayScreen />);
        await ready();
        fireEvent.click(screen.getByRole(`button`, { name: `Play as guest` }), { detail: 1 });
        expect(await screen.findByText(`The guest limit is full; try again in a minute, or sign in`)).toBeTruthy();
        cleanup();
        serve({ me: null, guest: refused(500, `internal`) });
        render(<PlayScreen />);
        await ready();
        fireEvent.click(screen.getByRole(`button`, { name: `Play as guest` }), { detail: 1 });
        expect(await screen.findByText(`The guest session did not start; try again`)).toBeTruthy();
    });

    it('ignore the second click of a double click', async () => {
        const served = serve({ start: refused(500, `internal`) });
        render(<PlayScreen />);
        await ready();
        fireEvent.click(screen.getByRole(`button`, { name: `Start game` }), { detail: 2 });
        expect(served.posts).toHaveLength(0);
        fireEvent.click(screen.getByRole(`button`, { name: `Start game` }), { detail: 0 });
        await waitFor(() => {
            expect(served.posts).toHaveLength(1);
        });
    });

    it('count a cooldown down on the disabled start, then let it go', async () => {
        vi.useFakeTimers({ toFake: [`setInterval`, `clearInterval`, `Date`] });
        serve({ start: refused(429, `game_cooldown`, { 'retry-after': `3` }) });
        render(<PlayScreen />);
        await ready();
        const start = screen.getByRole(`button`, { name: `Start game` });
        fireEvent.click(start, { detail: 1 });
        const shown = () => document.querySelector(`.start-lines [aria-hidden="true"]`)?.textContent;
        const spoken = () => document.querySelector(`.start-lines .sr-only`)?.textContent;
        await waitFor(() => {
            expect(shown()).toBe(`1 new game a minute; try again in 3 s`);
        });
        expect(start.getAttribute(`aria-disabled`)).toBe(`true`);
        // The countdown's interval starts in an effect, so it runs before the clock moves.
        await act(async () => {});
        act(() => {
            vi.advanceTimersByTime(1000);
        });
        expect(shown()).toBe(`1 new game a minute; try again in 2 s`);
        // The status region says the wait once, not every second.
        expect(spoken()).toBe(`1 new game a minute; try again in 3 s`);
        act(() => {
            vi.advanceTimersByTime(2000);
        });
        expect(screen.queryByText(/try again in/u)).toBe(null);
        expect(start.getAttribute(`aria-disabled`)).toBe(null);
    });

    it('count a rate limit down on the disabled start, then let it go', async () => {
        vi.useFakeTimers({ toFake: [`setInterval`, `clearInterval`, `Date`] });
        serve({ start: refused(429, `rate_limited`, { 'retry-after': `2` }) });
        render(<PlayScreen />);
        await ready();
        const start = screen.getByRole(`button`, { name: `Start game` });
        fireEvent.click(start, { detail: 1 });
        const shown = () => document.querySelector(`.start-lines [aria-hidden="true"]`)?.textContent;
        await waitFor(() => {
            expect(shown()).toBe(`Too many tries; try again in 2 s`);
        });
        expect(start.getAttribute(`aria-disabled`)).toBe(`true`);
        await act(async () => {});
        act(() => {
            vi.advanceTimersByTime(1000);
        });
        expect(shown()).toBe(`Too many tries; try again in 1 s`);
        expect(document.querySelector(`.start-lines .sr-only`)?.textContent).toBe(`Too many tries; try again in 2 s`);
        act(() => {
            vi.advanceTimersByTime(1000);
        });
        expect(screen.queryByText(/try again in/u)).toBe(null);
        expect(start.getAttribute(`aria-disabled`)).toBe(null);
    });

    it('hold Play as guest for the wait a rate-limited guest session names, leaving Sign in', async () => {
        vi.useFakeTimers({ toFake: [`setInterval`, `clearInterval`, `Date`] });
        serve({ me: null, guest: refused(429, `rate_limited`, { 'retry-after': `1140` }) });
        render(<PlayScreen />);
        await ready();
        const guest = screen.getByRole(`button`, { name: `Play as guest` });
        fireEvent.click(guest, { detail: 1 });
        await waitFor(() => {
            expect(document.querySelector(`.start-lines .sr-only`)?.textContent).toBe(
                `Too many guest sessions from this network; try again in 19 minutes, or sign in`,
            );
        });
        expect(guest.getAttribute(`aria-disabled`)).toBe(`true`);
        expect(screen.getByRole(`link`, { name: /Sign in/u }).getAttribute(`aria-disabled`)).toBe(null);
    });

    it('wait the cooldown the contract sets when the refusal names no wait', async () => {
        vi.useFakeTimers({ toFake: [`setInterval`, `clearInterval`, `Date`] });
        serve({ start: refused(429, `game_cooldown`) });
        render(<PlayScreen />);
        await ready();
        fireEvent.click(screen.getByRole(`button`, { name: `Start game` }), { detail: 1 });
        await waitFor(() => {
            expect(document.querySelector(`.start-lines .sr-only`)?.textContent).toBe(`1 new game a minute; try again in 60 s`);
        });
    });

    it('list a bot the running tournament holds as busy until it ends, and say so with a link to the tournament when it is the one picked', async () => {
        serve({ tournament: [`hextide`] });
        window.history.replaceState(null, ``, `/play?bot=hextide`);
        render(<PlayScreen />);
        await ready();
        const line = await screen.findByText((_content, element) => element?.textContent === `hextide is in Autumn round robin until it ends; pick another bot` && element.tagName === `P`);
        expect(within(line).getByRole(`link`, { name: `Autumn round robin` }).getAttribute(`href`)).toBe(`/tournaments/t_autumnrobin1`);
        const row = screen.getAllByRole(`radio`, { name: /hextide/u })[0]?.closest(`label`);
        expect(row?.textContent).toContain(`In a tournament until it ends`);
    });

    it('say the game is starting while the start is sent', async () => {
        const held: { answer: (() => void) | null } = { answer: null };
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) => {
                if (url === `/api/me`) return Promise.resolve(new Response(JSON.stringify(tom)));
                if (url.startsWith(`/api/bots`)) return Promise.resolve(new Response(JSON.stringify(roster)));
                return new Promise<Response>((resolve) => {
                    held.answer = () => {
                        resolve(new Response(JSON.stringify({ error: `no`, code: `internal` }), { status: 500 }));
                    };
                });
            }),
        );
        meStore.reset();
        meStore.start();
        render(<PlayScreen />);
        await ready();
        fireEvent.click(screen.getByRole(`button`, { name: `Start game` }), { detail: 1 });
        await waitFor(() => {
            expect(document.querySelector(`.start-lines`)?.textContent).toBe(`Starting the game`);
        });
        held.answer?.();
        expect(await screen.findByText(`The game did not start; try again`)).toBeTruthy();
    });

    it('say a refusal once when the list read after it shows the same reason', async () => {
        let bots = roster;
        serve({
            bots: () => bots,
            start: () => {
                bots = roster.map((entry) => (entry.name === `devbot-c` ? { ...entry, liveGames: 4 } : entry));
                return refused(400, `bot_busy`)(undefined);
            },
        });
        render(<PlayScreen />);
        await ready();
        fireEvent.click(screen.getByRole(`button`, { name: `Start game` }), { detail: 1 });
        await waitFor(() => {
            expect(document.querySelector(`.play-roster .roster-row:last-child`)?.textContent).toContain(`In 4 games`);
        });
        expect(screen.getAllByText(`devbot-c is in 4 games already; try again shortly`)).toHaveLength(1);
        expect(title()).toBe(`Play devbot-c`);
    });

    it('probe the site status again when a start is refused as paused', async () => {
        serve({ start: refused(503, `paused`) });
        render(<PlayScreen />);
        await ready();
        const probes = () => vi.mocked(fetch).mock.calls.filter(([url]) => url === `/healthz`).length;
        const before = probes();
        fireEvent.click(screen.getByRole(`button`, { name: `Start game` }), { detail: 1 });
        await screen.findByText(`Starting games is paused; live games continue`);
        expect(probes()).toBe(before + 1);
    });

    it.each([
        [400, `human_busy`, `You already have 3 live games; finish one first`, false],
        [400, `bot_busy`, `devbot-c is in 4 games already; try again shortly`, true],
        [400, `clock_not_accepted`, `devbot-c no longer accepts that clock; pick another`, true],
        [400, `not_open`, `devbot-c is closed for challenges right now`, true],
        [403, `delisted`, `devbot-c takes no new games`, true],
        [404, `not_found`, `devbot-c is no longer listed; pick another bot`, true],
        [503, `paused`, `Starting games is paused; live games continue`, false],
        [500, `internal`, `The game did not start; try again`, false],
    ])('say why a start with %i %s did not happen, reading the list again after a refusal on the bot side', async (status, code, line, rereads) => {
        const served = serve({ start: refused(status, code) });
        render(<PlayScreen />);
        await ready();
        const reads = served.listReads;
        fireEvent.click(screen.getByRole(`button`, { name: `Start game` }), { detail: 1 });
        expect(await screen.findByText(line)).toBeTruthy();
        await waitFor(() => {
            expect(served.listReads > reads).toBe(rereads);
        });
    });

    it('lead to the games that fill the cap when a start is refused for it, reading the session again for them', async () => {
        const game = (gameId: string, opponent: string, tomSide: `x` | `o`): LiveGameEntry => {
            const tomSeat = { name: `tom`, rating: 1503, provisional: false, kind: `user` as const };
            const bot = { name: opponent, rating: 1600, provisional: false, kind: `bot` as const };
            return {
                gameId,
                players: tomSide === `x` ? { x: tomSeat, o: bot } : { x: bot, o: tomSeat },
                timeControl: { mode: `unlimited` },
                toMove: `x`,
                rated: true,
                cells: [{ x: 0, y: 0, side: `x` }],
                clock: { mode: `unlimited` },
            };
        };
        const liveGames = [game(`g1`, `hextide`, `x`), game(`g2`, `pebble`, `o`), game(`g3`, `lantern`, `x`)];
        serve({ me: { kind: `user`, name: `tom`, rating: 1503, provisional: false, discord: null, liveGames }, start: refused(400, `human_busy`) });
        render(<PlayScreen />);
        await ready();
        const sessionReads = () => vi.mocked(fetch).mock.calls.filter(([url]) => url === `/api/me`).length;
        const before = sessionReads();
        fireEvent.click(screen.getByRole(`button`, { name: `Start game` }), { detail: 1 });
        expect(await screen.findByText(`You already have 3 live games; finish one first`)).toBeTruthy();
        const links = await screen.findAllByRole(`link`, { name: /^Your game against/u });
        expect(links.map((link) => [link.textContent, link.getAttribute(`href`)])).toEqual([
            [`Your game against hextide`, `/game/g1`],
            [`Your game against pebble`, `/game/g2`],
            [`Your game against lantern`, `/game/g3`],
        ]);
        expect(sessionReads()).toBe(before + 1);
    });

    it('show the ways in, with a warning that takes focus, once a refused session reads as signed out', async () => {
        const served = serve({ start: refused(401, `unauthorized`) });
        render(<PlayScreen />);
        await ready();
        const start = screen.getByRole(`button`, { name: `Start game` });
        start.focus();
        fireEvent.click(start, { detail: 0 });
        const warning = await screen.findByText(`You are no longer signed in; sign in again, or play as a guest.`);
        expect(screen.getByRole(`button`, { name: `Play as guest` })).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Sign in with Discord` })).toBeTruthy();
        expect(screen.queryByRole(`button`, { name: `Start game` })).toBe(null);
        // A second press of the key that started lands on the warning, never on Play as guest.
        await waitFor(() => {
            expect(document.activeElement).toBe(warning);
        });
        expect(served.posts.map((post) => post.url)).toEqual([`/api/games`]);
    });

    it('tell a guest whose session ended that the guest session ended', async () => {
        serve({ me: { kind: `guest`, name: `Guest k3f9`, liveGames: [] }, start: refused(401, `unauthorized`) });
        render(<PlayScreen />);
        await ready();
        fireEvent.click(screen.getByRole(`button`, { name: `Start game` }), { detail: 1 });
        expect(await screen.findByText(`Your guest session ended; play as a guest again, or sign in.`)).toBeTruthy();
    });

    it('say no bots are ready when every ready bot is at its game cap', async () => {
        serve({ bots: roster.map((entry) => ({ ...entry, liveGames: 4 })) });
        render(<PlayScreen />);
        await ready();
        expect(screen.getByText(`No bots ready`)).toBeTruthy();
    });

    it('say a linked bot is not listed, and open on another', async () => {
        window.history.replaceState(null, ``, `/play?bot=nobody`);
        serve();
        render(<PlayScreen />);
        await ready();
        expect(screen.getByText(`nobody is no longer listed; pick another bot`)).toBeTruthy();
        expect(title()).toBe(`Play devbot-c`);
    });

    it('keep a linked bot that is not ready in the list after another is picked, so no row moves', async () => {
        window.history.replaceState(null, ``, `/play?bot=pebble`);
        serve();
        render(<PlayScreen />);
        await ready();
        const names = () => [...document.querySelectorAll(`.play-roster .roster-row .player-name`)].map((name) => name.textContent);
        const before = names();
        fireEvent.click(screen.getByRole(`radio`, { name: /^hextide/u }));
        expect(title()).toBe(`Play hextide`);
        expect(names()).toEqual(before);
    });

    it('read the setup again when a navigation or Back changes the address', async () => {
        window.history.replaceState(null, ``, `/play?bot=hextide&clock=m5`);
        serve();
        render(<PlayScreen />);
        await ready();
        expect(title()).toBe(`Play hextide`);
        act(() => {
            navigate(`/play`);
        });
        await waitFor(() => {
            expect(title()).toBe(`Play devbot-c`);
        });
        expect(window.location.search).toBe(`?bot=devbot-c&clock=t10`);
        act(() => {
            window.history.replaceState(null, ``, `/play?bot=hextide&clock=m5`);
            window.dispatchEvent(new PopStateEvent(`popstate`));
        });
        await waitFor(() => {
            expect(title()).toBe(`Play hextide`);
        });
        expect(screen.getByRole(`radio`, { name: `Match clock, 5 minutes plus 3 seconds` })).toHaveProperty(`checked`, true);
    });

    it('move to a ready bot when the picked one leaves the list, never back to a busy one it opened on', async () => {
        let bots = roster;
        serve({ bots: () => bots });
        vi.useFakeTimers({ toFake: [`setInterval`, `clearInterval`] });
        render(<PlayScreen />);
        await ready();
        expect(title()).toBe(`Play devbot-c`);
        fireEvent.click(screen.getByRole(`radio`, { name: /^hextide/u }));
        bots = roster.filter((entry) => entry.name !== `hextide`).map((entry) => (entry.name === `devbot-c` ? { ...entry, liveGames: 4 } : entry));
        await act(async () => {
            vi.advanceTimersByTime(15_000);
            await Promise.resolve();
        });
        expect(await screen.findByText(`hextide is no longer listed; pick another bot`)).toBeTruthy();
        expect(title()).toBe(`Play quietlake`);
    });

    it('keep a refusal and a held start when the list read after it changes the clock, until the person picks', async () => {
        let bots = roster;
        serve({
            bots: () => bots,
            start: () => {
                bots = roster.map((entry) => (entry.name === `devbot-c` ? { ...entry, accepts: { turnMs: [20000, 60000], match: false, unlimited: false } } : entry));
                return refused(400, `clock_not_accepted`)(undefined);
            },
        });
        render(<PlayScreen />);
        await ready();
        const start = screen.getByRole(`button`, { name: `Start game` });
        fireEvent.click(start, { detail: 1 });
        await waitFor(() => {
            expect(screen.getByRole(`radio`, { name: `Turn clock, 20 seconds` })).toHaveProperty(`checked`, true);
        });
        expect(screen.getByText(`devbot-c no longer accepts that clock; pick another`)).toBeTruthy();
        expect(start.getAttribute(`aria-disabled`)).toBe(`true`);
        fireEvent.click(screen.getByRole(`radio`, { name: `Turn clock, 60 seconds` }));
        expect(screen.queryByText(`devbot-c no longer accepts that clock; pick another`)).toBe(null);
        expect(start.getAttribute(`aria-disabled`)).toBe(null);
    });

    it('say the start failed when the session still reads as someone after a 401', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) => {
                if (url === `/api/me`) return Promise.resolve(new Response(JSON.stringify(tom)));
                if (url.startsWith(`/api/bots`)) return Promise.resolve(new Response(JSON.stringify(roster)));
                if (url === `/api/games`) return Promise.resolve(refused(401, `unauthorized`)(undefined));
                return Promise.resolve(new Response(null, { status: 404 }));
            }),
        );
        meStore.reset();
        meStore.start();
        render(<PlayScreen />);
        await ready();
        fireEvent.click(screen.getByRole(`button`, { name: `Start game` }), { detail: 1 });
        expect(await screen.findByText(`The game did not start; try again`)).toBeTruthy();
        expect(screen.getByRole(`button`, { name: `Start game` }).getAttribute(`aria-disabled`)).toBe(null);
    });

    it('tell someone who pressed Play as guest that the guest session ended when the start meets a 401', async () => {
        serve({ me: null, start: refused(401, `unauthorized`) });
        render(<PlayScreen />);
        await ready();
        fireEvent.click(screen.getByRole(`button`, { name: `Play as guest` }), { detail: 1 });
        expect(await screen.findByText(`Your guest session ended; play as a guest again, or sign in.`)).toBeTruthy();
    });

    it('keep a row that goes offline under the person in place when they pick another', async () => {
        let bots = roster;
        serve({ bots: () => bots });
        vi.useFakeTimers({ toFake: [`setInterval`, `clearInterval`] });
        render(<PlayScreen />);
        await ready();
        fireEvent.click(screen.getByRole(`radio`, { name: /^hextide/u }));
        bots = roster.map((entry) => (entry.name === `hextide` ? { ...entry, online: false, openForChallenges: false } : entry));
        await act(async () => {
            vi.advanceTimersByTime(15_000);
            await Promise.resolve();
        });
        const names = () => [...document.querySelectorAll(`.play-roster .roster-row .player-name`)].map((name) => name.textContent);
        await waitFor(() => {
            expect(names()[0]).toBe(`hextide`);
        });
        const before = names();
        fireEvent.click(screen.getByRole(`radio`, { name: /^devbot-c/u }));
        expect(title()).toBe(`Play devbot-c`);
        expect(names()).toEqual(before);
    });

    it('write the setup back into the address when the nav opens the same setup again', async () => {
        serve();
        render(<PlayScreen />);
        await ready();
        expect(window.location.search).toBe(`?bot=devbot-c&clock=t10`);
        act(() => {
            navigate(`/play`);
        });
        await waitFor(() => {
            expect(window.location.search).toBe(`?bot=devbot-c&clock=t10`);
        });
    });

    it('let the start go once the list reads a bot that was busy as ready, and start on the next press', async () => {
        let bots = roster;
        let refuse = true;
        const served = serve({
            bots: () => bots,
            start: () => {
                if (!refuse) return new Response(JSON.stringify(snapshot), { status: 201 });
                refuse = false;
                return refused(400, `bot_busy`)(undefined);
            },
        });
        vi.useFakeTimers({ toFake: [`setInterval`, `clearInterval`] });
        render(<PlayScreen />);
        await ready();
        const start = screen.getByRole(`button`, { name: `Start game` });
        fireEvent.click(start, { detail: 1 });
        expect(await screen.findByText(`devbot-c is in 4 games already; try again shortly`)).toBeTruthy();
        bots = roster.map((entry) => ({ ...entry }));
        await act(async () => {
            vi.advanceTimersByTime(15_000);
            await Promise.resolve();
        });
        await waitFor(() => {
            expect(screen.queryByText(`devbot-c is in 4 games already; try again shortly`)).toBe(null);
        });
        expect(start.getAttribute(`aria-disabled`)).toBe(null);
        fireEvent.click(start, { detail: 0 });
        await waitFor(() => {
            expect(window.location.pathname).toBe(`/game/g1`);
        });
        expect(served.posts).toHaveLength(2);
    });

    it('say once that a refused bot is no longer listed when the list read after it drops the bot', async () => {
        let bots = roster;
        serve({
            bots: () => bots,
            start: () => {
                bots = roster.filter((entry) => entry.name !== `devbot-c`);
                return refused(404, `not_found`)(undefined);
            },
        });
        render(<PlayScreen />);
        await ready();
        fireEvent.click(screen.getByRole(`button`, { name: `Start game` }), { detail: 1 });
        await waitFor(() => {
            expect(title()).not.toBe(`Play devbot-c`);
        });
        await act(async () => {});
        expect(screen.getAllByText(`devbot-c is no longer listed; pick another bot`)).toHaveLength(1);
        expect(screen.getByRole(`button`, { name: `Start game` }).getAttribute(`aria-disabled`)).toBe(`true`);
    });

    it('let a held start go when the person picks again, the shown clock, the shown bot, or the opening', async () => {
        const repicks: [string, () => void][] = [
            [`the shown clock`, () => fireEvent.click(screen.getByRole(`radio`, { name: `Turn clock, 20 seconds` }))],
            [`the shown bot`, () => fireEvent.click(screen.getByRole(`radio`, { name: /^devbot-c/u }))],
            [
                `the opening`,
                () => {
                    const row = document.querySelector(`details.opening`);
                    act(() => {
                        row?.setAttribute(`open`, ``);
                        row?.dispatchEvent(new Event(`toggle`));
                    });
                    fireEvent.click(screen.getByRole(`radio`, { name: `5` }));
                },
            ],
        ];
        for (const [what, repick] of repicks) {
            window.history.replaceState(null, ``, `/play`);
            let bots = roster;
            serve({
                bots: () => bots,
                start: () => {
                    bots = roster.map((entry) => (entry.name === `devbot-c` ? { ...entry, accepts: { turnMs: [20000, 60000], match: false, unlimited: false } } : entry));
                    return refused(400, `clock_not_accepted`)(undefined);
                },
            });
            const { unmount } = render(<PlayScreen />);
            await ready();
            const start = screen.getByRole(`button`, { name: `Start game` });
            fireEvent.click(start, { detail: 1 });
            await waitFor(() => {
                expect(screen.getByRole(`radio`, { name: `Turn clock, 20 seconds` })).toHaveProperty(`checked`, true);
            });
            expect(start.getAttribute(`aria-disabled`)).toBe(`true`);
            repick();
            expect([what, start.getAttribute(`aria-disabled`)]).toEqual([what, null]);
            unmount();
        }
    });

    it('keep the start held when the list swaps a clock set by hand for another, which nobody picked', async () => {
        window.localStorage.setItem(playStorageKey, JSON.stringify({ opponent: `devbot-c`, clock: `u` }));
        window.history.replaceState(null, ``, `/play?bot=devbot-c&clock=turn-25`);
        let bots = roster;
        serve({
            bots: () => bots,
            start: () => {
                bots = roster.map((entry) => (entry.name === `devbot-c` ? { ...entry, accepts: { turnMs: [5000, 20000], match: false, unlimited: true } } : entry));
                return refused(400, `clock_not_accepted`)(undefined);
            },
        });
        render(<PlayScreen />);
        await ready();
        const start = screen.getByRole(`button`, { name: `Start game` });
        fireEvent.click(start, { detail: 1 });
        await waitFor(() => {
            expect(screen.getByRole(`spinbutton`, { name: `Turn clock` }).getAttribute(`aria-valuenow`)).toBe(`5`);
        });
        await act(async () => {});
        expect(screen.getByText(`devbot-c no longer accepts that clock; pick another`)).toBeTruthy();
        expect(start.getAttribute(`aria-disabled`)).toBe(`true`);
    });

    it('stay on the bot it moved to when the picked one left, however the list changes after', async () => {
        let bots = roster;
        serve({ bots: () => bots });
        vi.useFakeTimers({ toFake: [`setInterval`, `clearInterval`] });
        render(<PlayScreen />);
        await ready();
        fireEvent.click(screen.getByRole(`radio`, { name: /^hextide/u }));
        bots = roster.filter((entry) => entry.name !== `hextide`);
        await act(async () => {
            vi.advanceTimersByTime(15_000);
            await Promise.resolve();
        });
        await waitFor(() => {
            expect(title()).toBe(`Play devbot-c`);
        });
        bots = roster.filter((entry) => entry.name !== `hextide`).map((entry) => (entry.name === `devbot-c` ? { ...entry, liveGames: 4 } : entry));
        await act(async () => {
            vi.advanceTimersByTime(15_000);
            await Promise.resolve();
        });
        await waitFor(() => {
            expect(screen.getByText(`devbot-c is in 4 games already; try again shortly`)).toBeTruthy();
        });
        expect(title()).toBe(`Play devbot-c`);
        expect(screen.getByText(`hextide is no longer listed; pick another bot`)).toBeTruthy();
    });

    it('pin only bots the card showed while they were not ready, not those passed over', async () => {
        let bots = roster;
        serve({ bots: () => bots });
        vi.useFakeTimers({ toFake: [`setInterval`, `clearInterval`] });
        render(<PlayScreen />);
        await ready();
        fireEvent.click(screen.getByRole(`radio`, { name: /^hextide/u }));
        fireEvent.click(screen.getByRole(`radio`, { name: /^quietlake/u }));
        bots = roster.map((entry) => (entry.name === `hextide` ? { ...entry, online: false, openForChallenges: false } : entry));
        await act(async () => {
            vi.advanceTimersByTime(15_000);
            await Promise.resolve();
        });
        await waitFor(() => {
            expect(document.querySelector(`.play-roster .roster-foot`)?.textContent).toBe(`3 more bots are offline or closed; see Bots.`);
        });
        const names = [...document.querySelectorAll(`.play-roster .roster-row .player-name`)].map((name) => name.textContent);
        expect(names).not.toContain(`hextide`);
    });

    it('show no refusal line under the banner when the site reads paused', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) => {
                if (url === `/api/me`) return Promise.resolve(new Response(JSON.stringify(tom)));
                if (url.startsWith(`/api/bots`)) return Promise.resolve(new Response(JSON.stringify(roster)));
                if (url === `/healthz`) return Promise.resolve(new Response(`{}`, { status: 503 }));
                return Promise.resolve(refused(503, `paused`)(undefined));
            }),
        );
        meStore.reset();
        meStore.start();
        render(<PlayScreen />);
        await ready();
        fireEvent.click(screen.getByRole(`button`, { name: `Start game` }), { detail: 1 });
        expect(await screen.findByText(`Starting games is paused; this page updates when it resumes`)).toBeTruthy();
        expect(screen.queryByText(`Starting games is paused; live games continue`)).toBe(null);
        vi.stubGlobal(
            `fetch`,
            vi.fn(() => Promise.resolve(new Response(`{}`, { status: 200 }))),
        );
        await act(async () => {
            await siteStatusStore.probe();
        });
    });

    it('keep a busy refusal and its hold when the list narrows the clocks before the bot frees, saying the clock now', async () => {
        let bots = roster;
        serve({
            bots: () => bots,
            start: () => {
                bots = roster.map((entry) => (entry.name === `devbot-c` ? { ...entry, liveGames: 4 } : entry));
                return refused(400, `bot_busy`)(undefined);
            },
        });
        vi.useFakeTimers({ toFake: [`setInterval`, `clearInterval`] });
        render(<PlayScreen />);
        await ready();
        const start = screen.getByRole(`button`, { name: `Start game` });
        fireEvent.click(start, { detail: 1 });
        await screen.findByText(`devbot-c is in 4 games already; try again shortly`);
        bots = roster.map((entry) => (entry.name === `devbot-c` ? { ...entry, accepts: { turnMs: [20000, 60000], match: false, unlimited: false } } : entry));
        for (let read = 0; read < 2; read += 1) {
            await act(async () => {
                vi.advanceTimersByTime(15_000);
                await Promise.resolve();
            });
        }
        await waitFor(() => {
            expect(screen.getByRole(`radio`, { name: `Turn clock, 20 seconds` })).toHaveProperty(`checked`, true);
        });
        await act(async () => {});
        expect(screen.getByText(`devbot-c no longer accepts that clock; pick another`)).toBeTruthy();
        expect(screen.queryByText(`devbot-c is in 4 games already; try again shortly`)).toBe(null);
        expect(start.getAttribute(`aria-disabled`)).toBe(`true`);
    });

    it('hold a clock refusal through later reads until the person picks, a press on Custom clock included', async () => {
        let bots = roster;
        serve({
            bots: () => bots,
            start: () => {
                bots = roster.map((entry) => (entry.name === `devbot-c` ? { ...entry, accepts: { turnMs: [20000, 60000], match: false, unlimited: false } } : entry));
                return refused(400, `clock_not_accepted`)(undefined);
            },
        });
        vi.useFakeTimers({ toFake: [`setInterval`, `clearInterval`] });
        render(<PlayScreen />);
        await ready();
        const start = screen.getByRole(`button`, { name: `Start game` });
        fireEvent.click(start, { detail: 1 });
        await waitFor(() => {
            expect(screen.getByRole(`radio`, { name: `Turn clock, 20 seconds` })).toHaveProperty(`checked`, true);
        });
        for (let read = 0; read < 2; read += 1) {
            await act(async () => {
                vi.advanceTimersByTime(15_000);
                await Promise.resolve();
            });
        }
        await act(async () => {});
        expect(start.getAttribute(`aria-disabled`)).toBe(`true`);
        fireEvent.click(screen.getByRole(`button`, { name: `Custom clock` }));
        expect(start.getAttribute(`aria-disabled`)).toBe(null);
    });

    it('let Space on the clock already picked count as the person picking it', async () => {
        let bots = roster;
        serve({
            bots: () => bots,
            start: () => {
                bots = roster.map((entry) => (entry.name === `devbot-c` ? { ...entry, accepts: { turnMs: [20000, 60000], match: false, unlimited: false } } : entry));
                return refused(400, `clock_not_accepted`)(undefined);
            },
        });
        render(<PlayScreen />);
        await ready();
        const start = screen.getByRole(`button`, { name: `Start game` });
        fireEvent.click(start, { detail: 1 });
        const shown = await waitFor(() => {
            const tile = screen.getByRole(`radio`, { name: `Turn clock, 20 seconds` });
            expect(tile).toHaveProperty(`checked`, true);
            return tile;
        });
        expect(start.getAttribute(`aria-disabled`)).toBe(`true`);
        fireEvent.keyUp(shown, { key: ` ` });
        expect(start.getAttribute(`aria-disabled`)).toBe(null);
    });

    it('drop the line about a lost bot when it is listed again, or when the person picks another', async () => {
        let bots = roster;
        serve({ bots: () => bots });
        vi.useFakeTimers({ toFake: [`setInterval`, `clearInterval`] });
        render(<PlayScreen />);
        await ready();
        fireEvent.click(screen.getByRole(`radio`, { name: /^hextide/u }));
        const read = async () => {
            await act(async () => {
                vi.advanceTimersByTime(15_000);
                await Promise.resolve();
            });
        };
        bots = roster.filter((entry) => entry.name !== `hextide`);
        await read();
        expect(await screen.findByText(`hextide is no longer listed; pick another bot`)).toBeTruthy();
        bots = roster;
        await read();
        await waitFor(() => {
            expect(screen.queryByText(`hextide is no longer listed; pick another bot`)).toBe(null);
        });
        bots = roster.filter((entry) => entry.name !== `quietlake`);
        fireEvent.click(screen.getByRole(`radio`, { name: /^quietlake/u }));
        await read();
        expect(await screen.findByText(`quietlake is no longer listed; pick another bot`)).toBeTruthy();
        fireEvent.click(screen.getByRole(`radio`, { name: /^hextide/u }));
        expect(screen.queryByText(`quietlake is no longer listed; pick another bot`)).toBe(null);
    });

    it.each([`not_found`, `delisted`, `clock_not_accepted`, `bot_busy`, `not_open`])(
        'go back to a bot refused as %s once the list drops it and lists it again, with no line and the start free',
        async (code) => {
            let bots = roster;
            let refuse = true;
            const served = serve({
                bots: () => bots,
                start: () => {
                    if (!refuse) return new Response(JSON.stringify(snapshot), { status: 201 });
                    refuse = false;
                    bots = roster.filter((entry) => entry.name !== `devbot-c`);
                    return refused(400, code)(undefined);
                },
            });
            vi.useFakeTimers({ toFake: [`setInterval`, `clearInterval`] });
            render(<PlayScreen />);
            await ready();
            fireEvent.click(screen.getByRole(`button`, { name: `Start game` }), { detail: 1 });
            const read = async () => {
                await act(async () => {
                    vi.advanceTimersByTime(15_000);
                    await Promise.resolve();
                });
            };
            await waitFor(() => {
                expect(title()).toBe(`Play quietlake`);
            });
            await read();
            expect(title()).toBe(`Play quietlake`);
            expect(screen.getByRole(`button`, { name: `Start game` }).getAttribute(`aria-disabled`)).toBe(`true`);
            bots = roster;
            await read();
            await read();
            await waitFor(() => {
                expect(title()).toBe(`Play devbot-c`);
            });
            expect(document.querySelectorAll(`.start-lines .field-error`)).toHaveLength(0);
            const start = screen.getByRole(`button`, { name: `Start game` });
            expect(start.getAttribute(`aria-disabled`)).toBe(null);
            fireEvent.click(start, { detail: 0 });
            await waitFor(() => {
                expect(window.location.pathname).toBe(`/game/g1`);
            });
            expect(served.posts.at(-1)?.body).toMatchObject({ bot: `devbot-c` });
        },
    );

    it('say that an unlimited game ends with no winner while Unlimited is picked', async () => {
        serve();
        render(<PlayScreen />);
        await ready();
        expect(screen.queryByText(/end with no winner/u)).toBe(null);
        const unlimited = screen.getByRole(`radio`, { name: `Unlimited` });
        fireEvent.click(unlimited);
        const note = screen.getByText(`Unlimited games end with no winner after 24 hours.`);
        expect(unlimited.getAttribute(`aria-describedby`)).toBe(note.id);
    });

    it('go back to the last clock started when leaving a clock set by hand, and keep a stepper focusable at its end', async () => {
        window.localStorage.setItem(playStorageKey, JSON.stringify({ opponent: `devbot-c`, clock: `t20` }));
        serve();
        render(<PlayScreen />);
        await ready();
        fireEvent.click(screen.getByRole(`button`, { name: `Custom clock` }));
        // The swap puts focus on the picked mode, above the controls it revealed.
        expect(document.activeElement?.textContent).toBe(`Turn`);
        fireEvent.click(screen.getByRole(`button`, { name: `Increase Turn clock` }));
        expect(screen.getByRole(`spinbutton`, { name: `Turn clock` }).getAttribute(`aria-valuenow`)).toBe(`25`);
        fireEvent.click(screen.getByRole(`button`, { name: `Presets` }));
        expect(screen.getByRole(`radio`, { name: `Turn clock, 20 seconds` })).toHaveProperty(`checked`, true);
        fireEvent.click(screen.getByRole(`button`, { name: `Custom clock` }));
        fireEvent.click(screen.getByRole(`button`, { name: `Match` }));
        const more = screen.getByRole(`button`, { name: `Increase Increment` });
        for (let press = 0; press < 30; press += 1) fireEvent.click(more);
        expect(screen.getByRole(`spinbutton`, { name: `Increment` }).getAttribute(`aria-valuenow`)).toBe(`30`);
        expect(more.hasAttribute(`disabled`)).toBe(false);
        expect(more.getAttribute(`aria-disabled`)).toBe(`true`);
        fireEvent.click(more);
        expect(screen.getByRole(`spinbutton`, { name: `Increment` }).getAttribute(`aria-valuenow`)).toBe(`30`);
    });

    it('read the bot list again every 15 seconds while the page is in view', async () => {
        vi.useFakeTimers({ toFake: [`setInterval`, `clearInterval`] });
        const served = serve();
        render(<PlayScreen />);
        await ready();
        const reads = served.listReads;
        await act(async () => {
            vi.advanceTimersByTime(15_000);
            await Promise.resolve();
        });
        expect(served.listReads).toBe(reads + 1);
    });

    it('say when no bot is ready, and when there are no bots at all', async () => {
        serve({ bots: roster.map((entry) => ({ ...entry, openForChallenges: false })) });
        render(<PlayScreen />);
        expect(await screen.findByRole(`heading`, { name: `No bots ready right now` })).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Browse bots` }).getAttribute(`href`)).toBe(`/bots`);
        expect(screen.getByRole(`link`, { name: `Build a bot` }).getAttribute(`href`)).toBe(`/connect`);
        cleanup();
        serve({ bots: [] });
        render(<PlayScreen />);
        expect(await screen.findByRole(`heading`, { name: `No bots yet` })).toBeTruthy();
    });

    it('offer a retry when the bot list does not load', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) => Promise.resolve(url === `/api/me` ? new Response(JSON.stringify(tom)) : new Response(`{}`, { status: 500 }))),
        );
        meStore.reset();
        meStore.start();
        render(<PlayScreen />);
        expect(await screen.findByRole(`heading`, { name: `The bot list did not load` })).toBeTruthy();
    });

    it('hold the retry of a rate-limited bot list for its wait', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) =>
                Promise.resolve(
                    url === `/api/me`
                        ? new Response(JSON.stringify(tom))
                        : new Response(JSON.stringify({ error: `slow down`, code: `rate_limited` }), { status: 429, headers: { 'retry-after': `7` } }),
                ),
            ),
        );
        meStore.reset();
        meStore.start();
        render(<PlayScreen />);
        expect(await screen.findByRole(`heading`, { name: `The bot list did not load` })).toBeTruthy();
        await waitFor(() => {
            expect(document.querySelector(`.empty .sr-only`)?.textContent).toBe(`Too many tries; try again in 7 s`);
        });
        expect(screen.getByRole(`button`, { name: `Try again` }).getAttribute(`aria-disabled`)).toBe(`true`);
    });

    it('say so when the picked bot leaves the list, and fall back to another', async () => {
        let bots = roster;
        serve({ bots: () => bots });
        vi.useFakeTimers({ toFake: [`setInterval`, `clearInterval`] });
        render(<PlayScreen />);
        await ready();
        fireEvent.click(screen.getByRole(`radio`, { name: /^hextide/u }));
        bots = roster.filter((entry) => entry.name !== `hextide`);
        await act(async () => {
            vi.advanceTimersByTime(15_000);
            await Promise.resolve();
        });
        expect(await screen.findByText(`hextide is no longer listed; pick another bot`)).toBeTruthy();
        expect(title()).toBe(`Play devbot-c`);
    });
});
