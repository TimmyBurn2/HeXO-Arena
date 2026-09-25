// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayDialog } from '../src/components/PlayDialog';

const fullAccepts = { turnMs: [5000, 60000], match: true, unlimited: true };
const turnOnly = { turnMs: [30000, 60000], match: false, unlimited: false };

function renderDialog(accepts: unknown, name = `sealbot`) {
    render(
        <PlayDialog bot={{ name, accepts: accepts as never }} open onClose={() => {}} />,
    );
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState(null, ``, `/`);
});

describe('PlayDialog', () => {
    it('opens on the first accepted mode with the turn slider clamped to the window', () => {
        renderDialog(turnOnly);
        const slider = screen.getByRole(`slider`, { name: `turn clock seconds` });
        expect(slider.getAttribute(`min`)).toBe(`30`);
        expect(slider.getAttribute(`max`)).toBe(`60`);
        expect(Number(slider.getAttribute(`value`))).toBeGreaterThanOrEqual(30);
        expect(Number(slider.getAttribute(`value`))).toBeLessThanOrEqual(60);
    });

    it('carry aria-valuetext that reads the chosen clock', () => {
        renderDialog(fullAccepts);
        expect(screen.getByRole(`slider`, { name: `turn clock seconds` }).getAttribute(`aria-valuetext`)).toBe(
            `10 seconds`,
        );
    });

    it('disable the segments the declaration does not cover', () => {
        renderDialog(turnOnly);
        expect(screen.getByRole(`button`, { name: `Match` }).getAttribute(`aria-disabled`)).toBe(`true`);
        expect(screen.getByRole(`button`, { name: `Unlimited` }).getAttribute(`aria-disabled`)).toBe(`true`);
        expect(screen.getByRole(`button`, { name: `Turn` }).getAttribute(`aria-disabled`)).toBe(null);
    });

    it('switch to the match sliders with their own valuetext', () => {
        renderDialog(fullAccepts);
        fireEvent.click(screen.getByRole(`button`, { name: `Match` }));
        expect(screen.getByRole(`slider`, { name: `main time minutes` }).getAttribute(`aria-valuetext`)).toBe(
            `5 minutes`,
        );
        expect(screen.getByRole(`slider`, { name: `increment seconds` }).getAttribute(`aria-valuetext`)).toBe(
            `plus 3 seconds`,
        );
    });

    it('show the wall-cap note instead of sliders for unlimited', () => {
        renderDialog(fullAccepts);
        fireEvent.click(screen.getByRole(`button`, { name: `Unlimited` }));
        expect(screen.getByText(`no clocks; the server caps the game at 24 hours`)).toBeTruthy();
        expect(screen.queryByRole(`slider`)).toBe(null);
    });

    it('keep the advanced session collapsed by default', () => {
        renderDialog(fullAccepts);
        const advanced = document.querySelector(`details.advanced`) as HTMLDetailsElement;
        expect(advanced.open).toBe(false);
        expect(screen.getByRole(`radio`, { name: `1` }).getAttribute(`checked`)).toBe(``);
    });

    it('state the opening truth for a zero-turn session', () => {
        renderDialog(fullAccepts);
        expect(screen.getByText(/1 random turn land/)).toBeTruthy();
        fireEvent.click(screen.getByRole(`radio`, { name: `0` }));
        expect(screen.getByText(/the opening stone lands/)).toBeTruthy();
        expect(screen.queryByText(/random turn/)).toBe(null);
    });

    it('announce failures to screen readers', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn(() =>
                Promise.resolve(
                    new Response(JSON.stringify({ error: `cap`, code: `bot_busy` }), { status: 400 }),
                ),
            ),
        );
        renderDialog(fullAccepts);
        fireEvent.click(screen.getByRole(`button`, { name: `Start game` }));
        expect(await screen.findByRole(`alert`)).toBeTruthy();
    });

    it('send the chosen clock and opening turns, then navigate to the game', async () => {
        const calls: { url: string; body: { bot: string; timeControl: unknown; openingTurns: number } | null }[] = [];
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string | URL, init?: RequestInit) => {
                calls.push({
                    url: String(url),
                    body:
                        init !== undefined && typeof init.body === `string`
                            ? (JSON.parse(init.body) as { bot: string; timeControl: unknown; openingTurns: number } | null)
                            : null,
                });
                return Promise.resolve(
                    new Response(
                        JSON.stringify({
                            gameId: `g-1`,
                            you: `o`,
                            opponent: { name: `sealbot`, rating: 1712, provisional: false },
                            openingTurns: 0,
                            board: { cells: [{ x: 0, y: 0, side: `x` }] },
                            status: `in-progress`,
                            toMove: `o`,
                            clock: { mode: `unlimited` },
                        }),
                        { status: 201 },
                    ),
                );
            }),
        );
        renderDialog(fullAccepts);
        fireEvent.click(screen.getByRole(`button`, { name: `Start game` }));
        await waitFor(() => {
            expect(window.location.pathname).toBe(`/game/g-1`);
        });
        const request = calls[0];
        expect(request?.url).toBe(`/api/games`);
        expect(request?.body?.bot).toBe(`sealbot`);
        expect(request?.body?.timeControl).toEqual({ mode: `turn`, turnTimeMs: 10000 });
        expect(request?.body?.openingTurns).toBe(1);
    });

    it('render the contract failure as one plain sentence', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn(() =>
                Promise.resolve(
                    new Response(JSON.stringify({ error: `cap`, code: `bot_busy` }), { status: 400 }),
                ),
            ),
        );
        renderDialog(fullAccepts);
        fireEvent.click(screen.getByRole(`button`, { name: `Start game` }));
        expect(await screen.findByText(`sealbot is seated elsewhere`)).toBeTruthy();
    });

    it('offer the discord sign-in when there is no session', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn(() =>
                Promise.resolve(new Response(JSON.stringify({ error: `no session`, code: `unauthorized` }), { status: 401 })),
            ),
        );
        renderDialog(fullAccepts);
        fireEvent.click(screen.getByRole(`button`, { name: `Start game` }));
        expect(await screen.findByText(`sign in to start a game`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Sign in with Discord` }).getAttribute(`href`)).toBe(
            `/api/auth/discord/login`,
        );
    });

    it('runs onClose when the dialog closes, which escape triggers natively', () => {
        let closed = false;
        render(
            <PlayDialog
                bot={{ name: `sealbot`, accepts: fullAccepts }}
                open
                onClose={() => {
                    closed = true;
                }}
            />,
        );
        (document.querySelector(`dialog.dialog`) as HTMLDialogElement).close();
        expect(closed).toBe(true);
    });
});
