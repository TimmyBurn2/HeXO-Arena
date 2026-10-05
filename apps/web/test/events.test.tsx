// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BotListing, Me, TournamentDetail, TournamentList, TournamentPair, TournamentSummary } from '@hexo-arena/contract';
import { TournamentBlock } from '../src/home/blocks';
import { meStore } from '../src/me';
import { PlayTournamentScreen } from '../src/screens/PlayTournamentScreen';
import { TournamentsScreen } from '../src/screens/TournamentsScreen';

const hour = 3_600_000;
function summary(id: string, overrides: Partial<TournamentSummary>): TournamentSummary {
    return {
        id,
        name: `Autumn round robin`,
        origin: `operator`,
        format: `round_robin`,
        createdBy: null,
        rated: true,
        test: false,
        gamesPerPair: 2,
        status: `finished`,
        startsAt: new Date(Date.now() - 48 * hour).toISOString().replace(/\.\d{3}Z$/u, `Z`),
        timeControl: { mode: `turn`, turnTimeMs: 10_000 },
        openingPlies: 5,
        entrants: 4,
        maxEntrants: 12,
        winner: null,
        round: null,
        ...overrides,
    };
}

// A duel of sealbot against hextide: game 1 sealbot's, game 2 live.
const pair: TournamentPair = {
    first: { key: 1, name: `sealbot`, points: 1 },
    second: { key: 2, name: `hextide`, points: 0 },
    games: [
        { x: 1, gameId: `g-1`, outcome: `played`, point: 1, missing: [] },
        { x: 2, gameId: `g-2`, outcome: `live`, point: null, missing: [] },
    ],
};

function duel(id: string, overrides: Partial<TournamentSummary> = {}): TournamentSummary {
    return summary(id, { name: `Duel by bruno`, origin: `person`, format: `duel`, createdBy: `bruno`, rated: false, status: `running`, entrants: 2, maxEntrants: 2, round: { current: 1, of: 1 }, pair, ...overrides });
}

const later = new Date(Date.now() + 3 * hour + 30_000).toISOString().replace(/\.\d{3}Z$/u, `Z`);

const waiting: TournamentDetail = {
    id: `t_wintercup202`,
    name: `Winter cup`,
    origin: `operator`,
    format: `round_robin`,
    createdBy: null,
    rated: true,
    test: false,
    gamesPerPair: 2,
    status: `scheduled`,
    startsAt: later,
    startedAt: null,
    waiting: [],
    nextRoundAt: null,
    endedAt: null,
    timeControl: { mode: `turn`, turnTimeMs: 10_000 },
    openingPlies: 5,
    maxEntrants: 12,
    entries: [{ key: 1, bot: `hextide`, ownerName: `ana`, online: true, ratingAtStart: null, state: `entered` }],
    rounds: [],
    standings: [],
    live: [],
};

const list: TournamentList = {
    running: [summary(`t_autumnrobin1`, { status: `running`, round: { current: 2, of: 3 }, yours: { bot: `sealbot`, place: { state: `playing`, rank: 1, points: 2 } } })],
    scheduled: [summary(waiting.id, { name: waiting.name, status: `scheduled`, startsAt: later, entrants: 1 })],
    past: [summary(`t_summercup202`, { name: `Summer cup`, yours: { bot: `sealbot`, place: { state: `playing`, rank: 2, points: 3 } } }), summary(`t_raincup20261`, { name: `Rain cup`, status: `called_off` })],
};

const quinn: Me = { kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: [], analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } };

function listing(name: string, ownerName: string): BotListing {
    return { name, ownerName, online: true, openForChallenges: true, rating: 1500, provisional: false, liveGames: 0, levels: null, analyzer: null };
}

// Each read answers by its path and query; any other answers not found.
function serve(answers: Record<string, unknown>, me: Me = null): string[] {
    const reads: string[] = [];
    vi.stubGlobal(
        `fetch`,
        vi.fn((url: string) => {
            reads.push(url);
            const body = url === `/api/me` ? me : answers[url];
            return Promise.resolve(body === undefined ? new Response(JSON.stringify({ error: `no`, code: `not_found` }), { status: 404 }) : new Response(JSON.stringify(body)));
        }),
    );
    meStore.reset();
    meStore.start();
    return reads;
}

