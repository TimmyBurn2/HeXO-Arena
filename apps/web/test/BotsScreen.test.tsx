// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BotsScreen } from '../src/screens/BotsScreen';

const directory = [
    {
        name: `sealbot`,
        ownerName: `tom`,
        online: true,
        openForChallenges: true,
        rating: 1712,
        provisional: false,
        liveGames: 0,
        about: undefined,
        version: `0.3.1`,
        repoUrl: undefined,
        accepts: { turnMs: [5000, 60000], match: true, unlimited: true },
    },
    {
        name: `hextide`,
        ownerName: `ana`,
        online: false,
        openForChallenges: false,
        rating: 1690,
        provisional: true,
        liveGames: 0,
        accepts: { turnMs: null, match: true, unlimited: true },
    },
];

const urls: string[] = [];

function stubDirectory(rows: unknown[], status = 200, onlineRows?: unknown[]): void {
    urls.length = 0;
    vi.stubGlobal(
        `fetch`,
        vi.fn((url: string | URL) => {
            urls.push(String(url));
            const body = urls.at(-1)?.includes(`online=1`) ? (onlineRows ?? rows) : rows;
            return Promise.resolve(new Response(JSON.stringify(body), { status }));
        }),
    );
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('BotsScreen', () => {
    it('list every bot with owner, state, rating, and accepts', async () => {
        stubDirectory(directory);
        render(<BotsScreen />);
        expect(await screen.findByRole(`table`)).toBeTruthy();
        expect(screen.getByText(`tom`).tagName).toBe(`TD`);
        expect(screen.getByText(`turn 5 to 60 s, match, unlimited`)).toBeTruthy();
        expect(screen.getByText(`match, unlimited`)).toBeTruthy();
        expect(document.querySelectorAll(`tbody tr`).length).toBe(2);
    });

    it('name every column, the play column included', async () => {
        stubDirectory(directory);
        render(<BotsScreen />);
        await screen.findByRole(`table`);
        const headers = [...document.querySelectorAll(`thead th`)].map((header) => header.textContent);
        expect(headers.at(-1)).toBe(`Play`);
        expect(headers.every((header) => header !== ``)).toBe(true);
    });

    it('mark provisional ratings with the trailing question', async () => {
        stubDirectory(directory);
        render(<BotsScreen />);
        await screen.findByRole(`table`);
        const prov = document.querySelector(`.prov`) as HTMLElement;
        expect(prov.textContent).toBe(`?`);
        expect(prov.getAttribute(`title`)).toBe(`Provisional until the rating settles`);
    });

    it('explain both presence and open states in the legend', async () => {
        stubDirectory(directory);
        render(<BotsScreen />);
        await screen.findByRole(`table`);
        expect(screen.getByText(`open: takes challenges now`)).toBeTruthy();
        expect(screen.getByText(`?: provisional rating`)).toBeTruthy();
    });

    it('switch to the online query when the toggle flips', async () => {
        stubDirectory(directory);
        render(<BotsScreen />);
        await screen.findByRole(`table`);
        fireEvent.click(screen.getByRole(`checkbox`));
        await waitFor(() => {
            expect(urls.at(-1)).toBe(`/api/bots?online=1`);
        });
    });

    it('keep the table with a note when the filter empties it', async () => {
        stubDirectory(directory, 200, []);
        render(<BotsScreen />);
        await screen.findByText(`sealbot`);
        fireEvent.click(screen.getByRole(`checkbox`));
        expect(await screen.findByText(/No bots online right now/)).toBeTruthy();
        expect(screen.getByRole(`table`)).toBeTruthy();
    });

    it('link a ready row to the Play page with its bot, and give a busy row its reason instead', async () => {
        stubDirectory([...directory, { ...directory[0], name: `devbot-a`, liveGames: 4 }]);
        render(<BotsScreen />);
        const play = await screen.findByRole(`link`, { name: `Play sealbot` });
        expect(play.textContent).toBe(`Play`);
        expect(play.getAttribute(`href`)).toBe(`/play?bot=sealbot`);
        expect(screen.queryByRole(`link`, { name: `Play devbot-a` })).toBe(null);
        expect(screen.getAllByRole(`link`, { name: /^Play/u })).toHaveLength(1);
        const busy = screen.getByText(`devbot-a`).closest(`tr`);
        expect(busy?.lastElementChild?.textContent).toBe(`In 4 games`);
    });

    it('leave rows without coverage actionless', async () => {
        stubDirectory([
            { ...directory[1], online: false, openForChallenges: false, accepts: undefined },
        ]);
        render(<BotsScreen />);
        await screen.findByRole(`table`);
        expect(screen.queryByRole(`button`, { name: `Play` })).toBe(null);
    });

    it('show the day-one empty state only without the filter', async () => {
        stubDirectory([]);
        render(<BotsScreen />);
        expect(await screen.findByText(`No bots yet`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Build a bot` }).getAttribute(`href`)).toBe(`/connect`);
    });

    it('offer a retry when the first load fails', async () => {
        stubDirectory([], 500);
        render(<BotsScreen />);
        expect(await screen.findByText(`The bot list did not load`)).toBeTruthy();
        stubDirectory(directory);
        fireEvent.click(screen.getByRole(`button`, { name: `Try again` }));
        await waitFor(() => {
            expect(screen.getByRole(`table`)).toBeTruthy();
        });
    });
});
