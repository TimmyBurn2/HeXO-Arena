// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BotListing, Me, TournamentDetail, TournamentGame, TournamentList, TournamentSummary } from '@hexo-arena/contract';
import { meStore } from '../src/me';
import { TournamentScreen } from '../src/screens/TournamentScreen';
import { TournamentsScreen } from '../src/screens/TournamentsScreen';
import { NewTournament } from '../src/tournaments/NewTournament';
import { emptyTournamentSetup } from '../src/tournaments/setup';
import { pressAsReadLands } from './press-as-read-lands';

const wide = { turnMs: [5_000, 60_000] as [number, number], match: true, unlimited: true };

function listing(name: string, ownerName: string, overrides: Partial<BotListing> = {}): BotListing {
    return { name, ownerName, online: true, openForChallenges: true, rating: 1500, provisional: false, liveGames: 0, levels: null, analyzer: null, accepts: wide, version: `1.0.0`, ...overrides };
}

const ana: Me = { kind: `user`, name: `ana`, rating: 1402, provisional: false, discord: null, liveGames: [], analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } };
const bruno: Me = { ...ana, name: `bruno` };

const roster = [listing(`hextide`, `ana`), listing(`cinder`, `ana`), listing(`pebble`, `ana`), listing(`Pistol1`, `bruno`), listing(`quietlake`, `dmitri`), listing(`devbot-a`, `devowner-a`)];
const reads = (viewer: string | null) => ({ viewer, states: [], reserved: new Set<string>() });

// A body to answer with, or a status and the body it carries.
type Answer = unknown;

// Each call answers by its method and path; any other answers not found. Every call is kept.
function serve(answers: Record<string, Answer>, me: Me = null): { method: string; url: string; body: unknown }[] {
    const calls: { method: string; url: string; body: unknown }[] = [];
    vi.stubGlobal(
        `fetch`,
        vi.fn((url: string, init?: RequestInit) => {
            const method = init?.method ?? `GET`;
            calls.push({ method, url, body: typeof init?.body === `string` ? JSON.parse(init.body) : null });
            const answer = url === `/api/me` ? me : answers[`${method} ${url}`];
            if (answer === undefined) return Promise.resolve(new Response(JSON.stringify({ error: `no`, code: `not_found` }), { status: 404 }));
            if (typeof answer === `object` && answer !== null && `status` in answer && `body` in answer) {
                return Promise.resolve(new Response(JSON.stringify(answer.body), { status: Number(answer.status) }));
            }
            return Promise.resolve(new Response(JSON.stringify(answer)));
        }),
    );
    meStore.reset();
    meStore.start();
    return calls;
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    meStore.reset();
    window.localStorage.clear();
    window.history.replaceState(null, ``, `/`);
});

const keys: Readonly<Record<string, number>> = { hextide: 1, Pistol1: 2, quietlake: 3, cinder: 2, pebble: 3, 'devbot-a': 4 };
const seat = (bot: string) => ({ key: keys[bot] ?? 0, name: bot });
const g = (x: string, outcome: TournamentGame[`outcome`], point: string | null = null, gameId: string | null = null): TournamentGame => ({
    x: keys[x] ?? 0,
    gameId,
    outcome,
    point: point === null ? null : (keys[point] ?? 0),
    missing: [],
});
const played = (x: string, winner: string, id: string) => g(x, `played`, winner, id);

const live: TournamentDetail = {
    id: `t_brunorobin01`,
    name: `Round robin by bruno`,
    origin: `person`,
    format: `round_robin`,
    createdBy: `bruno`,
    rated: false,
    test: false,
    gamesPerPair: 2,
    status: `running`,
    startsAt: `2026-10-04T12:00:00Z`,
    startedAt: `2026-10-04T12:00:00Z`,
    endedAt: null,
    timeControl: { mode: `turn`, turnTimeMs: 10_000 },
    openingPlies: 5,
    maxEntrants: 4,
    entries: [
        { key: 1, bot: `hextide`, ownerName: `ana`, online: true, ratingAtStart: 2117, state: `playing` },
        { key: 2, bot: `Pistol1`, ownerName: `bruno`, online: true, ratingAtStart: null, state: `playing`, level: { id: `club`, label: `club` } },
        { key: 3, bot: `quietlake`, ownerName: `dmitri`, online: false, ratingAtStart: 1460, state: `playing` },
        { key: 4, bot: `devbot-a`, ownerName: `devowner-a`, online: true, ratingAtStart: 1498, state: `playing` },
    ],
    rounds: [
        {
            round: 1,
            pairings: [
                { first: seat(`hextide`), second: seat(`quietlake`), games: [played(`hextide`, `hextide`, `g1`), played(`quietlake`, `hextide`, `g2`)] },
                { first: seat(`Pistol1`), second: seat(`devbot-a`), games: [played(`Pistol1`, `Pistol1`, `g3`), played(`devbot-a`, `devbot-a`, `g4`)] },
            ],
            rest: null,
        },
        {
            round: 2,
            pairings: [
                { first: seat(`hextide`), second: seat(`Pistol1`), games: [g(`hextide`, `live`, null, `g5`), g(`Pistol1`, `pending`)] },
                { first: seat(`devbot-a`), second: seat(`quietlake`), games: [g(`devbot-a`, `pending`), g(`quietlake`, `pending`)] },
            ],
            rest: null,
        },
        {
            round: 3,
            pairings: [
                { first: seat(`hextide`), second: seat(`devbot-a`), games: [g(`hextide`, `pending`), g(`devbot-a`, `pending`)] },
                { first: seat(`quietlake`), second: seat(`Pistol1`), games: [g(`quietlake`, `pending`), g(`Pistol1`, `pending`)] },
            ],
            rest: null,
        },
    ],
    standings: [
        { rank: 1, key: 1, bot: `hextide`, ownerName: `ana`, points: 2, asX: 1, asO: 1, withdrawn: false },
        { rank: 2, key: 2, bot: `Pistol1`, ownerName: `bruno`, points: 1, asX: 1, asO: 0, withdrawn: false },
        { rank: 2, key: 4, bot: `devbot-a`, ownerName: `devowner-a`, points: 1, asX: 1, asO: 0, withdrawn: false },
        { rank: 4, key: 3, bot: `quietlake`, ownerName: `dmitri`, points: 0, asX: 0, asO: 0, withdrawn: false },
    ],
    live: [],
    waiting: [{ key: 3, until: new Date(Date.now() + 42_000).toISOString() }],
    nextRoundAt: null,
};

