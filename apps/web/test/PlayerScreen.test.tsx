// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerScreen } from '../src/screens/PlayerScreen';

const record = {
    name: `ana`,
    kind: `human`,
    rating: 1402,
    deviation: 58,
    provisional: false,
    rank: 5,
    games: 49,
    won: 27,
    lost: 20,
    undecided: 2,
    asX: { games: 25, won: 15 },
    asO: { games: 24, won: 12 },
    forfeits: { disconnect: 1, terminated: 0 },
    opponents: [
        { name: `sealbot`, kind: `bot`, games: 12, won: 4, lost: 8 },
        { name: `quinn`, kind: `human`, games: 6, won: 3, lost: 3 },
    ],
    firstGameAt: `2026-03-01T10:00:00Z`,
    lastGameAt: `2026-09-30T18:00:00Z`,
};

const points = [
    { gameId: `g-1`, at: `2026-03-01T10:00:00Z`, rating: 1500, deviation: 350, provisional: true },
    { gameId: `g-2`, at: `2026-05-01T10:00:00Z`, rating: 1440, deviation: 120, provisional: false },
    { gameId: `g-3`, at: `2026-09-30T18:00:00Z`, rating: 1402, deviation: 60, provisional: false },
];

const page = { games: [], page: 1, pages: 0, total: 0 };

function stubPlayer(body: unknown, status = 200): string[] {
    const reads: string[] = [];
    // Opening a page scrolls to its top, which the test document cannot do.
    vi.stubGlobal(`scrollTo`, () => undefined);
    vi.stubGlobal(
        `fetch`,
        vi.fn((url: string) => {
            reads.push(url);
            const answer = url.startsWith(`/api/players/`) && url.includes(`/rating`) ? points : url.startsWith(`/api/players/`) ? body : page;
            const code = url.startsWith(`/api/players/`) && !url.includes(`/rating`) ? status : 200;
            return Promise.resolve(new Response(JSON.stringify(answer), { status: code }));
        }),
    );
    return reads;
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState(null, ``, `/`);
});

