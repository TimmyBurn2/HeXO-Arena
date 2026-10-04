// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BotListing, Me, TournamentDetail, TournamentGame, TournamentList, TournamentSummary } from '@hexo-arena/contract';
import { meStore } from '../src/me';
import { TournamentScreen } from '../src/screens/TournamentScreen';
import { TournamentsScreen } from '../src/screens/TournamentsScreen';
import { NewRoundRobin } from '../src/tournaments/NewRoundRobin';
import { emptyRoundRobin } from '../src/tournaments/round-robin';

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

function openTournament(detail: TournamentDetail, me: Me, extra: Record<string, Answer> = {}) {
    const calls = serve({ [`GET /api/tournaments/${detail.id}`]: detail, ...extra }, me);
    window.history.replaceState(null, ``, `/tournaments/${detail.id}`);
    render(<TournamentScreen id={detail.id} />);
    return calls;
}

describe('setting a round robin up', () => {
    function setup(me: Me, bots: readonly BotListing[] = roster) {
        return render(<NewRoundRobin bots={bots} reads={reads(me?.kind === `user` ? me.name : null)} me={me} quota={{ live: 0, today: 0 }} paused={false} initial={emptyRoundRobin} weekly={(bot) => (bot === `hextide` ? `Entered in the weekly, which starts in 2 h; it leaves this round robin then.` : null)} onRefused={() => undefined} />);
    }

    function pick(...names: string[]) {
        fireEvent.click(screen.getByRole(`button`, { name: `Add bots to the round robin` }));
        const dialog = screen.getByRole(`dialog`, { name: `Add bots` });
        for (const name of names) fireEvent.click(within(dialog).getByRole(`button`, { name: new RegExp(`^${name}\\b`, `u`) }));
        fireEvent.click(within(dialog).getByRole(`button`, { name: /^Add \d+ bots?$/u }));
    }

    it('asks a signed-out reader to sign in, and offers no bots to pick', () => {
        serve({});
        setup(null);
        expect(screen.getByText(`Sign in to set up a round robin; anyone can watch one.`)).toBeTruthy();
        expect(screen.queryByRole(`button`, { name: `Add bots to the round robin` })).toBeNull();
    });

    it('picks several bots at once, counting the room left, and holds Start until three are in', () => {
        serve({}, bruno);
        setup(bruno);
        fireEvent.click(screen.getByRole(`button`, { name: `Add bots to the round robin` }));
        const dialog = screen.getByRole(`dialog`, { name: `Add bots` });
        fireEvent.click(within(dialog).getByRole(`button`, { name: /^quietlake\b/u }));
        fireEvent.click(within(dialog).getByRole(`button`, { name: /^devbot-a\b/u }));
        expect(within(dialog).getByText(`2 picked`)).toBeTruthy();
        expect(within(dialog).getByText(`6 more fit; a round robin takes 3 to 8`)).toBeTruthy();
        fireEvent.click(within(dialog).getByRole(`button`, { name: `Add 2 bots` }));
        expect(screen.getByText(`Add 1 more bot; a round robin needs 3.`)).toBeTruthy();
        expect(screen.getByRole(`button`, { name: `Start round robin` }).getAttribute(`aria-disabled`)).toBe(`true`);
        fireEvent.click(screen.getByRole(`button`, { name: `Add bots to the round robin` }));
        expect(within(screen.getByRole(`dialog`, { name: `Add bots` })).getAllByText(`added`)).toHaveLength(2);
    });

    it('lays out the schedule, the games a pair plays, the clock, and Rated never, and sets the round robin up on Start', async () => {
        const calls = serve({ 'POST /api/tournaments': { status: 201, body: { ...live, id: `t_newrobin0001`, status: `running` } } }, bruno);
        setup(bruno);
        pick(`hextide`, `quietlake`, `devbot-a`);
        expect(screen.getByRole(`heading`, { name: `New round robin` })).toBeTruthy();
        expect(screen.getByText(/^Every pair meets once: 3 pairs in 3 rounds\./u)).toBeTruthy();
        expect(screen.getByText(`A round robin set up here never moves a rating; the weekly tournament is the rated one.`)).toBeTruthy();
        expect(screen.getByText(`Entered in the weekly, which starts in 2 h; it leaves this round robin then.`)).toBeTruthy();
        expect(screen.getAllByRole(`radio`, { name: /^\d+$/u }).map((radio) => radio.getAttribute(`value`))).toEqual([`2`, `4`]);
        fireEvent.click(screen.getByRole(`radio`, { name: `4` }));
        expect(screen.getByText(`2 openings per pair, each played twice with sides swapped.`)).toBeTruthy();
        fireEvent.click(screen.getByRole(`button`, { name: `Start round robin` }));
        await waitFor(() => {
            expect(window.location.pathname).toBe(`/tournaments/t_newrobin0001`);
        });
        const sent = calls.find((call) => call.method === `POST`);
        expect(sent?.body).toEqual({ bots: [{ name: `hextide` }, { name: `quietlake` }, { name: `devbot-a` }], gamesPerPair: 4, openingPlies: 5, timeControl: { mode: `turn`, turnTimeMs: 10_000 } });
    });

    it('makes a test of one person\'s bots alone, up to ten games a pair', () => {
        serve({}, ana);
        setup(ana);
        pick(`hextide`, `cinder`, `pebble`);
        expect(screen.getByRole(`heading`, { name: `New test` })).toBeTruthy();
        expect(screen.getByText(`All 3 bots are yours`)).toBeTruthy();
        expect(screen.getAllByRole(`radio`, { name: /^\d+$/u }).map((radio) => radio.getAttribute(`value`))).toEqual([`2`, `4`, `6`, `10`]);
        expect(screen.getByRole(`button`, { name: `Start test` })).toBeTruthy();
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

    it('says the daily cap until the next UTC day', async () => {
        serve({ 'POST /api/tournaments': { status: 429, body: { error: `no`, code: `daily_round_robin_cap` } } }, bruno);
        setup(bruno);
        pick(`hextide`, `quietlake`, `devbot-a`);
        fireEvent.click(screen.getByRole(`button`, { name: `Start round robin` }));
        expect(await screen.findByText(/^You set up 3 round robins today; the next can start at .+ \(00:00 UTC\)\.$/u)).toBeTruthy();
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
        expect(document.activeElement).toBe(screen.getByRole(`button`, { name: `Keep playing` }));
        fireEvent.click(screen.getByRole(`button`, { name: `Keep playing` }));
        expect(screen.queryByText(/^Stop the round robin\?/u)).toBeNull();
        expect(document.activeElement).toBe(screen.getByRole(`button`, { name: `Stop round robin` }));
        fireEvent.click(screen.getByRole(`button`, { name: `Stop round robin` }));
        fireEvent.click(screen.getByRole(`button`, { name: `Stop; no further game starts` }));
        await waitFor(() => {
            expect(calls.some((call) => call.method === `POST` && call.url === `/api/tournaments/t_brunorobin01/stop`)).toBe(true);
        });
        expect(await screen.findByText(/^Stopped by bruno after round 2/u)).toBeTruthy();
        expect(document.activeElement).toBe(screen.getByRole(`link`, { name: `These games in Games` }));
        expect(screen.queryByRole(`button`, { name: /^Withdraw/u })).toBeNull();
    });

    it('lands focus on the status once a change leaves no action to hold it', async () => {
        const fresh: TournamentDetail = { ...live, rounds: live.rounds.map((round) => ({ ...round, pairings: round.pairings.map((pairing) => ({ ...pairing, games: pairing.games.map((game) => ({ ...game, outcome: `pending` as const, point: null, gameId: null })) })) })) };
        openTournament(fresh, ana, { 'POST /api/tournaments/t_brunorobin01/withdraw': { status: 200, body: { ...fresh, entries: fresh.entries.map((entry) => (entry.bot === `hextide` ? { ...entry, state: `withdrawn`, reason: `owner` } : entry)) } } });
        fireEvent.click(await screen.findByRole(`button`, { name: `Withdraw hextide` }));
        expect(document.activeElement).toBe(screen.getByRole(`button`, { name: `Keep playing` }));
        fireEvent.click(screen.getByRole(`button`, { name: `Keep playing` }));
        expect(document.activeElement).toBe(screen.getByRole(`button`, { name: `Withdraw hextide` }));
        fireEvent.click(screen.getByRole(`button`, { name: `Withdraw hextide` }));
        fireEvent.click(screen.getByRole(`button`, { name: `Withdraw; hextide plays no further game` }));
        await waitFor(() => {
            expect(screen.queryByRole(`group`, { name: `Withdraw hextide` })).toBeNull();
        });
        expect(screen.queryByRole(`button`, { name: `Withdraw hextide` })).toBeNull();
        // The changed detail lands focus in a render of its own, which may follow the one that closes the confirm.
        await waitFor(() => {
            expect(document.activeElement?.id).toBe(`tournament-status`);
        });
    });

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
        expect(await screen.findByText(/; stopped by bruno after round 2$/u)).toBeTruthy();
        expect(screen.getAllByText(`Yours: set up by you`)).toHaveLength(2);
        fireEvent.click(screen.getByRole(`button`, { name: `Tests` }));
        expect(await screen.findByText(/; hextide \+191, stronger$/u)).toBeTruthy();
    });

    it('lists every round robin but tests, tagged, with a way to set one up, and tests alone under Tests', async () => {
        serve({ 'GET /api/tournaments': every, 'GET /api/tournaments?kind=test': { running: [], scheduled: [], past: [summaryOf(test)] } });
        window.history.replaceState(null, ``, `/games/tournaments`);
        render(<TournamentsScreen />);
        expect((await screen.findAllByRole(`link`, { name: `Round robin by bruno` })).length).toBe(2);
        expect(screen.queryByRole(`link`, { name: `Round robin by ana` })).toBeNull();
        expect(screen.getAllByText(`unrated`)).toHaveLength(2);
        expect(screen.getByRole(`link`, { name: `Set up a round robin` }).getAttribute(`href`)).toBe(`/play/tournament`);
        expect(screen.getByText(`Tests, round robins where one person owns every bot, are listed under Tests.`)).toBeTruthy();
        fireEvent.click(screen.getByRole(`button`, { name: `Tests` }));
        expect(await screen.findByRole(`link`, { name: `Round robin by ana` })).toBeTruthy();
        expect(screen.getByText(`No round robin is live right now.`)).toBeTruthy();
        expect(window.location.search).toBe(`?list=tests`);
    });

    it('asks a signed-out reader to sign in for their own', async () => {
        serve({ 'GET /api/tournaments': every });
        window.history.replaceState(null, ``, `/games/tournaments?list=yours`);
        render(<TournamentsScreen />);
        expect(await screen.findByText(`Sign in to see your round robins and your bots' tournaments.`)).toBeTruthy();
        expect(screen.queryByRole(`heading`, { name: `Past` })).toBeNull();
    });
});