const over = (round: TournamentDetail[`rounds`][number]) => ({
    ...round,
    pairings: round.pairings.map((pairing) => ({ ...pairing, games: pairing.games.map((game, index) => (game.outcome === `played` ? game : { ...game, outcome: `played` as const, point: index === 0 ? pairing.first.key : pairing.second.key, gameId: `x${String(round.round)}${String(index)}` })) })),
});

const finished: TournamentDetail = {
    ...live,
    id: `t_brunorobin02`,
    status: `finished`,
    endedAt: `2026-10-04T13:00:00Z`,
    rounds: live.rounds.map(over),
    standings: [
        { rank: 1, key: 1, bot: `hextide`, ownerName: `ana`, points: 5, asX: 3, asO: 2, withdrawn: false },
        { rank: 2, key: 2, bot: `Pistol1`, ownerName: `bruno`, points: 3, asX: 2, asO: 1, withdrawn: false },
        { rank: 3, key: 4, bot: `devbot-a`, ownerName: `devowner-a`, points: 2, asX: 2, asO: 0, withdrawn: false },
        { rank: 4, key: 3, bot: `quietlake`, ownerName: `dmitri`, points: 2, asX: 1, asO: 1, withdrawn: true },
    ],
    waiting: [],
};

const estimate = (games: number, first: number, rating: number, chance: number, verdict: `stronger` | `likely_stronger` | `too_close`) => ({
    games,
    points: { first, second: games - first },
    rating,
    low: rating - 150,
    high: rating + 150,
    chance,
    favored: rating > 0 ? (`first` as const) : rating < 0 ? (`second` as const) : null,
    verdict,
    narrowed: 100,
});

const test: TournamentDetail = {
    ...live,
    id: `t_anatest00001`,
    name: `Round robin by ana`,
    createdBy: `ana`,
    test: true,
    gamesPerPair: 4,
    status: `finished`,
    endedAt: `2026-10-04T13:00:00Z`,
    maxEntrants: 3,
    entries: [
        { key: 1, bot: `hextide`, ownerName: `ana`, online: true, ratingAtStart: 2117, state: `playing`, version: `1.4.0` },
        { key: 2, bot: `cinder`, ownerName: `ana`, online: true, ratingAtStart: 1500, state: `playing`, version: `0.9.2` },
        { key: 3, bot: `pebble`, ownerName: `ana`, online: true, ratingAtStart: 1182, state: `playing`, version: `0.3.1` },
    ],
    rounds: [
        { round: 1, pairings: [{ first: seat(`pebble`), second: seat(`cinder`), games: [played(`pebble`, `cinder`, `a1`), played(`cinder`, `cinder`, `a2`), played(`pebble`, `pebble`, `a3`), played(`cinder`, `cinder`, `a4`)] }], rest: seat(`hextide`) },
        { round: 2, pairings: [{ first: seat(`pebble`), second: seat(`hextide`), games: [played(`pebble`, `hextide`, `b1`), played(`hextide`, `hextide`, `b2`), played(`pebble`, `hextide`, `b3`), played(`hextide`, `hextide`, `b4`)] }], rest: seat(`cinder`) },
        { round: 3, pairings: [{ first: seat(`hextide`), second: seat(`cinder`), games: [played(`hextide`, `hextide`, `c1`), played(`cinder`, `cinder`, `c2`), played(`hextide`, `hextide`, `c3`), played(`cinder`, `hextide`, `c4`)] }], rest: seat(`pebble`) },
    ],
    standings: [
        { rank: 1, key: 1, bot: `hextide`, ownerName: `ana`, points: 7, asX: 4, asO: 3, withdrawn: false },
        { rank: 2, key: 2, bot: `cinder`, ownerName: `ana`, points: 4, asX: 2, asO: 2, withdrawn: false },
        { rank: 3, key: 3, bot: `pebble`, ownerName: `ana`, points: 1, asX: 1, asO: 0, withdrawn: false },
    ],
    waiting: [],
    estimates: [
        { key: 1, estimate: estimate(8, 7, 191, 0.99, `stronger`) },
        { key: 2, estimate: estimate(8, 4, 0, 0.5, `too_close`) },
        { key: 3, estimate: estimate(8, 1, -232, 0.004, `stronger`) },
    ],
};

// Focus moves in a render's effects, which React may run a task after the render shows; under load that can outlast waitFor's default second.
const focusWait = { timeout: 5_000 };

// The page's read of a tournament, answering `detail` this time.
const beat = (detail: TournamentDetail) => ({ path: `/api/tournaments/${detail.id}`, answer: detail });