describe('PlayerScreen', () => {
    it('shows a human player\'s rating, record, and most played opponents, each name leading to its page', async () => {
        stubPlayer(record);
        render(<PlayerScreen name="ana" />);
        expect(await screen.findByRole(`heading`, { level: 1, name: `ana` })).toBeTruthy();
        const card = await screen.findByRole(`region`, { name: `Record` });
        expect(within(card).getByText(`As x`).nextElementSibling?.textContent).toBe(`25 games, 15 won`);
        expect(within(card).getByText(`Forfeits`).nextElementSibling?.textContent).toBe(`1 by disconnect, 0 by illegal move`);
        expect(within(card).getByRole(`link`, { name: `5th` }).getAttribute(`href`)).toBe(`/ladder`);
        const opponents = screen.getByRole(`region`, { name: `Most played` });
        expect(within(opponents).getByRole(`link`, { name: `sealbot` }).getAttribute(`href`)).toBe(`/bots/sealbot`);
        expect(within(opponents).getByRole(`link`, { name: `quinn` }).getAttribute(`href`)).toBe(`/players/quinn`);
        expect(within(opponents).getByRole(`link`, { name: `12 games: 4 won, 8 lost` }).getAttribute(`href`)).toBe(`/games?player=ana&vs=sealbot`);
        expect(screen.queryByRole(`region`, { name: `Tournaments` })).toBeNull();
    });

    it('reads the history for the period chosen, a year at first', async () => {
        const reads = stubPlayer(record);
        render(<PlayerScreen name="ana" />);
        await screen.findByRole(`group`, { name: /^Rating chart, 3 rated games, now 1402/u });
        expect(reads).toContain(`/api/players/ana/rating?range=1y`);
        fireEvent.click(screen.getByRole(`button`, { name: `All` }));
        await waitFor(() => {
            expect(reads).toContain(`/api/players/ana/rating?range=all`);
        });
        expect(screen.getByRole(`button`, { name: `All` }).getAttribute(`aria-pressed`)).toBe(`true`);
    });

    it('scales the chart to every rating and the settled band, cutting the early provisional band at the plot\'s edge', async () => {
        stubPlayer(record);
        render(<PlayerScreen name="ana" />);
        const chart = await screen.findByRole(`group`, { name: /^Rating chart/u });
        expect([...chart.querySelectorAll(`.rating-chart-tick`)].map((tick) => tick.textContent)).toEqual([`1300`, `1400`, `1500`]);
        // The band is cut at the plot's edge in its own points, never drawn past it.
        const [, , , plotHeight = 0] = (chart.querySelector(`svg.rating-chart-plot`)?.getAttribute(`viewBox`) ?? ``).split(` `).map(Number);
        const ys = (chart.querySelector(`polygon.rating-chart-band`)?.getAttribute(`points`) ?? ``).split(` `).map((pair) => Number(pair.split(`,`)[1]));
        expect(ys.length).toBe(6);
        expect(ys.every((value) => value >= 0 && value <= plotHeight)).toBe(true);
    });

    it('walks the chart by keys and opens the game it holds', async () => {
        stubPlayer(record);
        render(<PlayerScreen name="ana" />);
        const chart = await screen.findByRole(`group`, { name: /^Rating chart/u });
        fireEvent.keyDown(chart, { key: `Home` });
        expect(screen.getByRole(`status`).textContent).toMatch(/^1500, band 1150 to 1850, .*, provisional$/u);
        fireEvent.keyDown(chart, { key: `ArrowRight` });
        expect(screen.getByRole(`status`).textContent).toMatch(/^1440, band 1320 to 1560, /u);
        fireEvent.keyDown(chart, { key: `Enter` });
        expect(window.location.pathname).toBe(`/game/g-2`);
    });

    it('offers another try when the history or the record does not load', async () => {
        const reads = new Map<string, number>();
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) => {
                const count = (reads.get(url) ?? 0) + 1;
                reads.set(url, count);
                // The page's own read lands; the blocks' first reads fail and their retries land.
                const fails = url.includes(`/rating`) ? count === 1 : url === `/api/players/ana` && count === 2;
                if (fails) return Promise.resolve(new Response(`{}`, { status: 500 }));
                return Promise.resolve(new Response(JSON.stringify(url.includes(`/rating`) ? points : url.startsWith(`/api/players/`) ? record : page)));
            }),
        );
        render(<PlayerScreen name="ana" />);
        expect(await screen.findByText(`The rating history did not load`)).toBeTruthy();
        expect(await screen.findByText(`The record did not load`)).toBeTruthy();
        for (const button of screen.getAllByRole(`button`, { name: `Try again` })) fireEvent.click(button);
        expect(await screen.findByRole(`group`, { name: /^Rating chart, 3 rated games/u })).toBeTruthy();
        expect(await screen.findByRole(`region`, { name: `Record` })).toBeTruthy();
    });

    it('says a player with no finished game has none, in place of a row of noughts', async () => {
        stubPlayer({ ...record, games: 0, won: 0, lost: 0, undecided: 0, asX: { games: 0, won: 0 }, asO: { games: 0, won: 0 }, forfeits: { disconnect: 0, terminated: 0 }, opponents: [], firstGameAt: null, lastGameAt: null });
        render(<PlayerScreen name="ana" />);
        const card = await screen.findByRole(`region`, { name: `Record` });
        expect(card.textContent).toBe(`RecordNo finished games yet.`);
    });

    it('heads the page with the name in its plate while the record loads', () => {
        vi.stubGlobal(`fetch`, vi.fn(() => new Promise<Response>(() => undefined)));
        render(<PlayerScreen name="ana" />);
        expect(screen.getByRole(`heading`, { level: 1, name: `ana` }).closest(`.bot-plate .bot-title`)).toBeTruthy();
        expect(document.querySelector(`.skeleton`)).toBeTruthy();
    });

    it('answers a name no player holds as missing', async () => {
        stubPlayer({ error: `no such player`, code: `not_found` }, 404);
        render(<PlayerScreen name="nobody" />);
        expect(await screen.findByRole(`heading`, { name: `No player named nobody` })).toBeTruthy();
        await waitFor(() => {
            expect(document.title).toBe(`Not found - HeXO Arena`);
        });
    });

    it('sends a bot\'s name on to its bot page', async () => {
        stubPlayer({ ...record, name: `sealbot`, kind: `bot`, placings: [] });
        render(<PlayerScreen name="sealbot" />);
        await waitFor(() => {
            expect(window.location.pathname).toBe(`/bots/sealbot`);
        });
    });
});
