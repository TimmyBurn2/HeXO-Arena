// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DuelList, DuelSummary, TournamentList, TournamentSummary } from '@hexo-arena/contract';
import { YourDuels } from '../src/duels/YourDuels';
import { BotEvents } from '../src/players/BotEvents';

const bot = (name: string, ownerName: string) => ({ name, ownerName, ratingAtStart: 1500, now: { rating: 1500, provisional: false } });

function duel(id: string, overrides: Partial<DuelSummary> = {}): DuelSummary {
    return {
        id,
        kind: `duel`,
        status: `finished`,
        startedBy: `quinn`,
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

const noDuels: DuelList = { running: [], past: [] };
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

describe('BotEvents', () => {
    it('list the tournaments a bot entered beside its duels: where it stands or why it did not play, and when', async () => {
        const reads = serve({
            '/api/duels?bot=sealbot&kind=duel': { running: [], past: [duel(`d_aaaaaaaaaaaa`)] },
            '/api/duels?bot=sealbot&kind=test': noDuels,
            '/api/tournaments?bot=sealbot': {
                running: [tournament(`t_runningcup01`, { name: `Running cup`, status: `running`, round: { current: 2, of: 5 }, bot: { state: `playing`, rank: 1, points: 3 } })],
                scheduled: [tournament(`t_nextcup00001`, { name: `Next cup`, status: `scheduled`, bot: { state: `entered`, rank: null, points: null } })],
                past: [
                    tournament(`t_autumncup001`, { endedAt: `2026-10-01T19:30:00Z`, bot: { state: `withdrawn`, reason: `missed`, rank: 6, points: 1 } }),
                    tournament(`t_summercup001`, { name: `Summer cup`, endedAt: `2026-09-01T19:30:00Z`, bot: { state: `playing`, rank: 2, points: 7 } }),
                ],
            },
        });
        render(<BotEvents bot="sealbot" owner="quinn" />);
        const section = (await screen.findByRole(`heading`, { name: `Tournaments` })).closest(`section`) as HTMLElement;
        const rows = within(section).getAllByRole(`link`).filter((link) => link.classList.contains(`place-row`));
        expect(rows.map((row) => row.getAttribute(`href`))).toEqual([`/tournaments/t_runningcup01`, `/tournaments/t_nextcup00001`, `/tournaments/t_autumncup001`]);
        expect(rows[0]?.textContent).toMatch(/^Running cuprated1st so far, 3 pointsRound 2 of 5/u);
        expect(rows[1]?.textContent).toMatch(/^Next cupratedEntered; starts /u);
        expect(rows[2]?.textContent).toMatch(/^Autumn round robinrated6th of 6, 1 point; withdrawn: missed two pairings in a row/u);
        expect(within(section).getByRole(`link`, { name: `All tournaments` }).getAttribute(`href`)).toBe(`/games/tournaments`);
        expect(screen.getByRole(`heading`, { name: `Duels` })).toBeTruthy();
        expect(screen.queryByRole(`heading`, { name: `Tests` })).toBe(null);
        expect(reads).toContain(`/api/tournaments?bot=sealbot`);
    });

    it('say why a bot that entered did not play, and name a tournament called off', async () => {
        serve({
            '/api/duels?bot=sealbot&kind=duel': noDuels,
            '/api/duels?bot=sealbot&kind=test': noDuels,
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

    it('show nothing for a bot with no duel, test, or tournament', async () => {
        const reads = serve({ '/api/duels?bot=sealbot&kind=duel': noDuels, '/api/duels?bot=sealbot&kind=test': noDuels, '/api/tournaments?bot=sealbot': noTournaments });
        const { container } = render(<BotEvents bot="sealbot" owner="quinn" />);
        await waitFor(() => {
            expect(reads).toHaveLength(3);
        });
        await settled();
        expect(container.innerHTML).toBe(``);
    });
});

describe('YourDuels', () => {
    it('list the reader\'s latest duels and tests as Games does under Yours, live first, then lead to the rest', async () => {
        const running = duel(`d_runningrun01`, { status: `running`, endedAt: null, played: 1 });
        const test = duel(`d_testtesttest`, { kind: `test`, first: bot(`sealbot`, `quinn`), second: bot(`marsh`, `quinn`) });
        const reads = serve({ '/api/duels?mine=1': { running: [running], past: [test, duel(`d_pastpast0001`), duel(`d_pastpast0002`)], quota: { live: 1, today: 3 } } });
        render(<YourDuels />);
        const section = (await screen.findByRole(`heading`, { name: `Your duels and tests` })).closest(`section`) as HTMLElement;
        const rows = within(section).getAllByRole(`link`).filter((link) => link.classList.contains(`duel-row`));
        expect(rows.map((row) => row.getAttribute(`href`))).toEqual([`/duels/d_runningrun01`, `/duels/d_testtesttest`, `/duels/d_pastpast0001`]);
        expect(rows[1]?.querySelector(`.tag`)?.textContent).toBe(`test`);
        expect(within(section).getByRole(`link`, { name: `All your duels and tests` }).getAttribute(`href`)).toBe(`/games/duels?list=yours`);
        expect(reads).toEqual([`/api/duels?mine=1`]);
    });

    it('show nothing while the reader has no duel or test', async () => {
        const reads = serve({ '/api/duels?mine=1': { ...noDuels, quota: { live: 0, today: 0 } } });
        const { container } = render(<YourDuels />);
        await waitFor(() => {
            expect(reads).toHaveLength(1);
        });
        await settled();
        expect(container.innerHTML).toBe(``);
    });
});