function openTournament(detail: TournamentDetail, me: Me, extra: Record<string, Answer> = {}) {
    const calls = serve({ [`GET /api/tournaments/${detail.id}`]: detail, ...extra }, me);
    window.history.replaceState(null, ``, `/tournaments/${detail.id}`);
    render(<TournamentScreen id={detail.id} />);
    return calls;
}

describe('setting a duel or round robin up', () => {
    function setup(me: Me, bots: readonly BotListing[] = roster) {
        return render(
            <NewTournament
                bots={bots}
                reads={reads(me?.kind === `user` ? me.name : null)}
                me={me}
                quota={{ live: 0, today: 1 }}
                paused={false}
                initial={emptyTournamentSetup}
                weekly={(bot) => (bot === `hextide` ? `Entered in the weekly, which starts in 2 h; it leaves this duel or round robin then.` : null)}
                onRefused={() => undefined}
            />,
        );
    }

    function pick(...names: string[]) {
        fireEvent.click(screen.getByRole(`button`, { name: `Add bots` }));
        const dialog = screen.getByRole(`dialog`, { name: `Add bots` });
        for (const name of names) fireEvent.click(within(dialog).getByRole(`button`, { name: new RegExp(`^${name}\\b`, `u`) }));
        fireEvent.click(within(dialog).getByRole(`button`, { name: /^Add \d+ bots?$/u }));
    }

    const counts = () => screen.getAllByRole(`radio`, { name: /^\d+$/u }).map((radio) => [radio.getAttribute(`value`), (radio as HTMLInputElement).disabled]);

    it('asks a signed-out reader to sign in, and offers no bots to pick', () => {
        serve({});
        setup(null);
        expect(screen.getByRole(`heading`, { name: `New duel` })).toBeTruthy();
        expect(screen.getByText(`Sign in to set up a duel or round robin; anyone can watch one.`)).toBeTruthy();
        expect(screen.queryByRole(`button`, { name: `Add bots` })).toBeNull();
    });

    it('opens on two empty plates facing each other, and at two bots plays a duel, its games one after another', () => {
        serve({}, bruno);
        setup(bruno);
        expect(screen.getByRole(`heading`, { name: `New duel` })).toBeTruthy();
        expect(screen.getByRole(`button`, { name: `Add bots, the second plate` })).toBeTruthy();
        expect(screen.getByText(/^Pick 2 to 8 bots: two play a duel, three or more a round robin\./u)).toBeTruthy();
        // The empty form says its rule once.
        expect(screen.getAllByText(/three or more/u)).toHaveLength(1);
        pick(`quietlake`, `devbot-a`);
        expect(screen.getByRole(`heading`, { name: `New duel` })).toBeTruthy();
        expect(screen.getByText(`2 bots; a third makes a round robin`)).toBeTruthy();
        expect(screen.getByText(`6 more fit; three or more play a round robin`)).toBeTruthy();
        expect(screen.getByRole(`radiogroup`, { name: `Games` })).toBeTruthy();
        expect(counts()).toEqual([`1`, `2`, `4`, `6`, `8`, `10`].map((count) => [count, false]));
        fireEvent.click(screen.getByRole(`radio`, { name: `10` }));
        expect(screen.getByText(`5 openings, each played twice with sides swapped.`)).toBeTruthy();
        expect(screen.getByText(`Duels and round robins set up here never move a rating; the weekly tournament is the rated one.`)).toBeTruthy();
        expect(screen.getByText(`10 games, one at a time. You can stop the duel, and each owner can withdraw their bot, which ends it; the live game always finishes.`)).toBeTruthy();
        expect(screen.getByText(`Your duels and round robins: 0 of 2 live; 9 of 10 left today`)).toBeTruthy();
        expect(screen.getByRole(`button`, { name: `Start duel` }).getAttribute(`aria-disabled`)).toBeNull();
        pick(`hextide`);
        expect(screen.getByRole(`heading`, { name: `New round robin` })).toBeTruthy();
        expect(screen.getByRole(`radiogroup`, { name: `Games per pair` })).toBeTruthy();
        expect(screen.getByText(`Entered in the weekly, which starts in 2 h; it leaves this duel or round robin then.`)).toBeTruthy();
    });

    it('picks several bots at once, counting the room left, and holds Start until two are in', () => {
        serve({}, bruno);
        setup(bruno);
        fireEvent.click(screen.getByRole(`button`, { name: `Add bots` }));
        const dialog = screen.getByRole(`dialog`, { name: `Add bots` });
        fireEvent.click(within(dialog).getByRole(`button`, { name: /^quietlake\b/u }));
        expect(within(dialog).getByText(`1 picked`)).toBeTruthy();
        expect(within(dialog).getByText(`7 more fit; up to 8 bots`)).toBeTruthy();
        fireEvent.click(within(dialog).getByRole(`button`, { name: `Add 1 bot` }));
        expect(screen.getByText(`Add 1 more bot; a duel takes 2.`)).toBeTruthy();
        expect(screen.getByRole(`button`, { name: `Start duel` }).getAttribute(`aria-disabled`)).toBe(`true`);
        fireEvent.click(screen.getByRole(`button`, { name: `Add bots, the second plate` }));
        expect(within(screen.getByRole(`dialog`, { name: `Add bots` })).getAllByText(`added`)).toHaveLength(1);
    });

    it('lays out the schedule, the games a pair plays, the clock, and Rated never, and sets the round robin up on Start', async () => {
        const calls = serve({ 'POST /api/tournaments': { status: 201, body: { ...live, id: `t_newrobin0001`, status: `running` } } }, bruno);
        setup(bruno);
        pick(`hextide`, `quietlake`, `devbot-a`);
        expect(screen.getByRole(`heading`, { name: `New round robin` })).toBeTruthy();
        expect(screen.getByText(/^Every pair meets once: 3 pairs in 3 rounds\./u)).toBeTruthy();
        expect(counts()).toEqual([`1`, `2`, `4`, `6`, `8`, `10`].map((count) => [count, false]));
        fireEvent.click(screen.getByRole(`radio`, { name: `4` }));
        expect(screen.getByText(`2 openings per pair, each played twice with sides swapped.`)).toBeTruthy();
        fireEvent.click(screen.getByRole(`button`, { name: `Start round robin` }));
        await waitFor(() => {
            expect(window.location.pathname).toBe(`/tournaments/t_newrobin0001`);
        });
        const sent = calls.find((call) => call.method === `POST`);
        expect(sent?.body).toEqual({ bots: [{ name: `hextide` }, { name: `quietlake` }, { name: `devbot-a` }], gamesPerPair: 4, openingPlies: 5, timeControl: { mode: `turn`, turnTimeMs: 10_000 } });
    });

    it('keeps every bot to 30 games, a count past it shown out of reach with why', () => {
        serve({}, bruno);
        setup(bruno, [...roster, listing(`ember`, `cleo`), listing(`sealbot`, `quinn`)]);
        pick(`hextide`, `quietlake`, `devbot-a`, `Pistol1`, `ember`);
        expect(counts()).toEqual([
            [`1`, false],
            [`2`, false],
            [`4`, false],
            [`6`, false],
            [`8`, true],
            [`10`, true],
        ]);
        expect(screen.getByText(`5 bots take up to 6 a pair: no bot plays more than 30 games, or 70 in a test.`)).toBeTruthy();
    });

    it('makes a test of one person\'s bots alone, up to fifty games a pair while no bot passes 70', () => {
        serve({}, ana);
        setup(ana);
        pick(`hextide`, `cinder`, `pebble`);
        expect(screen.getByRole(`heading`, { name: `New test` })).toBeTruthy();
        expect(screen.getByText(`All 3 bots are yours`)).toBeTruthy();
        expect(counts()).toEqual([...[`1`, `2`, `4`, `6`, `8`, `10`, `20`, `30`].map((count) => [count, false]), [`50`, true]]);
        expect(screen.getByRole(`button`, { name: `Start test` })).toBeTruthy();
        fireEvent.click(screen.getByRole(`button`, { name: `Remove pebble` }));
        expect(screen.getByText(`Both bots are yours`)).toBeTruthy();
        expect(counts().at(-1)).toEqual([`50`, false]);
        expect(screen.getByText(`A test never moves a rating; its result estimates which bot is stronger instead.`)).toBeTruthy();
    });

    it('keeps the games a pair picked as the field grows, as far as the bigger field takes them', () => {
        serve({}, bruno);
        setup(bruno, [...roster, listing(`ember`, `cleo`), listing(`sealbot`, `quinn`)]);
        pick(`hextide`, `quietlake`);
        fireEvent.click(screen.getByRole(`radio`, { name: `10` }));
        pick(`devbot-a`, `Pistol1`, `ember`);
        expect(screen.getByRole(`radio`, { name: `6` })).toHaveProperty(`checked`, true);
        fireEvent.click(screen.getByRole(`button`, { name: `Remove ember` }));
        expect(screen.getByRole(`radio`, { name: `10` })).toHaveProperty(`checked`, true);
    });

    it('says why the server refused, naming the bot it names, and marks its plate', async () => {
        serve({ 'POST /api/tournaments': { status: 400, body: { error: `no`, code: `duel_refused`, bot: `quietlake` } } }, bruno);
        setup(bruno);
        pick(`hextide`, `quietlake`, `devbot-a`);
        fireEvent.click(screen.getByRole(`button`, { name: `Start round robin` }));
        expect(await screen.findByText(`quietlake takes no duels or round robins set up by others now; remove it.`)).toBeTruthy();
        expect(document.querySelectorAll(`.slot-marked`)).toHaveLength(1);
        expect(document.querySelector(`.slot-marked`)?.textContent).toMatch(/^quietlake/u);
    });

    it('says the daily cap until the next UTC day, and the running cap', async () => {
        serve({ 'POST /api/tournaments': { status: 429, body: { error: `no`, code: `daily_tournament_cap` } } }, bruno);
        setup(bruno);
        pick(`hextide`, `quietlake`);
        fireEvent.click(screen.getByRole(`button`, { name: `Start duel` }));
        expect(await screen.findByText(/^You set up 10 duels and round robins today; the next can start at .+ \(00:00 UTC\)\.$/u)).toBeTruthy();
    });
});

