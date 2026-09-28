// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayDialog } from '../src/components/PlayDialog';
import { meStore } from '../src/me';

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
    meStore.reset();
    window.history.replaceState(null, ``, `/`);
});

describe('PlayDialog', () => {
    it('opens on the first accepted mode with the turn slider clamped to the window', () => {
        renderDialog(turnOnly);
        const slider = screen.getByRole(`slider`, { name: `Turn clock` });
        expect(slider.getAttribute(`min`)).toBe(`30`);
        expect(slider.getAttribute(`max`)).toBe(`60`);
        expect(Number(slider.getAttribute(`value`))).toBeGreaterThanOrEqual(30);
        expect(Number(slider.getAttribute(`value`))).toBeLessThanOrEqual(60);
    });

    it('carry aria-valuetext that reads the chosen clock', () => {
        renderDialog(fullAccepts);
        expect(screen.getByRole(`slider`, { name: `Turn clock` }).getAttribute(`aria-valuetext`)).toBe(
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
        expect(screen.getByRole(`slider`, { name: `Main time` }).getAttribute(`aria-valuetext`)).toBe(
            `5 minutes`,
        );
        expect(screen.getByRole(`slider`, { name: `Increment` }).getAttribute(`aria-valuetext`)).toBe(
            `plus 3 seconds`,
        );
    });

    it('show the wall-cap note instead of sliders for unlimited', () => {
        renderDialog(fullAccepts);
        fireEvent.click(screen.getByRole(`button`, { name: `Unlimited` }));
        expect(screen.getByText(`No clock; after 24 hours the game ends with no winner.`)).toBeTruthy();
        expect(screen.queryByRole(`slider`)).toBe(null);
    });

    it('keep the advanced session collapsed by default', () => {
        renderDialog(fullAccepts);
        const advanced = document.querySelector(`details.advanced`) as HTMLDetailsElement;
        expect(advanced.open).toBe(false);
        expect(screen.getByRole(`radio`, { name: `5` }).getAttribute(`checked`)).toBe(``);
    });

    it('offer the odd opening lengths from one to nine, counted in stones with the origin', () => {
        renderDialog(fullAccepts);
        expect(screen.getByRole(`group`, { name: `Opening stones, origin included` })).toBeTruthy();
        expect(screen.getAllByRole(`radio`).map((radio) => radio.getAttribute(`value`))).toEqual([`1`, `3`, `5`, `7`, `9`]);
    });

    it('state the opening truth in stones, the origin alone included', () => {
        renderDialog(fullAccepts);
        expect(screen.getByText(/The origin and 4 random stones are placed/)).toBeTruthy();
        fireEvent.click(screen.getByRole(`radio`, { name: `1` }));
        expect(screen.getByText(`Only the origin is placed before play; each turn after it places 2 stones.`)).toBeTruthy();
        expect(screen.queryByText(/random stones/)).toBe(null);
        fireEvent.click(screen.getByRole(`radio`, { name: `9` }));
        expect(screen.getByText(/The origin and 8 random stones are placed/)).toBeTruthy();
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

    it('send the chosen clock and opening length, then navigate to the game', async () => {
        const calls: { url: string; body: { bot: string; timeControl: unknown; openingPlies: number } | null }[] = [];
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string | URL, init?: RequestInit) => {
                calls.push({
                    url: String(url),
                    body:
                        init !== undefined && typeof init.body === `string`
                            ? (JSON.parse(init.body) as { bot: string; timeControl: unknown; openingPlies: number } | null)
                            : null,
                });
                return Promise.resolve(
                    new Response(
                        JSON.stringify({
                            gameId: `g-1`,
                            you: `o`,
                            players: {
                                x: { name: `sealbot`, rating: 1712, provisional: false, kind: `bot` },
                                o: { name: `tom`, rating: 1503, provisional: false, kind: `user` },
                            },
                            openingPlies: 1,
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
        expect(request?.body?.openingPlies).toBe(5);
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
        expect(await screen.findByText(`sealbot is in 4 games already; try again shortly`)).toBeTruthy();
    });

    it('count the wait between new games in numerals', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: `wait`, code: `game_cooldown` }), { status: 429 }))),
        );
        renderDialog(fullAccepts);
        fireEvent.click(screen.getByRole(`button`, { name: `Start game` }));
        expect(await screen.findByText(`1 new game a minute; try again shortly`)).toBeTruthy();
    });

    it('say a delisted bot takes no new games', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: `hidden`, code: `delisted` }), { status: 403 }))),
        );
        renderDialog(fullAccepts);
        fireEvent.click(screen.getByRole(`button`, { name: `Start game` }));
        expect(await screen.findByText(`sealbot takes no new games`)).toBeTruthy();
    });

    it('mark only values the sliders can take and name the window by the bot', () => {
        renderDialog({ turnMs: [5000, 300000], match: true, unlimited: false });
        expect([...document.querySelectorAll(`.ticks span`)].map((tick) => tick.textContent)).toEqual([`5 s`, `150 s`, `300 s`]);
        expect(screen.getByText(`sealbot accepts 5 to 300 s.`)).toBeTruthy();
        expect(screen.getByText(`Clock, from what sealbot accepts`)).toBeTruthy();
        fireEvent.click(screen.getByRole(`button`, { name: `Match` }));
        expect([...document.querySelectorAll(`.ticks span`)].map((tick) => tick.textContent)).toEqual([
            `1 min`,
            `15 min`,
            `30 min`,
            `0 s`,
            `15 s`,
            `30 s`,
        ]);
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
        expect(await screen.findByText(`Sign in to start a game`)).toBeTruthy();
        const signIn = screen.getByRole(`link`, { name: `Sign in with Discord` });
        expect(signIn.getAttribute(`href`)).toBe(`/api/auth/discord/login`);
        expect(signIn.classList.contains(`discord-button`)).toBe(true);
        expect(screen.getByText(`Discord shares your username only; no email.`)).toBeTruthy();
        expect(screen.queryByRole(`button`, { name: `Start game` })).toBe(null);
    });

    it('ask the server again after a refused session, falling to the signed-out choices', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) =>
                Promise.resolve(
                    url === `/api/me`
                        ? new Response(`null`)
                        : new Response(JSON.stringify({ error: `no session`, code: `unauthorized` }), { status: 401 }),
                ),
            ),
        );
        renderDialog(fullAccepts);
        fireEvent.click(screen.getByRole(`button`, { name: `Start game` }));
        expect(await screen.findByRole(`button`, { name: `Play as guest` })).toBeTruthy();
        expect(meStore.read()).toEqual({ status: `ready`, me: null });
        expect(screen.getAllByRole(`link`, { name: `Sign in with Discord` })).toHaveLength(1);
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

    it('offer a signed-out player an unrated guest game in the same click', async () => {
        const posts: string[] = [];
        let me: unknown = null;
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string, init?: RequestInit) => {
                if (init?.method === `POST`) {
                    posts.push(url);
                    if (url === `/api/auth/guest`) {
                        me = { kind: `guest`, name: `Guest k3f9` };
                        return Promise.resolve(new Response(JSON.stringify(me), { status: 201 }));
                    }
                    return Promise.resolve(new Response(JSON.stringify({ error: `busy`, code: `bot_busy` }), { status: 409 }));
                }
                return Promise.resolve(new Response(JSON.stringify(me)));
            }),
        );
        meStore.start();
        renderDialog(fullAccepts);
        fireEvent.click(await screen.findByRole(`button`, { name: `Play as guest` }));
        await waitFor(() => {
            expect(posts).toEqual([`/api/auth/guest`, `/api/games`]);
        });
        expect(await screen.findByText(`sealbot is in 4 games already; try again shortly`)).toBeTruthy();
        expect(screen.getByText(`You play as Guest k3f9; guest games are unrated.`)).toBeTruthy();
    });

    it('explain a full guest house and keep the sign-in', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string, init?: RequestInit) =>
                Promise.resolve(
                    init?.method === `POST`
                        ? new Response(JSON.stringify({ error: `full`, code: `guest_limit` }), { status: 429 })
                        : new Response(`null`),
                ),
            ),
        );
        meStore.start();
        renderDialog(fullAccepts);
        expect((await screen.findByRole(`link`, { name: `Sign in with Discord` })).classList.contains(`discord-button`)).toBe(true);
        expect(screen.getByText(`Discord shares your username only; no email.`)).toBeTruthy();
        fireEvent.click(screen.getByRole(`button`, { name: `Play as guest` }));
        expect(await screen.findByText(`The guest limit is full; try again in a minute, or sign in`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Sign in with Discord` })).toBeTruthy();
    });
});

