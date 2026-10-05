// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TournamentList, TournamentPair, TournamentSummary } from '@hexo-arena/contract';
import { BotEvents } from '../src/players/BotEvents';
import { YourTournaments } from '../src/tournaments/YourTournaments';

// A finished duel of sealbot against hextide, sealbot winning both games.
const pair: TournamentPair = {
    first: { key: 1, name: `sealbot`, points: 2 },
    second: { key: 2, name: `hextide`, points: 0 },
    games: [
        { x: 1, gameId: `g-1`, outcome: `played`, point: 1, missing: [] },
        { x: 2, gameId: `g-2`, outcome: `played`, point: 1, missing: [] },
    ],
};

function tournament(id: string, overrides: Partial<TournamentSummary>): TournamentSummary {
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
        startsAt: `2026-10-01T18:00:00Z`,
        timeControl: { mode: `turn`, turnTimeMs: 10_000 },
        openingPlies: 5,
        entrants: 6,
        maxEntrants: 12,
        winner: null,
        round: null,
        ...overrides,
    };
}

const noTournaments: TournamentList = { running: [], scheduled: [], past: [] };

// Each read answers by its path and query; any other answers not found.
function serve(answers: Record<string, unknown>): string[] {
    const reads: string[] = [];
    vi.stubGlobal(
        `fetch`,
        vi.fn((url: string) => {
            reads.push(url);
            const body = answers[url];
            return Promise.resolve(body === undefined ? new Response(JSON.stringify({ error: `no`, code: `not_found` }), { status: 404 }) : new Response(JSON.stringify(body)));
        }),
    );
    return reads;
}