function open(path: string, screenOf: () => React.JSX.Element): void {
    window.history.replaceState(null, ``, path);
    render(screenOf());
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    meStore.reset();
    window.history.replaceState(null, ``, `/`);
});

describe('the tournaments under Games', () => {
    // A row under way or over is one link to its page; one coming up names its tournament in a link of its own.
    const rowOf = async (id: string) => {
        const link = await waitFor(() => {
            const found = document.querySelector<HTMLElement>(`a.duel-row[href="/tournaments/${id}"]`);
            if (found === null) throw new Error(`no row for ${id} yet`);
            return found;
        });
        return link;
    };

    it('name the reader\'s own bot\'s part on each row, and offer an owner the entry of one coming up', async () => {
        serve({ '/api/tournaments': list, '/api/bots': [listing(`sealbot`, `quinn`)] }, quinn);
        render(<TournamentsScreen />);
        expect((await rowOf(`t_autumnrobin1`)).querySelector(`.event-row-yours`)?.textContent).toBe(`Yours: sealbot, 1st so far`);
        expect((await rowOf(`t_summercup202`)).querySelector(`.event-row-yours`)?.textContent).toBe(`Yours: sealbot, 2nd`);
        const enter = await screen.findByRole(`link`, { name: `Enter a bot in Winter cup` });
        expect(enter.getAttribute(`href`)).toBe(`/tournaments/t_wintercup202`);
        expect(enter.textContent).toBe(`Enter a bot`);
        expect((await rowOf(`t_raincup20261`)).querySelector(`.event-row-yours`)).toBe(null);
    });

    it('frame a duel and a round robin alike, each dated the same way, a round robin with its leaders\' points', async () => {
        const field = summary(`t_fieldfield01`, {
            name: `Round robin by bruno`,
            origin: `person`,
            createdBy: `bruno`,
            rated: false,
            entrants: 3,
            gamesPerPair: 4,
            endedAt: new Date(Date.now() - 9 * hour).toISOString(),
            leaders: { bots: [{ name: `devbot-b` }], points: 6, games: 8 },
        });
        const over = duel(`d_overoverover`, { status: `finished`, endedAt: new Date(Date.now() - 4 * hour).toISOString(), round: null, pair: { ...pair, games: [pair.games[0] ?? { x: 1, gameId: null, outcome: `pending`, point: null, missing: [] }] } });
        serve({ '/api/tournaments': { running: [duel(`d_livelivelive`)], scheduled: [], past: [field, over] } });
        render(<TournamentsScreen />);
        const live = await rowOf(`d_livelivelive`);
        expect(live.querySelector(`.duel-row-facts`)?.textContent).toBe(`Game 2 of 2 liveunratedset up by bruno`);
        expect(live.querySelector(`.duel-glyphs`)).not.toBe(null);
        const row = await rowOf(`t_fieldfield01`);
        expect(row.querySelector(`.duel-row-facts`)?.textContent).toBe(`3 bots, 4 games a pairset up by bruno9 h ago`);
        expect(row.querySelector(`.event-figure`)?.textContent).toBe(`6 of 8devbot-b won`);
        expect((await rowOf(`d_overoverover`)).querySelector(`.duel-row-facts`)?.textContent).toMatch(/4 h ago$/u);
    });

    it('say when the weekly starts as Play says it, by the wait until it starts', async () => {
        serve({ '/api/tournaments': list });
        render(<TournamentsScreen />);
        expect(await screen.findByText(`Starts in 3 h 0 min; 1 of 12 entered; turn clock 10 s`)).toBeTruthy();
    });

    it('phrase a test of two bots and a test of three alike: the estimate, the framed score and who won, and the reader\'s bots as theirs', async () => {
        const estimate = (rating: number, first: number, second: number) => ({ games: first + second, points: { first, second }, rating, low: 100, high: null, chance: 0.99, favored: `first` as const, verdict: `stronger` as const, narrowed: null });
        const games = Array.from({ length: 10 }, (_, index) => ({ x: (index % 2) + 1, gameId: `g-${String(index)}`, outcome: `played` as const, point: 1, missing: [] }));
        const two = duel(`d_anatest00001`, {
            name: `Test by quinn`,
            createdBy: `quinn`,
            test: true,
            status: `finished`,
            endedAt: new Date(Date.now() - 4 * hour).toISOString(),
            round: null,
            pair: { first: { key: 1, name: `hextide`, points: 10 }, second: { key: 2, name: `pebble`, points: 0 }, games },
            lead: { bot: `hextide`, estimate: estimate(456, 10, 0) },
            yours: { bot: `hextide`, place: { state: `playing`, rank: 1, points: 10 } },
        });
        const three = summary(`t_anatest00002`, {
            name: `Round robin by quinn`,
            origin: `person`,
            createdBy: `quinn`,
            rated: false,
            test: true,
            entrants: 3,
            gamesPerPair: 4,
            endedAt: new Date(Date.now() - 2 * hour).toISOString(),
            leaders: { bots: [{ name: `hextide` }], points: 7, games: 8 },
            lead: { bot: `hextide`, estimate: estimate(191, 7, 1) },
            yours: { bot: `hextide`, place: { state: `playing`, rank: 1, points: 7 } },
        });
        serve({ '/api/tournaments?kind=test': { running: [], scheduled: [], past: [three, two] } }, quinn);
        open(`/games/tournaments?list=tests`, () => <TournamentsScreen />);
        const duelRow = await rowOf(`d_anatest00001`);
        const fieldRow = await rowOf(`t_anatest00002`);
        expect(duelRow.querySelector(`.duel-row-facts`)?.textContent).toBe(`hextide about +456, strongerset up by quinn4 h ago`);
        expect(fieldRow.querySelector(`.duel-row-facts`)?.textContent).toBe(`hextide about +191, stronger3 bots, 4 games a pairset up by quinn2 h ago`);
        expect(duelRow.querySelector(`.event-figure`)?.textContent).toBe(`10-0hextide won`);
        expect(fieldRow.querySelector(`.event-figure`)?.textContent).toBe(`7 of 8hextide won`);
        expect(duelRow.querySelector(`.event-row-yours`)?.textContent).toBe(`Yours: both bots`);
        expect(fieldRow.querySelector(`.event-row-yours`)?.textContent).toBe(`Yours: all 3 bots`);
    });

    it('keep the reader\'s filter and one bot in the address, and lead back to every bot', async () => {
        const reads = serve({ '/api/tournaments?bot=hextide': { running: [], scheduled: [], past: [summary(`t_summercup202`, { name: `Summer cup` })] }, '/api/tournaments?bot=hextide&kind=test': { running: [], scheduled: [], past: [] } });
        open(`/games/tournaments?bot=hextide`, () => <TournamentsScreen />);
        expect(await screen.findByText(`Tournaments of hextide`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Every bot` }).getAttribute(`href`)).toBe(`/games/tournaments`);
        fireEvent.click(screen.getByRole(`button`, { name: `Tests` }));
        expect(window.location.pathname + window.location.search).toBe(`/games/tournaments?bot=hextide&list=tests`);
        await waitFor(() => {
            expect(reads).toContain(`/api/tournaments?bot=hextide&kind=test`);
        });
        expect(await screen.findByText(`No test has ended yet.`)).toBeTruthy();
    });

    it('ask a signed-out reader on Yours to sign in once, in place of the lists', async () => {
        serve({ '/api/tournaments': { running: [], scheduled: [], past: [] } });
        open(`/games/tournaments?list=yours`, () => <TournamentsScreen />);
        expect(await screen.findByText(`Sign in to see the duels and round robins you set up and your bots' tournaments.`)).toBeTruthy();
        expect(screen.queryByRole(`heading`, { name: `Past` })).toBe(null);
    });

    it('offer no entry to a reader who owns no bot', async () => {
        serve({ '/api/tournaments': list, '/api/bots': [listing(`hextide`, `ana`)] }, quinn);
        render(<TournamentsScreen />);
        await screen.findByRole(`link`, { name: `Winter cup` });
        await waitFor(() => {
            expect(document.querySelectorAll(`.tournament-row, a.duel-row`)).toHaveLength(4);
        });
        expect(screen.queryByRole(`link`, { name: /^Enter a bot/u })).toBe(null);
    });
});

describe('the Tournament place under Play', () => {
    it('set a duel or round robin up beside the weekly, entered in place, and the reader\'s own tournaments', async () => {
        const mine = summary(`t_brunorobin01`, { name: `Round robin by quinn`, origin: `person`, format: `round_robin`, createdBy: `quinn`, rated: false, status: `running`, round: { current: 1, of: 3 } });
        const accepts = { turnMs: [5_000, 60_000] as [number, number], match: true, unlimited: true };
        const bots = [`sealbot`, `hextide`, `pebble`].map((name) => ({ ...listing(name, name === `sealbot` ? `quinn` : `ana`), accepts }));
        serve({ '/api/tournaments': list, '/api/tournaments?mine=1': { running: [mine], scheduled: [], past: [], quota: { live: 1, today: 1 } }, [`/api/tournaments/${waiting.id}`]: waiting, '/api/bots': bots, '/api/tournaments/bots': [] }, quinn);
        render(<PlayTournamentScreen />);
        expect(await screen.findByRole(`heading`, { level: 2, name: `New duel` })).toBeTruthy();
        expect(screen.getByRole(`button`, { name: `Add bots` })).toBeTruthy();
        const weekly = screen.getByRole(`heading`, { name: `Weekly tournament` }).closest(`section`) as HTMLElement;
        expect((await within(weekly).findByRole(`link`, { name: `Winter cup` })).getAttribute(`href`)).toBe(`/tournaments/t_wintercup202`);
        expect(within(weekly).getByText(/^Starts in 3 h 0 min; 1 of 12 entered; turn clock 10 s$/u)).toBeTruthy();
        expect(within(weekly).getByText(`rated`)).toBeTruthy();
        expect(await within(weekly).findByLabelText(`Your bot`)).toBeTruthy();
        const yours = screen.getByRole(`heading`, { name: `Your tournaments` }).closest(`section`) as HTMLElement;
        await waitFor(() => {
            expect(within(yours).getAllByRole(`link`).map((link) => link.getAttribute(`href`))).toEqual([`/games/tournaments?list=yours`, `/tournaments/t_brunorobin01`]);
        });
        expect(within(yours).getByText(`unrated`)).toBeTruthy();
        expect(screen.getByRole(`navigation`, { name: `Play` }).querySelector(`[aria-current="page"]`)?.textContent).toBe(`Tournament`);
    });

    it('offer a signed-out reader one sign-in, in the setup, the weekly\'s entry asking for it in words alone', async () => {
        serve({ '/api/tournaments': list, [`/api/tournaments/${waiting.id}`]: waiting, '/api/bots': [listing(`sealbot`, `quinn`)], '/api/tournaments/bots': [] });
        render(<PlayTournamentScreen />);
        expect(await screen.findByText(`Sign in to enter a bot.`)).toBeTruthy();
        expect(await screen.findByText(`Sign in to set up a duel or round robin; anyone can watch one.`)).toBeTruthy();
        expect(document.querySelectorAll(`.discord-button`)).toHaveLength(1);
        expect(document.querySelector(`.rr-card .discord-button`)).not.toBe(null);
    });

    it('say no weekly is coming up, and ask a signed-out reader to sign in to set one up and to see their own', async () => {
        serve({ '/api/tournaments': { ...list, scheduled: [] }, '/api/bots': [listing(`sealbot`, `quinn`)], '/api/tournaments/bots': [] });
        render(<PlayTournamentScreen />);
        expect(await screen.findByText(`No weekly tournament is coming up; the operator schedules each one.`)).toBeTruthy();
        expect(await screen.findByText(`Sign in to set up a duel or round robin; anyone can watch one.`)).toBeTruthy();
        expect(screen.getByText(`Sign in to see your tournaments.`)).toBeTruthy();
        expect(screen.queryByRole(`button`, { name: `Add bots` })).toBeNull();
    });
});

describe('a tournament row', () => {
    it('say one called off in lower case, and the reader\'s bot as entered in the past', async () => {
        const off = summary(`t_offoffoffoff`, { name: `Spring cup`, status: `called_off`, yours: { bot: `sealbot`, place: { state: `entered`, rank: null, points: null } } });
        serve({ '/api/tournaments': { running: [], scheduled: [], past: [off] } });
        open(`/games/tournaments`, () => <TournamentsScreen />);
        const row = await waitFor(() => {
            const found = document.querySelector<HTMLElement>(`a.duel-row[href="/tournaments/t_offoffoffoff"]`);
            if (found === null) throw new Error(`no row yet`);
            return found;
        });
        expect(row.querySelector(`.duel-row-facts`)?.textContent).toMatch(/^called off/u);
        expect(row.querySelector(`.event-row-yours`)?.textContent).toBe(`Yours: sealbot was entered`);
    });
});

describe('Home\'s tournament block', () => {
    const now = Date.now();
    const far = summary(waiting.id, { name: `Winter cup`, status: `scheduled`, startsAt: new Date(now + 72 * hour).toISOString(), entrants: 1 });

    it('offer an owner who has not entered the next tournament its entry, however far off it starts', () => {
        render(<TournamentBlock list={{ running: [], scheduled: [far], past: [] }} now={now} owner signedIn />);
        expect(screen.getByRole(`link`, { name: `Winter cup` }).getAttribute(`href`)).toBe(`/tournaments/t_wintercup202`);
        expect(screen.getByRole(`link`, { name: `Enter a bot in Winter cup` }).getAttribute(`href`)).toBe(`/play/tournament`);
        expect(screen.getByRole(`link`, { name: `Set up a round robin` }).getAttribute(`href`)).toBe(`/play/tournament`);
        expect(screen.getByRole(`link`, { name: `All tournaments` }).getAttribute(`href`)).toBe(`/games/tournaments`);
    });

    it('place the entry in the row of the tournament it enters, apart from the weekly running', () => {
        const running = summary(`t_autumnrobin1`, { name: `Autumn round robin`, status: `running`, round: { current: 2, of: 3 } });
        render(<TournamentBlock list={{ running: [running], scheduled: [far], past: [] }} now={now} owner signedIn />);
        const rows = [...document.querySelectorAll(`.home-row`)];
        expect(rows.map((row) => row.querySelector(`.player-name`)?.textContent)).toEqual([`Autumn round robin`, `Winter cup`]);
        expect(rows[0]?.querySelector(`a[aria-label^='Enter a bot']`)).toBe(null);
        expect(within(rows[1] as HTMLElement).getByRole(`link`, { name: `Enter a bot in Winter cup` }).getAttribute(`href`)).toBe(`/play/tournament`);
        expect(document.querySelector(`.home-block-foot`)?.textContent).toBe(`Set up a round robin`);
    });

    it('name the owner\'s own part once entered, and show nothing far off to anyone else', () => {
        const { container, rerender } = render(<TournamentBlock list={{ running: [], scheduled: [far], past: [] }} now={now} owner={false} signedIn={false} />);
        expect(container.innerHTML).toBe(``);
        const soon = { ...far, startsAt: new Date(now + 2 * hour).toISOString(), yours: { bot: `sealbot`, place: { state: `entered` as const, rank: null, points: null } } };
        rerender(<TournamentBlock list={{ running: [], scheduled: [soon], past: [] }} now={now} owner signedIn />);
        expect(screen.getByText(`Yours: sealbot entered`)).toBeTruthy();
        expect(screen.queryByRole(`link`, { name: /^Enter a bot/u })).toBe(null);
        expect(screen.getByRole(`link`, { name: `Set up a round robin` })).toBeTruthy();
    });
});
