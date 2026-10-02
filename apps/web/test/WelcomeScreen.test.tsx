// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Me, Signup } from '@hexo-arena/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onlyLegal } from './legal-deploy';
import { meStore } from '../src/me';
import { landingOf } from '../src/router/use-route';
import { WelcomeScreen } from '../src/screens/WelcomeScreen';

const signup: Signup = { discord: { username: `mira.hex`, displayName: `Mira` }, suggestedName: `mira-hex`, next: `/connect` };

interface Call {
    method: string;
    body: unknown;
}

// The sign-up API as one test sees it: the read's answer, and the answer
// to Create account, with every call written down.
function serve(
    read: () => Response,
    created: () => Response = () => new Response(JSON.stringify({ name: `mira-hex` }), { status: 201 }),
    me: Me = null,
): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal(
        `fetch`,
        vi.fn((url: string, init?: RequestInit) => {
            const method = init?.method ?? `GET`;
            calls.push({ method: `${method} ${url}`, body: typeof init?.body === `string` ? JSON.parse(init.body) : undefined });
            if (url === `/api/me`) return Promise.resolve(new Response(JSON.stringify(me)));
            if (method === `GET`) return Promise.resolve(read());
            if (method === `POST`) return Promise.resolve(created());
            return Promise.resolve(new Response(null, { status: 204 }));
        }),
    );
    return calls;
}

const ok = () => new Response(JSON.stringify(signup));
const refused = (status: number, code: string) => () => new Response(JSON.stringify({ error: `no`, code }), { status });

function field(): HTMLInputElement {
    const input = screen.getByRole(`textbox`, { name: `Public name` });
    if (!(input instanceof HTMLInputElement)) throw new Error(`the name field is not an input`);
    return input;
}

function type(value: string): void {
    fireEvent.change(field(), { target: { value } });
}

beforeEach(() => {
    window.history.pushState(null, ``, `/welcome`);
    meStore.reset();
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.pushState(null, ``, `/`);
});

