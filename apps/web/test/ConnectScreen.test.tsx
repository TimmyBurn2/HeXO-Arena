// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { meStore } from '../src/me';
import { ConnectScreen } from '../src/screens/ConnectScreen';

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function type(value: string): void {
    fireEvent.change(screen.getByRole(`textbox`, { name: `Bot name` }), { target: { value } });
}

describe('ConnectScreen', () => {
    it('walk the six numbered steps with their links', () => {
        render(<ConnectScreen />);
        const headings = screen.getAllByRole(`heading`).map((heading) => heading.textContent);
        for (const expected of [
            `Build a bot`,
            `Sign in`,
            `Create your bot`,
            `Copy the token`,
            `Run the example`,
            `Watch it play`,
            `Read the Bot API`,
        ]) {
            expect(headings).toContain(expected);
        }
        const signIn = screen.getByRole(`link`, { name: `Sign in with Discord` });
        expect(signIn.getAttribute(`href`)).toBe(`/api/auth/discord/login`);
        expect(signIn.classList.contains(`discord-button`)).toBe(true);
        expect(screen.getByText((_content, element) => element?.matches(`.discord-sign-in .note`) === true && element.textContent === `By signing in you accept the Terms. HeXO Arena keeps only your Discord user ID and a public name made from your username, never your email; see\u00a0Privacy.`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: /simple_bot\.py/ }).getAttribute(`href`)).toContain(
            `github.com/TimmyBurn2/Hexo-Bot-Api`,
        );
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
        expect(await screen.findByText(/hxo_/)).toBeTruthy();
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
            vi.fn(() => Promise.resolve(new Response(JSON.stringify({ kind: `user`, name: `tom`, rating: 1503, provisional: false })))),
        );
        meStore.reset();
        meStore.start();
        render(<ConnectScreen />);
        expect(await screen.findByRole(`heading`, { name: `Signed in as tom` })).toBeTruthy();
        expect(screen.queryByRole(`link`, { name: `Sign in with Discord` })).toBe(null);
        meStore.reset();
    });

    it('tell a guest that owning a bot takes an account', async () => {
        vi.stubGlobal(`fetch`, vi.fn(() => Promise.resolve(new Response(JSON.stringify({ kind: `guest`, name: `Guest k3f9` })))));
        meStore.reset();
        meStore.start();
        render(<ConnectScreen />);
        expect(await screen.findByText(`You are playing as Guest k3f9; owning a bot needs a Discord sign-in.`)).toBeTruthy();
        meStore.reset();
    });
});

