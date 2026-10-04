// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BotListing, DuelList, DuelSummary, LiveGameEntry, Me, TournamentDetail, TournamentList, TournamentSummary } from '@hexo-arena/contract';
import { TournamentBlock } from '../src/home/blocks';
import { meStore } from '../src/me';
import { DuelsScreen } from '../src/screens/DuelsScreen';
import { GamesDuelsScreen } from '../src/screens/GamesDuelsScreen';
import { PlayTournamentScreen } from '../src/screens/PlayTournamentScreen';
import { TournamentsScreen } from '../src/screens/TournamentsScreen';

const hour = 3_600_000;
const bot = (name: string, ownerName: string) => ({ name, ownerName, ratingAtStart: 1500, now: { rating: 1500, provisional: false } });

function duel(id: string, overrides: Partial<DuelSummary> = {}): DuelSummary {
    return {
        id,
        kind: `duel`,
        status: `finished`,
        startedBy: `bruno`,
        first: bot(`sealbot`, `quinn`),
        second: bot(`hextide`, `ana`),
        terms: { games: 2, openingPlies: 5, timeControl: { mode: `turn`, turnTimeMs: 10_000 }, rated: false },
        score: { first: 2, second: 0 },
        createdAt: `2026-10-01T12:00:00Z`,
        endedAt: `2026-10-01T12:20:00Z`,
        played: 2,
        results: [
            { game: 1, x: `first`, gameId: `g-1`, state: `played`, winner: `first` },
            { game: 2, x: `second`, gameId: `g-2`, state: `played`, winner: `first` },
        ],
        ...overrides,
    };
}

function running(id: string, first: string, second: string): DuelSummary {
    return duel(id, {
        status: `running`,
        endedAt: null,
        played: 1,
        first: bot(first, `quinn`),
        second: bot(second, `ana`),
        score: { first: 1, second: 0 },
        results: [
            { game: 1, x: `first`, gameId: `g-${id}-1`, state: `played`, winner: `first` },
            { game: 2, x: `second`, gameId: `g-${id}-2`, state: `live`, winner: null },
        ],
    });
}

function liveOf(duelId: string, x: string, o: string): LiveGameEntry {
    return {
        gameId: `g-${duelId}-2`,
        players: { x: { name: x, rating: 1500, provisional: false, kind: `bot` }, o: { name: o, rating: 1500, provisional: false, kind: `bot` } },
        timeControl: { mode: `turn`, turnTimeMs: 10_000 },
        toMove: `x`,
        rated: false,
        cells: [{ x: 0, y: 0, side: `x` }],
        clock: { mode: `turn`, remainingTurnMs: 8_000 },
        duel: { id: duelId, game: 2, of: 2 },
    };
}