// The answers read so far have landed and rendered.
async function settled(): Promise<void> {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function duel(id: string, overrides: Partial<TournamentSummary> = {}): TournamentSummary {
    return tournament(id, { name: `Duel by quinn`, origin: `person`, format: `duel`, createdBy: `quinn`, rated: false, entrants: 2, maxEntrants: 2, endedAt: `2026-10-01T12:20:00Z`, pair, ...overrides });
}

describe('BotEvents', () => {
    it('lists a bot\'s tournaments in one block, a duel by its pair and score: where it stands or why it did not play, and when', async () => {
        const reads = serve({
            '/api/tournaments?bot=sealbot': {
                running: [tournament(`t_runningcup01`, { name: `Running cup`, status: `running`, round: { current: 2, of: 5 }, bot: { state: `playing`, rank: 1, points: 3 } })],
                scheduled: [tournament(`t_nextcup00001`, { name: `Next cup`, status: `scheduled`, bot: { state: `entered`, rank: null, points: null } })],
                past: [
                    duel(`d_sealduel0001`, { bot: { state: `playing`, rank: 1, points: 2 } }),
                    tournament(`t_autumncup001`, { endedAt: `2026-10-01T19:30:00Z`, bot: { state: `withdrawn`, reason: `missed`, rank: 6, points: 1 } }),
                    tournament(`t_summercup001`, { name: `Summer cup`, endedAt: `2026-09-01T19:30:00Z`, bot: { state: `playing`, rank: 2, points: 7 } }),
                    tournament(`t_springcup001`, { name: `Spring cup`, endedAt: `2026-08-01T19:30:00Z`, bot: { state: `playing`, rank: 3, points: 5 } }),
                ],
            },
        });
        render(<BotEvents bot="sealbot" owner="quinn" />);
        const section = (await screen.findByRole(`heading`, { name: `Tournaments` })).closest(`section`) as HTMLElement;
        const rows = within(section).getAllByRole(`link`).filter((link) => link.classList.contains(`place-row`));
        expect(rows.map((row) => row.getAttribute(`href`))).toEqual([
            `/tournaments/t_runningcup01`,
            `/tournaments/t_nextcup00001`,
            `/tournaments/d_sealduel0001`,
            `/tournaments/t_autumncup001`,
            `/tournaments/t_summercup001`,
        ]);
        expect(rows[0]?.textContent).toMatch(/^Running cuprated1st so far, 3 pointsRound 2 of 5/u);
        expect(rows[1]?.textContent).toMatch(/^Next cupratedEntered; starts /u);
        expect(rows[2]?.textContent).toMatch(/^sealbotBOTvshextideBOTunratedsealbot won 2-0/u);
        expect(rows[2]?.textContent).not.toMatch(/Round/u);
        expect(rows[3]?.textContent).toMatch(/^Autumn round robinrated6th of 6, 1 point; withdrawn: missed two openings in a row/u);
        expect(within(section).getByRole(`link`, { name: `All tournaments` }).getAttribute(`href`)).toBe(`/games/tournaments?bot=sealbot`);
        expect(screen.queryByRole(`heading`, { name: `Duels` })).toBe(null);
        expect(reads).toEqual([`/api/tournaments?bot=sealbot`]);
    });

    it('names a running duel\'s game and who leads, and says tests are the owner\'s own', async () => {
        const live: TournamentPair = {
            first: { key: 1, name: `sealbot`, points: 1 },
            second: { key: 2, name: `hextide`, points: 0 },
            games: [
                { x: 1, gameId: `g-1`, outcome: `played`, point: 1, missing: [] },
                { x: 2, gameId: `g-2`, outcome: `live`, point: null, missing: [] },
            ],
        };
        serve({ '/api/tournaments?bot=sealbot': { ...noTournaments, running: [duel(`d_sealduel0002`, { status: `running`, test: true, endedAt: undefined, pair: live, bot: { state: `playing`, rank: 1, points: 1 } })] } });
        render(<BotEvents bot="sealbot" owner="quinn" />);
        const section = (await screen.findByRole(`heading`, { name: `Tournaments` })).closest(`section`) as HTMLElement;
        expect(within(section).getAllByRole(`listitem`)[0]?.textContent).toMatch(/^sealbotBOTvshextideBOTtestGame 2 of 2 livesealbot leads 1-0/u);
        expect(within(section).getByText(/Tests are games between two of quinn's own bots/u)).toBeTruthy();
    });

    it('says why a bot that entered did not play, and names a tournament called off', async () => {
        serve({
            '/api/tournaments?bot=sealbot': {
                ...noTournaments,
                past: [
                    tournament(`t_leftout00001`, { bot: { state: `left_out`, reason: `daily_cap`, rank: null, points: null } }),
                    tournament(`t_calledoff001`, { status: `called_off`, bot: { state: `absent`, rank: null, points: null } }),
                ],
            },
        });
        render(<BotEvents bot="sealbot" owner="quinn" />);
        const section = (await screen.findByRole(`heading`, { name: `Tournaments` })).closest(`section`) as HTMLElement;
        const rows = within(section).getAllByRole(`listitem`).map((row) => row.textContent);
        expect(rows[0]).toMatch(/^Autumn round robinratedDid not play: too few bot games left that day/u);
        expect(rows[1]).toMatch(/^Autumn round robinratedCalled off/u);
    });

    it('shows nothing for a bot in no tournament', async () => {
        const reads = serve({ '/api/tournaments?bot=sealbot': noTournaments });
        const { container } = render(<BotEvents bot="sealbot" owner="quinn" />);
        await waitFor(() => {
            expect(reads).toHaveLength(1);
        });
        await settled();
        expect(container.innerHTML).toBe(``);
    });
});

describe('YourTournaments', () => {
    it('lists the reader\'s latest duels and round robins as Games does under Yours, live first, then leads to the rest', async () => {
        const running = duel(`d_runningrun01`, { status: `running`, endedAt: undefined });
        const test = duel(`d_testtesttest`, { test: true });
        const field = tournament(`t_fieldfield01`, { name: `Round robin by quinn`, origin: `person`, createdBy: `quinn`, rated: false, entrants: 3, maxEntrants: 3 });
        const reads = serve({ '/api/tournaments?mine=1': { ...noTournaments, running: [running], past: [test, field, duel(`d_pastpast0002`)], quota: { live: 1, today: 3 } } });
        render(<YourTournaments />);
        const section = (await screen.findByRole(`heading`, { name: `Your tournaments` })).closest(`section`) as HTMLElement;
        const rows = within(section).getAllByRole(`link`).filter((link) => link.classList.contains(`duel-row`));
        expect(rows.map((row) => row.getAttribute(`href`))).toEqual([`/tournaments/d_runningrun01`, `/tournaments/d_testtesttest`, `/tournaments/t_fieldfield01`]);
        expect(rows[1]?.querySelector(`.tag`)?.textContent).toBe(`test`);
        expect(within(section).getByRole(`link`, { name: `All yours` }).getAttribute(`href`)).toBe(`/games/tournaments?list=yours`);
        expect(reads).toEqual([`/api/tournaments?mine=1`]);
    });

    it('shows nothing while the reader has no duel or round robin', async () => {
        const reads = serve({ '/api/tournaments?mine=1': { ...noTournaments, quota: { live: 0, today: 0 } } });
        const { container } = render(<YourTournaments />);
        await waitFor(() => {
            expect(reads).toHaveLength(1);
        });
        await settled();
        expect(container.innerHTML).toBe(``);
    });
});
