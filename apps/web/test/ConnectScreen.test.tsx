// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://hexo.invalid/"}
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { meStore } from '../src/me';
import { ConnectScreen } from '../src/screens/ConnectScreen';

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState(null, ``, `/`);
});

function type(value: string): void {
    fireEvent.change(screen.getByRole(`textbox`, { name: `Bot name` }), { target: { value } });
}

function sample(name: string): string | null | undefined {
    return screen.getByRole(`figure`, { name }).querySelector(`pre code`)?.textContent;
}

describe('ConnectScreen', () => {
    it('lead with hexo-bridge, then the steps from sign-in, the declaration, and the Bot API, in that order', () => {
        window.history.replaceState(null, ``, `/connect`);
        render(<ConnectScreen />);
        const headings = screen.getAllByRole(`heading`).map((heading) => `${heading.tagName} ${heading.textContent}`);
        expect(headings).toEqual([
            `H1 Build a bot`,
            `H2 Run your engine with hexo-bridge`,
            `H3 Install`,
            `H3 A Python engine`,
            `H3 An engine in any language`,
            `H2 From sign-in to its first game`,
            `H3 Sign in`,
            `H3 Create your bot`,
            `H3 Copy the token`,
            `H3 Watch it play`,
            `H2 What the declaration says`,
            `H2 Speak the Bot API yourself`,
        ]);
        const signIn = screen.getByRole(`link`, { name: `Sign in with Discord` });
        expect(signIn.getAttribute(`href`)).toBe(`/api/auth/discord/login?next=%2Fconnect`);
        expect(signIn.classList.contains(`discord-button`)).toBe(true);
        expect(screen.getByText((_content, element) => element?.matches(`.discord-sign-in .note`) === true && element.textContent === `Your email stays with Discord, and a first sign-in asks for your public name; see\u00a0Privacy.`)).toBeTruthy();
    });

    it('install the bridge at its latest tag and link its examples, the Bot API, and the example without it', () => {
        render(<ConnectScreen />);
        expect(sample(`Install command`)).toBe(`pip install git+https://github.com/TimmyBurn2/hexo-bridge@v0.4.1`);
        expect(screen.getByRole(`link`, { name: `hexo-bridge` }).getAttribute(`href`)).toBe(`https://github.com/TimmyBurn2/hexo-bridge`);
        expect(screen.getByRole(`link`, { name: `random_engine.py` }).getAttribute(`href`)).toBe(`https://github.com/TimmyBurn2/hexo-bridge/blob/main/examples/random_engine.py`);
        expect(screen.getByRole(`link`, { name: `the bridge's readme` }).getAttribute(`href`)).toBe(`https://github.com/TimmyBurn2/hexo-bridge#readme`);
        expect(screen.getByRole(`link`, { name: `Bot API` }).getAttribute(`href`)).toBe(`https://github.com/TimmyBurn2/Hexo-Bot-Api`);
        expect(screen.getByRole(`link`, { name: `simple_bot.py` }).getAttribute(`href`)).toBe(`https://github.com/TimmyBurn2/Hexo-Bot-Api/blob/main/examples/simple_bot.py`);
        expect(screen.getByRole(`link`, { name: `Bot API readme` }).getAttribute(`href`)).toBe(`https://github.com/TimmyBurn2/Hexo-Bot-Api`);
    });

    it('point the samples at the origin the page is served from', () => {
        render(<ConnectScreen />);
        // The file is served from an origin no source names, so the samples can only take it from the page.
        const origin = `https://hexo.invalid`;
        expect(window.location.origin).toBe(origin);
        const python = sample(`bot.py, a whole bot in Python`) ?? ``;
        expect(python).toContain(`    url="${origin}",\n`);
        expect(python).toContain(`    token=os.environ["HEXO_BOT_TOKEN"],\n`);
        expect(python).toContain(`class MyEngine(Engine):\n    def move(self, position, request):\n`);
        expect(sample(`bot.toml, the bridge's settings`)).toContain(`[server]\nurl = "${origin}"\n`);
        expect(sample(`Command that starts bot.py`)).toBe(`HEXO_BOT_TOKEN=hxo_... python bot.py`);
        expect(sample(`Command that starts the bridge`)).toBe(`HEXO_BOT_TOKEN=hxo_... hexo-bridge bot.toml`);
        expect(document.body.textContent).not.toContain(`<domain>`);
    });

    it('list each field of the declaration with its limits, the analyzer\'s values under it', () => {
        render(<ConnectScreen />);
        const rows = [...document.querySelectorAll(`.declaration-fields > div`)];
        expect(rows.map((row) => row.querySelector(`dt`)?.textContent)).toEqual([`accepts`, `version`, `levels`, `analyzer`, `values`]);
        // A field's own words, without the fields nested under it.
        const says = rows.map((row) =>
            [...(row.querySelector(`:scope > dd`)?.childNodes ?? [])].filter((node) => !(node instanceof Element && node.matches(`dl`))).map((node) => node.textContent).join(``),
        );
        expect(says).toEqual([
            `The clocks it plays: turnMs, the shortest and longest turn clock in milliseconds, or null for none; match and unlimited, true or false.`,
            `The build that answers, up to 64 characters.`,
            `2 to 8 strengths a player can pick, weakest first, and the default its rating belongs to; a game at any other is unrated.`,
            `Your engine reads positions for the analysis board: lines, 1 to 3 per position, and maxSeconds, 1 to 10; a Python engine answers in analyze.`,
            `How its heuristic reads: scale, above 0 and at most 1000000, 1 by default, divides it; meaning is expected when the scaled value estimates x's expected result, or raw, the default, when it only orders positions, the honest choice unless your engine was fitted to game results; cuts, each above 0 and at most 2 and rising, are the drops in value judged an inaccuracy, a mistake, and a blunder.`,
        ]);
        expect(rows[3]?.querySelector(`dd dt`)?.textContent).toBe(`values`);
    });

    it('name the bot field with a label on screen', () => {
        render(<ConnectScreen />);
        const label = document.querySelector(`label[for="bot-name"]`);
        expect(label?.textContent).toBe(`Bot name`);
        expect(screen.getByRole(`textbox`, { name: `Bot name` }).id).toBe(`bot-name`);
    });

    it('validate the name live against the syntax rules', () => {
        render(<ConnectScreen />);
        type(`1badname`);
        expect(screen.getByText(`2 to 30 letters, digits, - or _; start with a letter, end with a letter or digit`)).toBeTruthy();
        type(`admin`);
        expect(screen.getByText(`That name is reserved`)).toBeTruthy();
        type(`sealbot`);
        expect(screen.queryByText(/2 to 30 letters/)).toBe(null);
        expect(screen.queryByText(/reserved/)).toBe(null);
    });

    it('keep the create button off until the name is legal', () => {
        render(<ConnectScreen />);
        const create = screen.getByRole(`button`, { name: `Create bot` });
        expect(create.hasAttribute(`disabled`)).toBe(true);
        type(`sealbot`);
        expect(create.hasAttribute(`disabled`)).toBe(false);
    });

    it('create the bot and show the token exactly once', async () => {
        const bodies: unknown[] = [];
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string | URL, init?: RequestInit) => {
                bodies.push(init !== undefined && typeof init.body === `string` ? JSON.parse(init.body) : null);
                return Promise.resolve(
                    new Response(JSON.stringify({ name: `sealbot`, token: `hxo_${`a`.repeat(43)}` }), { status: 201 }),
                );
            }),
        );
        render(<ConnectScreen />);
        type(`sealbot`);
        fireEvent.click(screen.getByRole(`button`, { name: `Create bot` }));
        expect(await screen.findByText(`hxo_${`a`.repeat(43)}`)).toBeTruthy();
        expect(screen.getByRole(`button`, { name: `Copy` })).toBeTruthy();
        expect(screen.getByText(/shows only once/)).toBeTruthy();
        await waitFor(() => {
            expect(bodies).toEqual([{ name: `sealbot` }]);
        });
    });

    it('render the taken name as one sentence', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn(() =>
                Promise.resolve(
                    new Response(JSON.stringify({ error: `taken`, code: `name_taken` }), { status: 409 }),
                ),
            ),
        );
        render(<ConnectScreen />);
        type(`sealbot`);
        fireEvent.click(screen.getByRole(`button`, { name: `Create bot` }));
        expect(await screen.findByText(`That name is taken`)).toBeTruthy();
    });

    it('hold Create bot for the wait a rate-limited creation names, counting it down', async () => {
        vi.useFakeTimers({ toFake: [`setInterval`, `clearInterval`, `Date`] });
        try {
            vi.stubGlobal(
                `fetch`,
                vi.fn(() =>
                    Promise.resolve(
                        new Response(JSON.stringify({ error: `slow down`, code: `rate_limited` }), { status: 429, headers: { 'retry-after': `2` } }),
                    ),
                ),
            );
            render(<ConnectScreen />);
            type(`sealbot`);
            const create = screen.getByRole(`button`, { name: `Create bot` });
            fireEvent.click(create);
            const shown = () => document.querySelector(`.field-error [aria-hidden="true"]`)?.textContent;
            await waitFor(() => {
                expect(shown()).toBe(`Too many tries; try again in 2 s`);
            });
            expect(document.querySelector(`.field-error .sr-only`)?.textContent).toBe(`Too many tries; try again in 2 s`);
            expect(create.hasAttribute(`disabled`)).toBe(true);
            await act(async () => {});
            act(() => {
                vi.advanceTimersByTime(1000);
            });
            expect(shown()).toBe(`Too many tries; try again in 1 s`);
            act(() => {
                vi.advanceTimersByTime(1000);
            });
            expect(screen.queryByText(/try again in/u)).toBe(null);
            expect(create.hasAttribute(`disabled`)).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('point a signed-out creator at step one', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn(() =>
                Promise.resolve(
                    new Response(JSON.stringify({ error: `no session`, code: `unauthorized` }), { status: 401 }),
                ),
            ),
        );
        render(<ConnectScreen />);
        type(`sealbot`);
        fireEvent.click(screen.getByRole(`button`, { name: `Create bot` }));
        expect(await screen.findByText(`Sign in first (step 1)`)).toBeTruthy();
    });

    it('mark the sign-in step done for a signed-in user', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn(() => Promise.resolve(new Response(JSON.stringify({ kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: [], analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } })))),
        );
        meStore.reset();
        meStore.start();
        render(<ConnectScreen />);
        expect(await screen.findByRole(`heading`, { name: `Signed in as quinn` })).toBeTruthy();
        expect(screen.queryByRole(`link`, { name: `Sign in with Discord` })).toBe(null);
        meStore.reset();
    });

    it('take focus to the bot name when an account was just made on the way here, once', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn(() => Promise.resolve(new Response(JSON.stringify({ kind: `user`, name: `quinn`, rating: 1000, provisional: true, discord: null, liveGames: [], analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } })))),
        );
        window.history.pushState({ landing: `bot-name` }, ``, `/connect`);
        meStore.reset();
        meStore.start();
        render(<ConnectScreen />);
        await screen.findByRole(`heading`, { name: `Signed in as quinn` });
        await waitFor(() => {
            expect(document.activeElement).toBe(screen.getByRole(`textbox`, { name: `Bot name` }));
        });
        expect(window.history.state).toBe(null);
        meStore.reset();
        window.history.pushState(null, ``, `/`);
    });

    it('tell a guest that owning a bot takes an account', async () => {
        vi.stubGlobal(`fetch`, vi.fn(() => Promise.resolve(new Response(JSON.stringify({ kind: `guest`, name: `Guest k3f9`, liveGames: [] })))));
        meStore.reset();
        meStore.start();
        render(<ConnectScreen />);
        expect(await screen.findByText(`You are playing as Guest k3f9; owning a bot needs a Discord sign-in.`)).toBeTruthy();
        expect(document.querySelector(`.discord-sign-in .note`)?.textContent).toBe(
            `Signing in ends this guest session and its live games. Your email stays with Discord; see\u00a0Privacy.`,
        );
        meStore.reset();
    });
});