describe('WelcomeScreen', () => {
    it('show the Discord account in text and suggest a free name, the terms beside Create account', async () => {
        serve(ok);
        meStore.start();
        render(<WelcomeScreen />);
        expect(await screen.findByRole(`heading`, { level: 1, name: `Create your account` })).toBeTruthy();
        expect(screen.getByText(`Choose the name everyone sees here.`)).toBeTruthy();
        expect(await screen.findByText(`Mira`)).toBeTruthy();
        expect(screen.getByText(`Discord account`)).toBeTruthy();
        expect(screen.getByText(`@mira.hex`)).toBeTruthy();
        expect(document.querySelector(`img`)).toBe(null);
        expect(field().value).toBe(`mira-hex`);
        expect(screen.getByText(`mira-hex is free`)).toBeTruthy();
        const notice = screen.getByText(/^By creating your account you accept the/u);
        expect(notice.textContent).toBe(
            `By creating your account you accept the Terms, including the minimum age of 16. HeXO Arena keeps your Discord user ID and this name, and your Discord names while you are signed in, never your email; see\u00a0Privacy.`,
        );
        expect(within(notice).getByRole(`link`, { name: `Terms` }).getAttribute(`href`)).toBe(`/legal/terms`);
        expect(within(notice).getByRole(`link`, { name: `Privacy` }).getAttribute(`href`)).toBe(`/legal/privacy`);
        expect(screen.getByText(`If you cancel, nothing is kept. Not your Discord account? Cancel, switch accounts in Discord, and sign in again.`)).toBeTruthy();
        const described = (field().getAttribute(`aria-describedby`) ?? ``).split(` `).map((id) => document.getElementById(id)?.textContent);
        expect(described).toEqual([
            `mira-hex is free`,
            `Everyone sees this name on the ladder, in your games, and on your bots' pages; it cannot change later.`,
            `2 to 30 letters, digits, - or _; start with a letter, end with a letter or digit`,
        ]);
    });

    it('state no terms to accept when the deployment has none, and keep the privacy link', async () => {
        onlyLegal(`privacy`);
        serve(ok);
        meStore.start();
        render(<WelcomeScreen />);
        await screen.findByText(`mira-hex is free`);
        const notice = document.querySelector(`.welcome-notice`);
        expect(notice?.textContent).toBe(
            `HeXO Arena keeps your Discord user ID and this name, and your Discord names while you are signed in, never your email; see\u00a0Privacy.`,
        );
        expect(notice?.querySelector(`a`)?.getAttribute(`href`)).toBe(`/legal/privacy`);
    });

    it('redraw the pattern beside the field as the name is typed', async () => {
        serve(ok);
        meStore.start();
        render(<WelcomeScreen />);
        await screen.findByText(`mira-hex is free`);
        const drawn = () => document.querySelector(`.public-name-mark .sigil-on`)?.getAttribute(`d`) ?? null;
        const suggested = drawn();
        expect(suggested).not.toBe(null);
        type(`quinn`);
        expect(drawn()).not.toBe(suggested);
        type(`QUINN`);
        const folded = drawn();
        type(`quinn`);
        expect(drawn()).toBe(folded);
        type(``);
        expect(document.querySelector(`.public-name-mark svg.sigil-guest`)).toBeTruthy();
    });

    it('show the username alone when the account has no display name', async () => {
        serve(() => new Response(JSON.stringify({ ...signup, discord: { username: `mira.hex`, displayName: null } })));
        meStore.start();
        render(<WelcomeScreen />);
        expect(await screen.findByText(`@mira.hex`)).toBeTruthy();
        expect(document.querySelectorAll(`.from-discord-text > span`)).toHaveLength(2);
    });

    it('check a typed name live against the rule and the reserved names, keeping Create account off', async () => {
        serve(ok);
        meStore.start();
        render(<WelcomeScreen />);
        await screen.findByText(`mira-hex is free`);
        const create = screen.getByRole(`button`, { name: `Create account` });
        type(`mira.hex`);
        expect(field().getAttribute(`aria-invalid`)).toBe(`true`);
        expect(screen.getByText(/^2 to 30 letters/u).className).toBe(`field-error`);
        expect(create.getAttribute(`aria-disabled`)).toBe(`true`);
        type(`Admin`);
        expect(screen.getByText(`That name is reserved`)).toBeTruthy();
        expect(create.getAttribute(`aria-disabled`)).toBe(`true`);
        type(`MiraHex`);
        expect(screen.queryByText(`That name is reserved`)).toBe(null);
        expect(screen.queryByText(/is free$/u)).toBe(null);
        expect(screen.getByText(/^2 to 30 letters/u).className).toBe(`note`);
        expect(create.getAttribute(`aria-disabled`)).toBe(`false`);
        type(``);
        expect(create.getAttribute(`aria-disabled`)).toBe(`true`);
    });

    it('create the account under the typed name and go on to Build a bot, asking it to focus the bot name', async () => {
        const calls = serve(ok);
        meStore.start();
        render(<WelcomeScreen />);
        await screen.findByText(`mira-hex is free`);
        type(`MiraHex`);
        const entries = window.history.length;
        fireEvent.click(screen.getByRole(`button`, { name: `Create account` }));
        await waitFor(() => {
            expect(window.location.pathname).toBe(`/connect`);
        });
        // The welcome page leaves the history, so Back skips the spent sign-up.
        expect(window.history.length).toBe(entries);
        expect(calls).toContainEqual({ method: `POST /api/signup`, body: { name: `MiraHex` } });
        expect(calls.map((call) => call.method)).toContain(`GET /api/me`);
        expect(landingOf()).toBe(`bot-name`);
    });

    it('go back to any other page it started from without asking for focus', async () => {
        serve(() => new Response(JSON.stringify({ ...signup, next: `/bots/devbot-c?online=1` })));
        meStore.start();
        render(<WelcomeScreen />);
        await screen.findByText(`mira-hex is free`);
        fireEvent.click(screen.getByRole(`button`, { name: `Create account` }));
        await waitFor(() => {
            expect(window.location.pathname + window.location.search).toBe(`/bots/devbot-c?online=1`);
        });
        expect(landingOf()).toBe(null);
    });

    it('say a name is taken until it changes, with focus back in the field', async () => {
        serve(ok, refused(409, `name_taken`));
        meStore.start();
        render(<WelcomeScreen />);
        await screen.findByText(`mira-hex is free`);
        const create = screen.getByRole(`button`, { name: `Create account` });
        create.focus();
        fireEvent.click(create);
        expect(await screen.findByText(`That name is taken`)).toBeTruthy();
        expect(document.activeElement).toBe(field());
        expect(screen.queryByText(`mira-hex is free`)).toBe(null);
        expect(screen.getByRole(`button`, { name: `Create account` }).getAttribute(`aria-disabled`)).toBe(`true`);
        type(`mira-hex-2`);
        expect(screen.queryByText(`That name is taken`)).toBe(null);
    });

    it('say the account was not created when the request fails otherwise, focus kept on the button', async () => {
        serve(ok, () => new Response(`{}`, { status: 500 }));
        meStore.start();
        render(<WelcomeScreen />);
        await screen.findByText(`mira-hex is free`);
        const create = screen.getByRole(`button`, { name: `Create account` });
        create.focus();
        fireEvent.click(create);
        expect(await screen.findByText(`The account was not created; try again`)).toBeTruthy();
        expect(document.activeElement).toBe(create);
        expect(create.hasAttribute(`disabled`)).toBe(false);
        expect(screen.getByRole(`button`, { name: `Create account` }).getAttribute(`aria-disabled`)).toBe(`false`);
    });

    it('hold Create account for the wait a rate-limited creation names, focus kept on the button', async () => {
        serve(ok, () => new Response(JSON.stringify({ error: `slow down`, code: `rate_limited` }), { status: 429, headers: { 'retry-after': `9` } }));
        meStore.start();
        render(<WelcomeScreen />);
        await screen.findByText(`mira-hex is free`);
        const create = screen.getByRole(`button`, { name: `Create account` });
        create.focus();
        fireEvent.click(create);
        await waitFor(() => {
            expect(document.querySelector(`[role="status"] .sr-only`)?.textContent).toBe(`Too many tries; try again in 9 s`);
        });
        expect(document.activeElement).toBe(create);
        expect(create.getAttribute(`aria-disabled`)).toBe(`true`);
    });

    it('send an expired sign-in back to Discord once it knows nobody is signed in', async () => {
        serve(refused(410, `signup_expired`));
        render(<WelcomeScreen />);
        await waitFor(() => {
            expect(document.querySelector(`.skeleton`)).toBeTruthy();
        });
        expect(screen.queryByRole(`heading`, { level: 2 })).toBe(null);
        meStore.start();
        expect(await screen.findByRole(`heading`, { name: `That sign-in expired; sign in again` })).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Sign in with Discord` }).getAttribute(`href`)).toBe(`/api/auth/discord/login?next=%2F`);
        expect(screen.queryByRole(`textbox`)).toBe(null);
    });

    it('never take the title back once shown, while it waits to know who is here', async () => {
        const held: { answer: ((me: Me) => void) | null } = { answer: null };
        const reads: string[] = [];
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) => {
                reads.push(url);
                if (url === `/api/me`) {
                    return new Promise<Response>((resolve) => {
                        held.answer = (me) => {
                            resolve(new Response(JSON.stringify(me)));
                        };
                    });
                }
                return Promise.resolve(refused(410, `signup_expired`)());
            }),
        );
        meStore.start();
        const titled: boolean[] = [];
        const watch = new MutationObserver(() => {
            titled.push(document.querySelector(`h1`) !== null);
        });
        watch.observe(document.body, { childList: true, subtree: true });
        render(<WelcomeScreen />);
        titled.push(document.querySelector(`h1`) !== null);
        await waitFor(() => {
            expect(reads).toContain(`/api/signup`);
        });
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        held.answer?.(null);
        await screen.findByRole(`heading`, { name: `That sign-in expired; sign in again` });
        watch.disconnect();
        expect(screen.getByRole(`heading`, { level: 1, name: `Create your account` })).toBeTruthy();
        expect(titled.slice(Math.max(0, titled.indexOf(true)))).not.toContain(false);
    });

    it('offer the card only once it knows who is here, so a refusal never reads the session as unknown', async () => {
        const held: { answer: ((me: Me) => void) | null } = { answer: null };
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) => {
                if (url === `/api/me`) {
                    return new Promise<Response>((resolve) => {
                        held.answer = (me) => {
                            resolve(new Response(JSON.stringify(me)));
                        };
                    });
                }
                return Promise.resolve(ok());
            }),
        );
        meStore.start();
        render(<WelcomeScreen />);
        expect(await screen.findByRole(`heading`, { level: 1, name: `Create your account` })).toBeTruthy();
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(screen.queryByRole(`button`, { name: `Create account` })).toBe(null);
        expect(document.querySelector(`.skeleton`)).toBeTruthy();
        held.answer?.({ kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: [] });
        expect(await screen.findByText(`Creating this account signs quinn out.`)).toBeTruthy();
        expect(screen.getByRole(`button`, { name: `Create account` })).toBeTruthy();
    });

    it('end a sign-in that expires or tries too many names on Create account, saying so where focus was', async () => {
        for (const [status, code, sentence] of [
            [410, `signup_expired`, `That sign-in expired; sign in again`],
            [410, `signup_limit`, `That sign-in tried too many names; sign in again`],
        ] as const) {
            serve(ok, refused(status, code));
            meStore.start();
            const { unmount } = render(<WelcomeScreen />);
            await screen.findByText(`mira-hex is free`);
            fireEvent.click(screen.getByRole(`button`, { name: `Create account` }));
            const heading = await screen.findByRole(`heading`, { name: sentence });
            await waitFor(() => {
                expect(document.activeElement).toBe(heading);
            });
            // Signing in again returns where the first try started.
            expect(screen.getByRole(`link`, { name: `Sign in with Discord` }).getAttribute(`href`)).toBe(`/api/auth/discord/login?next=%2Fconnect`);
            expect(document.querySelector(`.welcome-ended .discord-sign-in .note`)?.textContent).toBe(
                `Your email stays with Discord, and a first sign-in asks for your public name; see\u00a0Privacy.`,
            );
            unmount();
        }
    });

    it('give a guest whose sign-up ended the guest line with the way back in', async () => {
        serve(ok, refused(410, `signup_limit`), { kind: `guest`, name: `Guest k3f9`, liveGames: [] });
        meStore.start();
        render(<WelcomeScreen />);
        await screen.findByText(`Creating your account ends this guest session and its games.`);
        fireEvent.click(screen.getByRole(`button`, { name: `Create account` }));
        await screen.findByRole(`heading`, { name: `That sign-in tried too many names; sign in again` });
        expect(document.querySelector(`.welcome-ended .discord-sign-in .note`)?.textContent).toBe(
            `Signing in ends this guest session and its games. Your email stays with Discord; see\u00a0Privacy.`,
        );
    });

    it('tell a guest that creating the account ends the guest session', async () => {
        serve(ok, undefined, { kind: `guest`, name: `Guest k3f9`, liveGames: [] });
        meStore.start();
        render(<WelcomeScreen />);
        expect(await screen.findByText(`Creating your account ends this guest session and its games.`)).toBeTruthy();
    });

    it('give way to the profile of someone already signed in with no sign-up waiting, never saying expired', async () => {
        serve(refused(410, `signup_expired`), undefined, { kind: `user`, name: `mira-hex`, rating: 1000, provisional: true, discord: null, liveGames: [] });
        render(<WelcomeScreen />);
        await waitFor(() => {
            expect(document.querySelector(`.skeleton`)).toBeTruthy();
        });
        // Until it knows who is here, the page promises no account.
        expect(screen.queryByRole(`heading`)).toBe(null);
        meStore.start();
        await waitFor(() => {
            expect(window.location.pathname).toBe(`/profile`);
        });
        expect(screen.queryByText(`That sign-in expired; sign in again`)).toBe(null);
    });

    it('tell someone signed in that creating another account signs them out', async () => {
        serve(ok, undefined, { kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: [] });
        meStore.start();
        render(<WelcomeScreen />);
        expect(await screen.findByText(`Creating this account signs quinn out.`)).toBeTruthy();
    });

    it('go on where the sign-in was headed when another tab created the account first', async () => {
        let me: Me = null;
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string, init?: RequestInit) => {
                if (url === `/api/me`) return Promise.resolve(new Response(JSON.stringify(me)));
                if (init?.method === `POST`) {
                    me = { kind: `user`, name: `mira-hex`, rating: 1000, provisional: true, discord: null, liveGames: [] };
                    return Promise.resolve(refused(410, `signup_expired`)());
                }
                return Promise.resolve(ok());
            }),
        );
        meStore.start();
        render(<WelcomeScreen />);
        await screen.findByText(`mira-hex is free`);
        fireEvent.click(screen.getByRole(`button`, { name: `Create account` }));
        await waitFor(() => {
            expect(window.location.pathname).toBe(`/connect`);
        });
        expect(screen.queryByText(`That sign-in expired; sign in again`)).toBe(null);
        expect(landingOf()).toBe(`bot-name`);
    });

    it('end the sign-up of someone signed in whose own sign-up expired, pressing once while it checks', async () => {
        const quinn: Me = { kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: [] };
        const posts: string[] = [];
        const pending: { answer: (() => void) | null } = { answer: null };
        let meReads = 0;
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string, init?: RequestInit) => {
                if (url === `/api/me`) {
                    meReads += 1;
                    // The first read signs quinn in; the check after the 410 waits.
                    if (meReads === 1) return Promise.resolve(new Response(JSON.stringify(quinn)));
                    return new Promise<Response>((resolve) => {
                        pending.answer = () => {
                            resolve(new Response(JSON.stringify(quinn)));
                        };
                    });
                }
                if (init?.method === `POST`) {
                    posts.push(url);
                    return Promise.resolve(refused(410, `signup_expired`)());
                }
                return Promise.resolve(ok());
            }),
        );
        meStore.start();
        render(<WelcomeScreen />);
        await screen.findByText(`Creating this account signs quinn out.`);
        const create = screen.getByRole(`button`, { name: `Create account` });
        fireEvent.click(create);
        await waitFor(() => {
            expect(pending.answer).not.toBe(null);
        });
        fireEvent.click(create);
        fireEvent.click(create);
        pending.answer?.();
        const heading = await screen.findByRole(`heading`, { name: `That sign-in expired; sign in again` });
        await waitFor(() => {
            expect(document.activeElement).toBe(heading);
        });
        expect(posts).toHaveLength(1);
        expect(window.location.pathname).toBe(`/welcome`);
    });

    it('offer a retry when the sign-in does not load', async () => {
        let answer = () => new Response(`{}`, { status: 500 });
        serve(() => answer());
        meStore.start();
        render(<WelcomeScreen />);
        expect(await screen.findByRole(`heading`, { name: `Your sign-in did not load` })).toBeTruthy();
        answer = ok;
        fireEvent.click(screen.getByRole(`button`, { name: `Try again` }));
        expect(await screen.findByText(`mira-hex is free`)).toBeTruthy();
    });

    it('drop the sign-up on Cancel and return where it started', async () => {
        const calls = serve(ok);
        meStore.start();
        render(<WelcomeScreen />);
        await screen.findByText(`mira-hex is free`);
        fireEvent.click(screen.getByRole(`button`, { name: `Cancel` }));
        await waitFor(() => {
            expect(window.location.pathname).toBe(`/connect`);
        });
        expect(calls.map((call) => call.method)).toContain(`DELETE /api/signup`);
        expect(calls.map((call) => call.method)).not.toContain(`POST /api/signup`);
    });
});
