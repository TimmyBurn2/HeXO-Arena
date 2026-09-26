// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { meStore } from '../src/me';
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
    meStore.reset();
});

// The owner panel needs a session, so these serve me beside the directory
// and record every write.
function serveAs(name: string, writes: { method: string; url: string }[], deleteStatus = 204): void {
    vi.stubGlobal(
        `fetch`,
        vi.fn((url: string, init?: RequestInit) => {
            const method = init?.method ?? `GET`;
            if (method !== `GET`) {
                writes.push({ method, url });
                if (method === `DELETE`) {
                    return Promise.resolve(
                        new Response(deleteStatus === 204 ? null : JSON.stringify({ error: `seated`, code: `in_game` }), {
                            status: deleteStatus,
                        }),
                    );
                }
                return Promise.resolve(new Response(JSON.stringify({ name: `sealbot`, token: `hxo_${`c`.repeat(43)}` })));
            }
            const body = url === `/api/me` ? { kind: `user`, name, rating: 1503, provisional: false } : [sealbot];
            return Promise.resolve(new Response(JSON.stringify(body)));
        }),
    );
    meStore.reset();
    meStore.start();
}

describe('BotScreen', () => {
    it('show the declaration, accepts table, and a working play button', async () => {
        stubDirectory([sealbot]);
        render(<BotScreen name="sealbot" />);
        expect(await screen.findByRole(`heading`, { name: `sealbot` })).toBeTruthy();
        expect(screen.getByText(`A clean-room HeXO engine with a rotation opener.`)).toBeTruthy();
        expect(screen.getByText(`5 to 60 s`)).toBeTruthy();
        expect(screen.getByText(`By tom`)).toBeTruthy();
        expect(document.querySelector(`.bot-rating-number`)?.textContent).toBe(`1712`);
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
        expect(screen.getByText(`Closed for challenges`)).toBeTruthy();
    });

    it('explain an absent declaration and disable play', async () => {
        const bare = { ...sealbot, about: undefined, version: undefined, repoUrl: undefined, accepts: undefined };
        stubDirectory([bare]);
        render(<BotScreen name="sealbot" />);
        expect(await screen.findByText(`Accepts nothing yet.`)).toBeTruthy();
        expect(document.querySelector(`.btn-primary`)?.hasAttribute(`disabled`)).toBe(true);
        expect(screen.getByText(`Accepts no clock yet`)).toBeTruthy();
    });

    it('mark provisional ratings', async () => {
        stubDirectory([{ ...sealbot, provisional: true }]);
        render(<BotScreen name="sealbot" />);
        expect(await screen.findByText(`?`)).toBeTruthy();
    });

    it('say when no such bot exists', async () => {
        stubDirectory([sealbot]);
        render(<BotScreen name="driftwood" />);
        expect(await screen.findByText(`No bot named driftwood`)).toBeTruthy();
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
        expect(await screen.findByText(`The bot did not load`)).toBeTruthy();
        stubDirectory([sealbot]);
        fireEvent.click(screen.getByRole(`button`, { name: `Try again` }));
        await waitFor(() => {
            expect(screen.getByRole(`heading`, { name: `sealbot` })).toBeTruthy();
        });
    });

    it('show the owner panel to the owner alone', async () => {
        serveAs(`ana`, []);
        render(<BotScreen name="sealbot" />);
        await screen.findByRole(`heading`, { name: `sealbot` });
        await waitFor(() => {
            expect(meStore.read().status).toBe(`ready`);
        });
        expect(screen.queryByRole(`heading`, { name: `Yours to run` })).toBe(null);
        cleanup();
        serveAs(`tom`, []);
        render(<BotScreen name="sealbot" />);
        expect(await screen.findByRole(`heading`, { name: `Yours to run` })).toBeTruthy();
    });

    it('rotate the token only on the second click and show the new one once', async () => {
        const writes: { method: string; url: string }[] = [];
        serveAs(`tom`, writes);
        render(<BotScreen name="sealbot" />);
        fireEvent.click(await screen.findByRole(`button`, { name: `Rotate token` }));
        expect(writes).toEqual([]);
        fireEvent.click(screen.getByRole(`button`, { name: `Rotate now; the old token dies` }));
        expect(await screen.findByText(`hxo_${`c`.repeat(43)}`)).toBeTruthy();
        expect(writes).toEqual([{ method: `POST`, url: `/api/bots/sealbot/token` }]);
    });

    it('delete only after the name is typed, and explain a seated bot', async () => {
        const writes: { method: string; url: string }[] = [];
        serveAs(`tom`, writes, 409);
        render(<BotScreen name="sealbot" />);
        const remove = await screen.findByRole(`button`, { name: `Delete sealbot` });
        expect(remove.hasAttribute(`disabled`)).toBe(true);
        fireEvent.change(screen.getByRole(`textbox`, { name: `type sealbot to confirm` }), { target: { value: `sealbot` } });
        expect(remove.hasAttribute(`disabled`)).toBe(false);
        fireEvent.click(remove);
        expect(await screen.findByText(`sealbot is in a game; finish or resign it first`)).toBeTruthy();
        expect(writes).toEqual([{ method: `DELETE`, url: `/api/bots/sealbot` }]);
    });
});