function summary(id: string, overrides: Partial<TournamentSummary>): TournamentSummary {
    return {
        id,
        name: `Autumn round robin`,
        origin: `operator`,
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

const later = new Date(Date.now() + 3 * hour + 30_000).toISOString().replace(/\.\d{3}Z$/u, `Z`);

const waiting: TournamentDetail = {
    id: `t_wintercup202`,
    name: `Winter cup`,
    origin: `operator`,
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

describe('the duels under Games', () => {
    it('draw each live duel with its live game\'s board beside where it stands, then the past ones with who started them', async () => {
        const live = running(`d_livelivelive`, `devbot-b`, `devbot-c`);
        const every: DuelList = { running: [live], past: [duel(`d_pastpast0001`)] };
        serve({ '/api/duels': every, '/api/games?tests=1': [liveOf(live.id, `devbot-c`, `devbot-b`)] });
        open(`/games/duels`, () => <GamesDuelsScreen />);
        const card = await waitFor(() => {
            const found = document.querySelector<HTMLElement>(`a.live-duel`);
            if (found === null) throw new Error(`no live duel yet`);
            return found;
        });
        expect(card.getAttribute(`href`)).toBe(`/duels/d_livelivelive`);
        await waitFor(() => {
            expect(card.querySelector(`.live-duel-board[aria-hidden="true"] svg`)).toBeTruthy();
        });
        expect(card.querySelector(`.live-duel-status`)?.textContent).toBe(`Game 2 of 2 livedevbot-b leads 1-0`);
        expect(card.querySelector(`.live-duel-terms`)?.textContent).toBe(`turn clock 10 s; unrated; started by bruno`);
        const past = screen.getByRole(`heading`, { name: `Past` }).closest(`section`) as HTMLElement;
        const row = within(past).getByRole(`link`);
        expect(row.getAttribute(`href`)).toBe(`/duels/d_pastpast0001`);
        expect(row.textContent).toContain(`started by bruno`);
        expect(screen.getByRole(`link`, { name: `Start a duel` }).getAttribute(`href`)).toBe(`/play/duels`);
    });

    it('list more than three live duels as rows, as boards would push the past ones far down', async () => {
        const duels = [`a`, `b`, `c`, `d`].map((tag) => running(`d_live0000000${tag}`, `bot-${tag}`, `bot-${tag}${tag}`));
        serve({ '/api/duels': { running: duels, past: [] }, '/api/games?tests=1': [] });
        open(`/games/duels`, () => <GamesDuelsScreen />);
        const live = (await screen.findByRole(`heading`, { name: `Live` })).closest(`section`) as HTMLElement;
        await waitFor(() => {
            expect(live.querySelectorAll(`.duel-row`)).toHaveLength(4);
        });
        expect(live.querySelector(`.live-duel`)).toBe(null);
    });

    it('keep the reader\'s filter and one bot in the address, and lead back to every bot', async () => {
        const reads = serve({ '/api/duels?bot=hextide': { running: [], past: [duel(`d_pastpast0001`)] }, '/api/duels?bot=hextide&kind=test': { running: [], past: [] }, '/api/games?tests=1': [] });
        open(`/games/duels?bot=hextide`, () => <GamesDuelsScreen />);
        expect(await screen.findByText(`Duels and tests of hextide`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Every bot` }).getAttribute(`href`)).toBe(`/games/duels`);
        fireEvent.click(screen.getByRole(`button`, { name: `Tests` }));
        expect(window.location.pathname + window.location.search).toBe(`/games/duels?bot=hextide&list=tests`);
        await waitFor(() => {
            expect(reads).toContain(`/api/duels?bot=hextide&kind=test`);
        });
        expect(await screen.findByText(`No test has ended yet.`)).toBeTruthy();
    });

    it('ask a signed-out reader on Yours to sign in once, in place of both lists', async () => {
        serve({ '/api/duels': { running: [], past: [] }, '/api/games?tests=1': [] });
        open(`/games/duels?list=yours`, () => <GamesDuelsScreen />);
        expect(await screen.findByText(`Sign in to see your duels and tests.`)).toBeTruthy();
        expect(screen.queryByRole(`heading`, { name: `Live` })).toBe(null);
        expect(screen.queryByRole(`heading`, { name: `Past` })).toBe(null);
    });
});

describe('the tournaments under Games', () => {
    it('name the reader\'s own bot\'s part on each row, and offer an owner the entry of one coming up', async () => {
        serve({ '/api/tournaments': list, '/api/bots': [listing(`sealbot`, `quinn`)] }, quinn);
        render(<TournamentsScreen />);
        const live = (await screen.findByRole(`link`, { name: `Autumn round robin` })).closest(`li`) as HTMLElement;
        expect(live.querySelector(`.tournament-row-yours`)?.textContent).toBe(`Yours: sealbot, 1st so far`);
        expect(screen.getByRole(`link`, { name: `Summer cup` }).closest(`li`)?.querySelector(`.tournament-row-yours`)?.textContent).toBe(`Yours: sealbot, 2nd`);
        const enter = await screen.findByRole(`link`, { name: `Enter a bot in Winter cup` });
        expect(enter.getAttribute(`href`)).toBe(`/tournaments/t_wintercup202`);
        expect(enter.textContent).toBe(`Enter a bot`);
        expect(screen.getByRole(`link`, { name: `Rain cup` }).closest(`li`)?.querySelector(`.tournament-row-yours`)).toBe(null);
    });

    it('offer no entry to a reader who owns no bot', async () => {
        serve({ '/api/tournaments': list, '/api/bots': [listing(`hextide`, `ana`)] }, quinn);
        render(<TournamentsScreen />);
        await screen.findByRole(`link`, { name: `Winter cup` });
        await waitFor(() => {
            expect(document.querySelectorAll(`.tournament-row`)).toHaveLength(4);
        });
        expect(screen.queryByRole(`link`, { name: /^Enter a bot/u })).toBe(null);
    });
});

describe('the Tournament place under Play', () => {
    it('set a round robin up beside the weekly, entered in place, and the reader\'s own round robins', async () => {
        const mine = summary(`t_brunorobin01`, { name: `Round robin by quinn`, origin: `person`, createdBy: `quinn`, rated: false, status: `running`, round: { current: 1, of: 3 } });
        const accepts = { turnMs: [5_000, 60_000] as [number, number], match: true, unlimited: true };
        const bots = [`sealbot`, `hextide`, `pebble`].map((name) => ({ ...listing(name, name === `sealbot` ? `quinn` : `ana`), accepts }));
        serve({ '/api/tournaments': list, '/api/tournaments?mine=1': { running: [mine], scheduled: [], past: [], quota: { live: 1, today: 1 } }, [`/api/tournaments/${waiting.id}`]: waiting, '/api/bots': bots, '/api/duels/bots': [] }, quinn);
        render(<PlayTournamentScreen />);
        expect(await screen.findByRole(`heading`, { level: 2, name: `New round robin` })).toBeTruthy();
        expect(screen.getByRole(`button`, { name: `Add bots to the round robin` })).toBeTruthy();
        const weekly = screen.getByRole(`heading`, { name: `Weekly tournament` }).closest(`section`) as HTMLElement;
        expect((await within(weekly).findByRole(`link`, { name: `Winter cup` })).getAttribute(`href`)).toBe(`/tournaments/t_wintercup202`);
        expect(within(weekly).getByText(/^Starts in 3 h 0 min; 1 of 12 entered; turn clock 10 s$/u)).toBeTruthy();
        expect(within(weekly).getByText(`rated`)).toBeTruthy();
        expect(await within(weekly).findByLabelText(`Your bot`)).toBeTruthy();
        const yours = screen.getByRole(`heading`, { name: `Your round robins` }).closest(`section`) as HTMLElement;
        await waitFor(() => {
            expect(within(yours).getAllByRole(`link`).map((link) => link.getAttribute(`href`))).toEqual([`/games/tournaments?list=yours`, `/tournaments/t_brunorobin01`]);
        });
        expect(within(yours).getByText(`unrated`)).toBeTruthy();
        expect(screen.getByRole(`navigation`, { name: `Play` }).querySelector(`[aria-current="page"]`)?.textContent).toBe(`Tournament`);
    });

    it('offer a signed-out reader one sign-in, in the setup, the weekly\'s entry asking for it in words alone', async () => {
        serve({ '/api/tournaments': list, [`/api/tournaments/${waiting.id}`]: waiting, '/api/bots': [listing(`sealbot`, `quinn`)], '/api/duels/bots': [] });
        render(<PlayTournamentScreen />);
        expect(await screen.findByText(`Sign in to enter a bot.`)).toBeTruthy();
        expect(await screen.findByText(`Sign in to set up a round robin; anyone can watch one.`)).toBeTruthy();
        expect(document.querySelectorAll(`.discord-button`)).toHaveLength(1);
        expect(document.querySelector(`.rr-card .discord-button`)).not.toBe(null);
    });

    it('say no weekly is coming up, and ask a signed-out reader to sign in to set one up and to see their own', async () => {
        serve({ '/api/tournaments': { ...list, scheduled: [] }, '/api/bots': [listing(`sealbot`, `quinn`)], '/api/duels/bots': [] });
        render(<PlayTournamentScreen />);
        expect(await screen.findByText(`No weekly tournament is coming up; the operator schedules each one.`)).toBeTruthy();
        expect(await screen.findByText(`Sign in to set up a round robin; anyone can watch one.`)).toBeTruthy();
        expect(screen.getByText(`Sign in to see your round robins.`)).toBeTruthy();
        expect(screen.queryByRole(`button`, { name: `Add bots to the round robin` })).toBeNull();
    });
});

describe('the Bot duel place under Play', () => {
    it('stand the reader\'s own duels beside the setup, and lead to every one of them', async () => {
        serve({ '/api/duels?mine=1': { running: [], past: [duel(`d_pastpast0001`)], quota: { live: 0, today: 1 } }, '/api/bots': [], '/api/duels/bots': [], '/api/tournaments': { running: [], scheduled: [], past: [] } }, quinn);
        open(`/play/duels`, () => <DuelsScreen />);
        const all = await screen.findByRole(`link`, { name: `All your duels` });
        expect(all.getAttribute(`href`)).toBe(`/games/duels?list=yours`);
        const side = all.closest(`section`) as HTMLElement;
        expect(within(side).getByRole(`heading`, { name: `Your duels` })).toBeTruthy();
        await waitFor(() => {
            expect(within(side).getAllByRole(`link`).map((link) => link.getAttribute(`href`))).toContain(`/duels/d_pastpast0001`);
        });
        expect(screen.getByRole(`navigation`, { name: `Play` }).querySelector(`[aria-current="page"]`)?.textContent).toBe(`Bot duel`);
    });
});

describe('a tournament row', () => {
    it('say one called off mid-line in lower case, and the reader\'s bot as entered in the past', async () => {
        const off = summary(`t_offoffoffoff`, { name: `Spring cup`, status: `called_off`, yours: { bot: `sealbot`, place: { state: `entered`, rank: null, points: null } } });
        serve({ '/api/tournaments': { running: [], scheduled: [], past: [off] } });
        open(`/games/tournaments`, () => <TournamentsScreen />);
        const row = (await screen.findByRole(`link`, { name: `Spring cup` })).closest(`.tournament-row`) as HTMLElement;
        expect(row.querySelector(`.tournament-row-facts`)?.textContent).toMatch(/; called off$/u);
        expect(row.querySelector(`.tournament-row-yours`)?.textContent).toBe(`Yours: sealbot was entered`);
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
