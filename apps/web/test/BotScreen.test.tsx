// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BotScreen } from '../src/screens/BotScreen';

const sealbot = {
    name: `sealbot`,
    ownerName: `tom`,
    online: true,
    openForChallenges: true,
    rating: 1712,
    provisional: false,
    about: `A clean-room HeXO engine with a rotation opener.`,
    version: `0.3.1`,
    repoUrl: `https://github.com/tom/sealbot`,
    accepts: { turnMs: [5000, 60000], match: true, unlimited: true },
};

function stubDirectory(rows: unknown[], status = 200): void {
    vi.stubGlobal(
        `fetch`,
        vi.fn(() => Promise.resolve(new Response(JSON.stringify(rows), { status }))),
    );
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('BotScreen', () => {
    it('show the declaration, accepts table, and a working play button', async () => {
        stubDirectory([sealbot]);
        render(<BotScreen name="sealbot" />);
        expect(await screen.findByRole(`heading`, { name: `sealbot` })).toBeTruthy();
        expect(screen.getByText(`A clean-room HeXO engine with a rotation opener.`)).toBeTruthy();
        expect(screen.getByText(`5 - 60 s`)).toBeTruthy();
        expect(screen.getByText(`owner: tom`)).toBeTruthy();
        const play = screen.getByRole(`button`, { name: `Play sealbot` });
        expect(play.hasAttribute(`disabled`)).toBe(false);
    });

    it('match the name on the case-insensitive fold', async () => {
        stubDirectory([sealbot]);
        render(<BotScreen name="SealBot" />);
        expect(await screen.findByRole(`heading`, { name: `sealbot` })).toBeTruthy();
    });

    it('disable play with one clause when the bot is closed', async () => {
        stubDirectory([{ ...sealbot, openForChallenges: false }]);
        render(<BotScreen name="sealbot" />);
        expect(await screen.findByRole(`button`, { name: `Play sealbot` })).toBeTruthy();
        expect(document.querySelector(`.btn-primary`)?.hasAttribute(`disabled`)).toBe(true);
        expect(screen.getByText(`closed for challenges`)).toBeTruthy();
    });

    it('explain an absent declaration and disable play', async () => {
        const bare = { ...sealbot, about: undefined, version: undefined, repoUrl: undefined, accepts: undefined };
        stubDirectory([bare]);
        render(<BotScreen name="sealbot" />);
        expect(await screen.findByText(`accepts nothing yet`)).toBeTruthy();
        expect(document.querySelector(`.btn-primary`)?.hasAttribute(`disabled`)).toBe(true);
        expect(screen.getByText(`accepts no clock yet`)).toBeTruthy();
    });

    it('mark provisional ratings', async () => {
        stubDirectory([{ ...sealbot, provisional: true }]);
        render(<BotScreen name="sealbot" />);
        expect(await screen.findByText(`?`)).toBeTruthy();
    });

    it('say when no such bot exists', async () => {
        stubDirectory([sealbot]);
        render(<BotScreen name="driftwood" />);
        expect(await screen.findByText(`no bot named driftwood`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Browse bots` }).getAttribute(`href`)).toBe(`/bots`);
    });

    it('open the play dialog from the play button', async () => {
        stubDirectory([sealbot]);
        render(<BotScreen name="sealbot" />);
        fireEvent.click(await screen.findByRole(`button`, { name: `Play sealbot` }));
        expect(await screen.findByRole(`dialog`)).toBeTruthy();
        expect(screen.getByRole(`button`, { name: `Start game` })).toBeTruthy();
    });

    it('offer a retry when the directory fails', async () => {
        stubDirectory([], 500);
        render(<BotScreen name="sealbot" />);
        expect(await screen.findByText(`the bot did not load`)).toBeTruthy();
        stubDirectory([sealbot]);
        fireEvent.click(screen.getByRole(`button`, { name: `Try again` }));
        await waitFor(() => {
            expect(screen.getByRole(`heading`, { name: `sealbot` })).toBeTruthy();
        });
    });
});