describe('a round robin\'s page', () => {
    it('leads with the round live and who leads, the waits, the round to come, and lets an owner withdraw a bot', async () => {
        const calls = openTournament(live, ana, { 'POST /api/tournaments/t_brunorobin01/withdraw': { status: 200, body: live } });
        expect(await screen.findByText(`Round 2 of 3 is live; hextide leads with 2 points.`)).toBeTruthy();
        expect(screen.getByText(/^4 bots, picked by bruno; each pair plays one opening twice, sides swapped; turn clock 10 s; 5-stone openings; unrated\. Pistol1 plays at club\.$/u)).toBeTruthy();
        expect(screen.getByText(/^Waiting for quietlake; \d+ s left$/u)).toBeTruthy();
        expect(screen.getByRole(`heading`, { name: `Next: round 3` })).toBeTruthy();
        expect(screen.getByText(`unrated`)).toBeTruthy();
        expect(screen.queryByRole(`button`, { name: `Stop round robin` })).toBeNull();
        fireEvent.click(screen.getByRole(`button`, { name: `Withdraw hextide` }));
        expect(screen.getByText(`Withdraw hextide? Its live game plays on; its games still to come score for its opponents.`)).toBeTruthy();
        fireEvent.click(screen.getByRole(`button`, { name: `Withdraw; hextide plays no further game` }));
        await waitFor(() => {
            expect(calls.some((call) => call.method === `POST` && call.url === `/api/tournaments/t_brunorobin01/withdraw`)).toBe(true);
        });
        expect(calls.find((call) => call.method === `POST`)?.body).toEqual({ bot: `hextide` });
    });

    it('lets its creator stop it, confirmed in place, and keeps playing on a second thought, focus staying on a control that is there', async () => {
        const calls = openTournament(live, bruno, { 'POST /api/tournaments/t_brunorobin01/stop': { status: 200, body: { ...live, status: `stopped`, end: { reason: `creator`, round: 2 } } } });
        fireEvent.click(await screen.findByRole(`button`, { name: `Stop round robin` }));
        expect(screen.getByText(`Stop the round robin? No further game starts; the live games play on, and the standings stand as they are.`)).toBeTruthy();
        await waitFor(() => {
            expect(document.activeElement).toBe(screen.getByRole(`button`, { name: `Keep playing` }));
        }, focusWait);
        fireEvent.click(screen.getByRole(`button`, { name: `Keep playing` }));
        expect(screen.queryByText(/^Stop the round robin\?/u)).toBeNull();
        await waitFor(() => {
            expect(document.activeElement).toBe(screen.getByRole(`button`, { name: `Stop round robin` }));
        }, focusWait);
        fireEvent.click(screen.getByRole(`button`, { name: `Stop round robin` }));
        fireEvent.click(screen.getByRole(`button`, { name: `Stop; no further game starts` }));
        await waitFor(() => {
            expect(calls.some((call) => call.method === `POST` && call.url === `/api/tournaments/t_brunorobin01/stop`)).toBe(true);
        });
        expect(await screen.findByText(/^Stopped by bruno after round 2/u)).toBeTruthy();
        // The stopped detail lands focus in a render of its own, which may follow the one that shows it.
        await waitFor(() => {
            expect(document.activeElement).toBe(screen.getByRole(`link`, { name: `These games in Games` }));
        }, focusWait);
        expect(screen.queryByRole(`button`, { name: /^Withdraw/u })).toBeNull();
    }, 30_000);

    it('keeps focus on a control that is there when Stop and Keep playing are pressed as a read lands', async () => {
        const ahead: TournamentDetail = { ...live, standings: live.standings.map((line) => (line.bot === `hextide` ? { ...line, points: 3 } : line)) };
        openTournament(live, bruno);
        await screen.findByRole(`button`, { name: `Stop round robin` });
        await pressAsReadLands(beat(ahead), `hextide leads with 3 points`, () => screen.getByRole(`button`, { name: `Stop round robin` }));
        await waitFor(() => {
            expect(document.activeElement).toBe(screen.getByRole(`button`, { name: `Keep playing` }));
        }, focusWait);
        await pressAsReadLands(beat(live), `hextide leads with 2 points`, () => screen.getByRole(`button`, { name: `Keep playing` }));
        await waitFor(() => {
            expect(document.activeElement).toBe(screen.getByRole(`button`, { name: `Stop round robin` }));
        }, focusWait);
    }, 30_000);

    it('lands focus on the status once a change leaves no action to hold it', async () => {
        const fresh: TournamentDetail = { ...live, rounds: live.rounds.map((round) => ({ ...round, pairings: round.pairings.map((pairing) => ({ ...pairing, games: pairing.games.map((game) => ({ ...game, outcome: `pending` as const, point: null, gameId: null })) })) })) };
        openTournament(fresh, ana, { 'POST /api/tournaments/t_brunorobin01/withdraw': { status: 200, body: { ...fresh, entries: fresh.entries.map((entry) => (entry.bot === `hextide` ? { ...entry, state: `withdrawn`, reason: `owner` } : entry)) } } });
        fireEvent.click(await screen.findByRole(`button`, { name: `Withdraw hextide` }));
        await waitFor(() => {
            expect(document.activeElement).toBe(screen.getByRole(`button`, { name: `Keep playing` }));
        }, focusWait);
        fireEvent.click(screen.getByRole(`button`, { name: `Keep playing` }));
        await waitFor(() => {
            expect(document.activeElement).toBe(screen.getByRole(`button`, { name: `Withdraw hextide` }));
        }, focusWait);
        fireEvent.click(screen.getByRole(`button`, { name: `Withdraw hextide` }));
        fireEvent.click(screen.getByRole(`button`, { name: `Withdraw; hextide plays no further game` }));
        await waitFor(() => {
            expect(screen.queryByRole(`group`, { name: `Withdraw hextide` })).toBeNull();
        });
        expect(screen.queryByRole(`button`, { name: `Withdraw hextide` })).toBeNull();
        // The changed detail lands focus in a render of its own, which may follow the one that closes the confirm.
        await waitFor(() => {
            expect(document.activeElement?.id).toBe(`tournament-status`);
        }, focusWait);
    }, 30_000);

    it('gives a viewer with several bots playing one Withdraw, its confirm naming the bot chosen', async () => {
        const calls = openTournament({ ...live, entries: live.entries.map((entry) => (entry.bot === `quietlake` ? { ...entry, ownerName: `ana` } : entry)) }, ana, { 'POST /api/tournaments/t_brunorobin01/withdraw': { status: 200, body: live } });
        fireEvent.click(await screen.findByRole(`button`, { name: `Withdraw a bot` }));
        expect(screen.queryByRole(`button`, { name: `Withdraw hextide` })).toBeNull();
        expect(screen.getByText(`Withdraw hextide? Its live game plays on; its games still to come score for its opponents.`)).toBeTruthy();
        fireEvent.click(within(screen.getByRole(`group`, { name: `Which bot` })).getByRole(`button`, { name: `quietlake` }));
        expect(screen.getByText(`Withdraw quietlake? Its live game plays on; its games still to come score for its opponents.`)).toBeTruthy();
        fireEvent.click(screen.getByRole(`button`, { name: `Withdraw; quietlake plays no further game` }));
        await waitFor(() => {
            expect(calls.find((call) => call.method === `POST`)?.body).toEqual({ bot: `quietlake` });
        });
    });

    it('says the round to come starts after the gap, with its pairs', async () => {
        const [first, second, third] = live.rounds;
        if (first === undefined || second === undefined || third === undefined) throw new Error(`three rounds`);
        const between: TournamentDetail = { ...live, rounds: [first, over(second), third], waiting: [], nextRoundAt: new Date(Date.now() + 20_000).toISOString() };
        openTournament(between, null);
        expect(await screen.findByText(/^Round 3 of 3 starts in \d+ s; hextide leads with 2 points\.$/u)).toBeTruthy();
        expect(screen.getByText(`The round's pairs, about to start.`)).toBeTruthy();
        expect(screen.getByRole(`heading`, { name: `Next: round 3` })).toBeTruthy();
        expect(screen.queryByRole(`heading`, { name: `Round 3` })).toBeNull();
        expect(screen.getAllByText(`hextide vs devbot-a`)).toHaveLength(1);
    });

    it('reads round 1 live on the page the server answers a new round robin with, every round drawn and none begun', async () => {
        const pending = (round: TournamentDetail[`rounds`][number]) => ({ ...round, pairings: round.pairings.map((pairing) => ({ ...pairing, games: pairing.games.map((game) => ({ ...game, outcome: `pending` as const, point: null, gameId: null })) })) });
        const created: TournamentDetail = { ...live, id: `t_newrobin0001`, rounds: live.rounds.map(pending), standings: live.standings.map((line) => ({ ...line, rank: 1, points: 0, asX: 0, asO: 0 })), waiting: [], live: [] };
        openTournament(created, bruno);
        expect(await screen.findByText(`Round 1 of 3 is live.`)).toBeTruthy();
        expect(screen.getByRole(`list`, { name: `Round progress` }).querySelector(`[aria-label='Round 1, live']`)).not.toBeNull();
        expect(screen.getByRole(`heading`, { name: `Round 1` })).toBeTruthy();
        expect(screen.getByRole(`heading`, { name: `Next: round 2` })).toBeTruthy();
        const pair = screen.getByText(`hextide vs quietlake`).closest(`li`) as HTMLElement;
        expect(within(pair).getAllByText(`to play`)).toHaveLength(1);
    });

    it('names the winner once over, and offers anyone signed in the same round robin set up again', async () => {
        openTournament(finished, ana);
        expect(await screen.findByText(`hextide won the round robin with 5 of 6 points.`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Set up again` }).getAttribute(`href`)).toBe(`/play/tournament?bots=hextide%2CPistol1%2Cquietlake%2Cdevbot-a&level=Pistol1%3Aclub&games=2&clock=t10&opening=5`);
        expect(screen.getByText(`withdrawn`)).toBeTruthy();
    });

    it('says who stopped it and after which round, and who led then, each game never played said once a pair', async () => {
        const [first, ...rest] = live.rounds;
        if (first === undefined) throw new Error(`a first round`);
        const unplayed = rest.map((round) => ({ ...round, pairings: round.pairings.map((pairing) => ({ ...pairing, games: pairing.games.map((game) => ({ ...game, outcome: `not_played` as const, point: null, gameId: null })) })) }));
        openTournament({ ...finished, status: `stopped`, end: { reason: `creator`, round: 1 }, standings: live.standings, rounds: [over(first), ...unplayed] }, null);
        expect(await screen.findByText(`Stopped by bruno after round 1; hextide led with 2 points.`)).toBeTruthy();
        expect(screen.queryByRole(`link`, { name: `Set up again` })).toBeNull();
        expect(screen.getAllByText(`not played`)).toHaveLength(4);
    });

    it('leads a test with each bot against the others, its pairs as scores, and offers its creator another run', async () => {
        openTournament(test, ana);
        expect(await screen.findByText(`hextide scored 7 of 8 against the other two: stronger.`)).toBeTruthy();
        const estimates = screen.getByRole(`heading`, { name: `Each bot against the other two` }).closest(`section`) as HTMLElement;
        expect(within(estimates).getByText(`+191`)).toBeTruthy();
        expect(within(estimates).getByText(`weaker`)).toBeTruthy();
        expect(within(estimates).getByText(`too close to call`)).toBeTruthy();
        expect(screen.getByRole(`heading`, { name: `Pairs` })).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `hextide against cinder: 3-1` }).getAttribute(`href`)).toBe(`/games?event=tournament&tournament=t_anatest00001&round=3`);
        expect(screen.getAllByText(`4 games, 2 openings`)).toHaveLength(3);
        expect(screen.getByRole(`button`, { name: `Run 12 more` })).toBeTruthy();
        expect(screen.queryByRole(`heading`, { name: `Crosstable` })).toBeNull();
        expect(within(estimates).getByText(`under 1%`)).toBeTruthy();
        expect(within(estimates).queryByText(/Another \d+ games/u)).toBeNull();
    });

    it('gives a live test\'s creator Stop test alone, never a Withdraw for each bot', async () => {
        openTournament({ ...test, status: `running`, endedAt: null }, ana);
        expect(await screen.findByRole(`button`, { name: `Stop test` })).toBeTruthy();
        expect(screen.queryByRole(`button`, { name: /^Withdraw/u })).toBeNull();
    });
});

// bruno's duel of hextide and Pistol1, six games, hextide ahead 2-1 with game 4 live; the first named stands first.
const duelGame = (x: string, outcome: TournamentGame[`outcome`], point: string | null, id: string | null, index: number): TournamentGame => ({
    ...g(x, outcome, point, id),
    reason: outcome === `played` ? `six-in-a-row` : null,
    turns: outcome === `played` ? 28 + index : null,
    opening: outcome === `pending` ? null : [{ x: 0, y: 0, side: `x` }, { x: 1, y: -1, side: `o` }, { x: -1, y: 1, side: `o` }],
});
const duel: TournamentDetail = {
    ...live,
    id: `t_brunoduel001`,
    name: `Duel by bruno`,
    format: `duel`,
    gamesPerPair: 6,
    maxEntrants: 2,
    entries: [
        { key: 1, bot: `hextide`, ownerName: `ana`, online: true, ratingAtStart: 2117, state: `playing`, now: { rating: 2120, provisional: false } },
        { key: 2, bot: `Pistol1`, ownerName: `bruno`, online: true, ratingAtStart: 1600, state: `playing`, now: { rating: 1601, provisional: false } },
    ],
    rounds: [
        {
            round: 1,
            pairings: [
                {
                    first: seat(`hextide`),
                    second: seat(`Pistol1`),
                    games: [
                        duelGame(`hextide`, `played`, `hextide`, `d1`, 0),
                        duelGame(`Pistol1`, `played`, `Pistol1`, `d2`, 1),
                        duelGame(`hextide`, `played`, `hextide`, `d3`, 2),
                        duelGame(`Pistol1`, `live`, null, `d4`, 3),
                        duelGame(`hextide`, `pending`, null, null, 4),
                        duelGame(`Pistol1`, `pending`, null, null, 5),
                    ],
                },
            ],
            rest: null,
        },
    ],
    standings: [
        { rank: 1, key: 1, bot: `hextide`, ownerName: `ana`, points: 2, asX: 2, asO: 0, withdrawn: false },
        { rank: 2, key: 2, bot: `Pistol1`, ownerName: `bruno`, points: 1, asX: 1, asO: 0, withdrawn: false },
    ],
    live: [],
    waiting: [],
};

describe('a duel, a tournament of two', () => {
    it('faces its bots across the score, says the game live and who leads, and groups its games by opening', async () => {
        openTournament(duel, null);
        expect(await screen.findByText(`Game 4 of 6 is live; hextide leads 2-1.`)).toBeTruthy();
        expect(screen.getByRole(`heading`, { name: `hextide vs Pistol1`, level: 1 })).toBeTruthy();
        expect(screen.getByRole(`img`, { name: `2 to 1, game 4 of 6` })).toBeTruthy();
        expect(document.querySelector(`.duel-kicker`)?.textContent).toContain(`Duel`);
        expect(screen.getByText(/^6 games: 3 openings, each played twice with sides swapped; turn clock 10 s; 5-stone openings; never rated\. Set up by bruno\.$/u)).toBeTruthy();
        expect(screen.getByRole(`heading`, { name: `Opening 1` })).toBeTruthy();
        expect(screen.getByRole(`columnheader`, { name: `Opening 2` })).toBeTruthy();
        expect(screen.getAllByText(`hextide won with six in a row`)).toHaveLength(2);
        expect(screen.queryByRole(`heading`, { name: `Standings` })).toBeNull();
    });

    it('gives its creator Stop duel alone, though a bot in it is theirs too', async () => {
        openTournament(duel, bruno);
        expect(await screen.findByRole(`button`, { name: `Stop duel` })).toBeTruthy();
        expect(screen.queryByRole(`button`, { name: /^Withdraw/u })).toBeNull();
    });

    it('lets the owner of a bot in it, who did not set it up, withdraw the bot, which ends it', async () => {
        const calls = openTournament(duel, ana, {
            'POST /api/tournaments/t_brunoduel001/withdraw': {
                status: 200,
                body: { ...duel, status: `cut_short`, endedAt: `2026-10-04T13:00:00Z`, end: { reason: `owner`, round: 1, bot: { key: 1, name: `hextide` } } },
            },
        });
        fireEvent.click(await screen.findByRole(`button`, { name: `Withdraw hextide` }));
        expect(screen.queryByRole(`button`, { name: `Stop duel` })).toBeNull();
        expect(screen.getByText(`Withdraw hextide? The duel ends: its live game plays on and counts, and no further game starts.`)).toBeTruthy();
        fireEvent.click(screen.getByRole(`button`, { name: `Withdraw; the duel ends` }));
        expect(await screen.findByText(`Cut short at 2-1: hextide's owner withdrew it.`)).toBeTruthy();
        expect(calls.find((call) => call.method === `POST`)?.body).toEqual({ bot: `hextide` });
        expect(screen.getByRole(`link`, { name: `Duel again` }).getAttribute(`href`)).toBe(`/play/tournament?bots=hextide%2CPistol1&games=6&clock=t10&opening=5`);
    });

    it('keeps focus on a control that is there when Withdraw and Keep playing are pressed as a read lands', async () => {
        const later: TournamentDetail = { ...duel, rounds: duel.rounds.map((round) => ({ ...round, pairings: round.pairings.map((pairing) => ({ ...pairing, games: pairing.games.map((game, index) => (index === 3 ? duelGame(`Pistol1`, `played`, `Pistol1`, `d4`, 3) : index === 4 ? duelGame(`hextide`, `live`, null, `d5`, 4) : game)) })) })) };
        openTournament(duel, ana);
        await screen.findByRole(`button`, { name: `Withdraw hextide` });
        await pressAsReadLands(beat(later), `Game 5 of 6 is live`, () => screen.getByRole(`button`, { name: `Withdraw hextide` }));
        await waitFor(() => {
            expect(document.activeElement).toBe(screen.getByRole(`button`, { name: `Keep playing` }));
        }, focusWait);
        await pressAsReadLands(beat(duel), `Game 4 of 6 is live`, () => screen.getByRole(`button`, { name: `Keep playing` }));
        await waitFor(() => {
            expect(document.activeElement).toBe(screen.getByRole(`button`, { name: `Withdraw hextide` }));
        }, focusWait);
    }, 30_000);

    it('marks a no-show, which scores for the bot that came', async () => {
        const [round] = duel.rounds;
        const pairing = round?.pairings[0];
        if (round === undefined || pairing === undefined) throw new Error(`a duel's pairing`);
        const missed = { ...pairing, games: pairing.games.map((game, index) => (index === 3 ? { ...game, outcome: `no_show` as const, point: 1, missing: [2], gameId: null, opening: null } : game)) };
        openTournament({ ...duel, rounds: [{ ...round, pairings: [missed] }] }, null);
        expect(await screen.findByText(`No-show: Pistol1 did not come; hextide scores`)).toBeTruthy();
    });
});

describe('the tournaments under Games', () => {
    const summaryOf = (detail: TournamentDetail): TournamentSummary => {
        const { entries: _entries, rounds: _rounds, standings: _standings, live: _live, waiting: _waiting, nextRoundAt: _next, estimates: _estimates, startedAt: _started, end: _end, endedAt, ...fields } = detail;
        return { ...fields, ...(endedAt === null ? {} : { endedAt }), entrants: detail.standings.length, winner: null, round: detail.status === `running` ? { current: 2, of: 3 } : null };
    };
    const every: TournamentList = { running: [summaryOf(live)], scheduled: [], past: [summaryOf(finished), summaryOf(test)] };
    const lead = test.estimates?.[0]?.estimate;
    if (lead === undefined) throw new Error(`a test with an estimate`);

    it('lists a test over by its verdict, a stopped one by the round it stopped after, and one the reader set up as theirs', async () => {
        const stopped = { ...summaryOf({ ...finished, id: `t_brunorobin03`, status: `stopped` }), end: { reason: `creator` as const, round: 2 } };
        const tests = { running: [], scheduled: [], past: [{ ...summaryOf(test), lead: { bot: `hextide`, estimate: lead } }] };
        serve({ 'GET /api/tournaments?mine=1': { running: [summaryOf(live)], scheduled: [], past: [stopped] }, 'GET /api/tournaments?kind=test': tests }, bruno);
        window.history.replaceState(null, ``, `/games/tournaments?list=yours`);
        render(<TournamentsScreen />);
        expect(await screen.findByText(`stopped by bruno after round 2`)).toBeTruthy();
        expect(screen.getAllByText(`Yours: set up by you`)).toHaveLength(2);
        fireEvent.click(screen.getByRole(`button`, { name: `Tests` }));
        expect(await screen.findByText(`hextide about +191, stronger`)).toBeTruthy();
    });

    it('lists every duel and round robin but tests, tagged, with a way to set one up, and tests alone under Tests', async () => {
        serve({ 'GET /api/tournaments': every, 'GET /api/tournaments?kind=test': { running: [], scheduled: [], past: [summaryOf(test)] } });
        window.history.replaceState(null, ``, `/games/tournaments`);
        render(<TournamentsScreen />);
        expect((await screen.findAllByText(`Round robin by bruno`, { selector: `.event-row-name` })).length).toBe(2);
        expect(screen.queryByText(`Round robin by ana`, { selector: `.event-row-name` })).toBeNull();
        expect(screen.getAllByText(`unrated`)).toHaveLength(2);
        expect(screen.getByRole(`link`, { name: `New duel or round robin` }).getAttribute(`href`)).toBe(`/play/tournament`);
        expect(screen.getByText(`Tests, where one person owns every bot, are listed under Tests.`)).toBeTruthy();
        fireEvent.click(screen.getByRole(`button`, { name: `Tests` }));
        expect(await screen.findByText(`Round robin by ana`, { selector: `.event-row-name` })).toBeTruthy();
        expect(screen.getByText(`No duel or round robin is live right now.`)).toBeTruthy();
        expect(window.location.search).toBe(`?list=tests`);
    });

    it('asks a signed-out reader to sign in for their own', async () => {
        serve({ 'GET /api/tournaments': every });
        window.history.replaceState(null, ``, `/games/tournaments?list=yours`);
        render(<TournamentsScreen />);
        expect(await screen.findByText(`Sign in to see the duels and round robins you set up and your bots' tournaments.`)).toBeTruthy();
        expect(screen.queryByRole(`heading`, { name: `Past` })).toBeNull();
    });
});
