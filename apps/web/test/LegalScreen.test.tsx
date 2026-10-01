// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
    guestIdleSeconds,
    sessionCookieName,
    sessionMaxAgeSeconds,
    signupCookieName,
    signupMaxAgeSeconds,
    type LegalDetails,
} from '@hexo-arena/contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boardSettingsStorageKey } from '../src/board/board-settings';
import { drawerPinnedStorageKey } from '../src/game/use-drawer';
import { playStorageKey } from '../src/play/setup';
import { LegalScreen } from '../src/screens/LegalScreen';
import { themeStorageKey } from '../src/theme/themes';

const details: LegalDetails = {
    operator: { name: `Ada Beispiel`, street: `Musterweg 7`, postcodeAndCity: `12345 Beispielstadt`, country: `Germany`, email: `contact@arena.example`, discord: `ada_b` },
    host: { name: `Example Hosting GmbH`, street: `Serverstrasse 1`, postcodeAndCity: `54321 Rechenburg`, country: `Germany`, serverLocation: `Rechenburg, Germany` },
    supervisoryAuthority: { name: `Example Authority`, street: `Aufsichtsplatz 2`, postcodeAndCity: `11111 Landeshausen`, country: `Germany`, url: `https://authority.example/` },
    mailProvider: { name: `Example Mail AG`, street: `Postfach 3`, postcodeAndCity: `22222 Briefstadt`, country: `Germany` },
};

function serve(answer: () => Response): void {
    vi.stubGlobal(
        `fetch`,
        vi.fn(() => Promise.resolve(answer())),
    );
}

const ok = (body: unknown) => () => new Response(JSON.stringify(body));

// A section of the page, found by its heading.
function section(heading: string): HTMLElement {
    const found = screen.getByRole(`heading`, { level: 2, name: heading }).closest(`section`);
    if (found === null) throw new Error(`no section headed ${heading}`);
    return found;
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('LegalScreen', () => {
    it('name the operator in the imprint with an address, a written-out mail link, and Discord beside it', async () => {
        serve(ok(details));
        render(<LegalScreen page="imprint" />);
        expect(screen.getByRole(`heading`, { level: 1, name: `Impressum / Legal notice` })).toBeTruthy();
        const address = await screen.findByText(`Ada Beispiel`);
        expect(screen.getByText(`Under sec. 18(1) Medienstaatsvertrag and sec. 5 DDG:`)).toBeTruthy();
        expect(address.closest(`address`)?.textContent).toBe(`Ada BeispielMusterweg 712345 BeispielstadtGermany`);
        const mail = screen.getAllByRole(`link`, { name: `contact@arena.example` })[0];
        expect(mail?.getAttribute(`href`)).toBe(`mailto:contact@arena.example`);
        expect(screen.getByText(`Discord: ada_b`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Reporting` }).getAttribute(`href`)).toBe(`/legal/terms#reporting`);
        // A short page needs no list of its sections.
        expect(screen.queryByRole(`navigation`)).toBe(null);
    });

    it('say what the ladder, the game search, and the bot list make public, and what challenges and bot deletion keep', async () => {
        serve(ok(details));
        render(<LegalScreen page="privacy" />);
        await screen.findByRole(`navigation`, { name: `On this page` });
        expect(section(`Your account and public name`).textContent).toContain(
            `anyone can search the games by it, which shows your results and your record against each opponent.`,
        );
        const games = section(`Games and ratings`).textContent;
        expect(games).toContain(`each player's rating before and after. Games, ratings, and the rating history are public`);
        expect(games).toContain(`each player's rating, rated games played, and when the last one finished`);
        const bots = section(`Bots`);
        expect(bots.textContent).toContain(`whether the bot is connected, whether it is open to challenges, and how many games it is playing`);
        expect(bots.textContent).toContain(`These records are not public, count toward the daily challenge limits, and have no set end yet.`);
        expect(bots.textContent).toContain(`for the challenge records, Art. 6(1)(f) GDPR, legitimate interest: enforcing fair challenge limits.`);
        expect(within(bots).getByRole(`link`, { name: `Deleting your account` }).getAttribute(`href`)).toBe(`#deletion`);
        // Every kind of data says how long it is kept.
        expect(bots.textContent).toContain(`A bot is kept until you delete it.`);
        expect(bots.textContent).toContain(`A bot you enter in a tournament is listed there with you as its owner, its rating at the start, its results, and its standing, all public.`);
        expect(games).toContain(`Games and ratings are kept as the public record.`);
        expect(section(`Your account and public name`).textContent).toContain(`It is kept until it is deleted.`);
        expect(section(`Your account and public name`).textContent).toContain(`Your public player page shows your rating and its history, your record, and the opponents you met most.`);
    });

    it('leave out Discord and the mail provider when the deployment names none', async () => {
        const { mailProvider: _mail, ...rest } = details;
        const { discord: _discord, ...operator } = details.operator;
        serve(ok({ ...rest, operator }));
        const { unmount } = render(<LegalScreen page="imprint" />);
        await screen.findByText(`Ada Beispiel`);
        expect(document.body.textContent).not.toContain(`Discord:`);
        unmount();
        render(<LegalScreen page="privacy" />);
        await screen.findByRole(`heading`, { name: `Who receives data` });
        expect(document.body.textContent).not.toContain(`contact mailbox`);
    });

    it('fill the privacy policy from the details and list its sections with links to each', async () => {
        serve(ok(details));
        render(<LegalScreen page="privacy" />);
        const contents = await screen.findByRole(`navigation`, { name: `On this page` });
        const entries = within(contents).getAllByRole(`link`);
        const sections = [...document.querySelectorAll(`section[id]`)];
        expect(entries.map((entry) => entry.getAttribute(`href`))).toEqual(sections.map((section) => `#${section.id}`));
        expect(entries.map((entry) => entry.textContent)).toEqual(sections.map((section) => section.querySelector(`h2`)?.textContent));
        const text = document.body.textContent;
        expect(text).toContain(`Example Hosting GmbH, Serverstrasse 1, 54321 Rechenburg, Germany, hosts the server under a data processing agreement (Art. 28 GDPR); the server stands in Rechenburg, Germany.`);
        expect(text).toContain(`Example Mail AG, Postfach 3, 22222 Briefstadt, Germany, hosts the contact mailbox.`);
        expect(text).toContain(`Example Authority, Aufsichtsplatz 2, 11111 Landeshausen, Germany, https://authority.example/.`);
        expect(screen.getByRole(`link`, { name: `https://authority.example/` }).getAttribute(`href`)).toBe(`https://authority.example/`);
        // Every processing on a legitimate interest names that interest.
        for (const block of document.querySelectorAll(`.legal-section p`)) {
            if (block.textContent.includes(`Art. 6(1)(f)`) && !block.closest(`#objection`)) expect(block.textContent).toContain(`legitimate interest:`);
        }
        expect(section(`Right to object`).classList.contains(`card`)).toBe(true);
        // Plain sections: the page's landmarks stay the site's own.
        expect(screen.queryAllByRole(`region`)).toHaveLength(0);
    });

    it('state the cookie, its lifetime, the storage keys, and the guest idle window as the code sets them', async () => {
        serve(ok(details));
        render(<LegalScreen page="privacy" />);
        await screen.findByRole(`heading`, { name: `Cookies and browser storage` });
        const storage = section(`Cookies and browser storage`).textContent;
        expect(storage).toContain(`The cookie ${sessionCookieName}, set when you sign in`);
        expect(storage).toContain(`It lasts ${String(sessionMaxAgeSeconds / 86_400)} days after sign-in`);
        expect(storage).toContain(`under ${themeStorageKey}, ${boardSettingsStorageKey}, ${drawerPinnedStorageKey}, and ${playStorageKey}:`);
        expect(section(`Playing as a guest`).textContent).toContain(
            `when you end it or sign in with Discord, when the server restarts, or after ${String(guestIdleSeconds / 3_600)} hours without a request while no game runs.`,
        );
    });

    it('state the request counters against flooding: a keyed hash of the address, in memory, an hour at most', async () => {
        serve(ok(details));
        render(<LegalScreen page="privacy" />);
        await screen.findByRole(`heading`, { name: `Visiting the site` });
        expect(section(`Visiting the site`).textContent).toContain(
            `To limit flooding, the server counts requests under a keyed hash of your IP address (for IPv6, of its first half), held in memory for an hour at most after your last request, or while you watch a game, and never written to disk or to a log; the key is random and replaced every day.`,
        );
    });

    it('state what a sign-in keeps from Discord, for how long, and the first sign-in held until the name is chosen', async () => {
        serve(ok(details));
        render(<LegalScreen page="privacy" />);
        await screen.findByRole(`heading`, { name: `Signing in with Discord` });
        const minutes = String(signupMaxAgeSeconds / 60);
        const days = String(sessionMaxAgeSeconds / 86_400);
        const signIn = section(`Signing in with Discord`).textContent;
        expect(signIn).toContain(
            `HeXO Arena asks Discord only for the identify permission and never receives your email address or password. It keeps your Discord user ID, username, and display name, and discards the rest, such as your avatar and locale.`,
        );
        expect(signIn).toContain(
            `On your first sign-in these are held for up to ${minutes} minutes while you choose your public name, and deleted if you do not create the account. After that, the user ID stays with your account, and your username and display name are kept with each sign-in session, shown only to you, and updated at each sign-in, until you sign out or the session ends after ${days} days.`,
        );
        expect(section(`Your account and public name`).textContent).toContain(
            `You choose your public name when you create your account, starting from your Discord username; it stays fixed when your Discord name changes.`,
        );
        expect(section(`Cookies and browser storage`).textContent).toContain(
            `The cookie ${signupCookieName}, set when a first sign-in returns from Discord: a random reference to the unfinished sign-up, first-party and not readable by scripts. It lasts ${minutes} minutes, or until you create the account or cancel.`,
        );
    });

    it('state deletion by email and the moderation records as they are today', async () => {
        serve(ok(details));
        render(<LegalScreen page="privacy" />);
        await screen.findByRole(`heading`, { name: `Deleting your account` });
        const deletion = section(`Deleting your account`);
        expect(deletion.textContent).toContain(`Write to contact@arena.example and name your account; the operator deletes it within one month.`);
        expect(deletion.textContent).toContain(
            `Your account, sessions, and bots are deleted, and your name becomes free. Your games, and the games of each bot of yours with a game that has a winner, stay in the public record, your name and those bots' names replaced by placeholders such as deleted-12. A bot without a game that has a winner is deleted with its games, yours against it included.`,
        );
        expect(deletion.textContent).toContain(`legitimate interest: keeping your opponents' histories and ratings whole.`);
        expect(deletion.textContent).toContain(`Nothing the site shows links a placeholder to you; the operator's record of the deletion keeps your name.`);
        expect(section(`Moderation records`).textContent).toContain(
            `The records have no set end yet and keep the name after the account is deleted.`,
        );
    });

    it('run the terms under the operator name and link the privacy policy section on deletion', async () => {
        serve(ok(details));
        render(<LegalScreen page="terms" />);
        expect(await screen.findByText(/run by Ada Beispiel; see the/u)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Impressum / Legal notice` }).getAttribute(`href`)).toBe(`/legal/imprint`);
        expect(screen.getByRole(`link`, { name: `Deleting your account` }).getAttribute(`href`)).toBe(`/legal/privacy#deletion`);
        expect(screen.getByRole(`navigation`, { name: `On this page` })).toBeTruthy();
        expect(section(`Accounts`).textContent).toContain(`You must be at least 16; under 18 you need permission from a parent or guardian.`);
        expect(section(`Moderation`).textContent).toContain(`abort games or take them out of the ratings`);
    });

    it('hold guests to the terms, say what a guest session is, and let a guest stop before changes apply', async () => {
        serve(ok(details));
        render(<LegalScreen page="terms" />);
        await screen.findByRole(`heading`, { name: `Guests` });
        const headings = screen.getAllByRole(`heading`, { level: 2 }).map((heading) => heading.textContent);
        expect(headings.indexOf(`Guests`)).toBe(headings.indexOf(`Accounts`) + 1);
        const guests = section(`Guests`);
        expect(guests.textContent).toBe(
            `GuestsYou can play as a guest, without an account. These terms, the age rule included, apply to guests too. Guest games are unrated and end with the guest session; see Playing as a guest in the Privacy policy. The operator may end a guest session and its games at any time.`,
        );
        expect(within(guests).getByRole(`link`, { name: `Playing as a guest` }).getAttribute(`href`)).toBe(`/legal/privacy#guests`);
        expect(section(`Moderation`).textContent).toContain(`and ban or delete accounts or end guest sessions when these terms or the law are broken`);
        expect(section(`Changes`).textContent).toContain(`If you disagree, you can have your account deleted, or stop playing as a guest, before then.`);
    });

    it('show the error frame with a retry when the details fail, and no text with gaps', async () => {
        serve(() => new Response(`{}`, { status: 404 }));
        render(<LegalScreen page="privacy" />);
        expect(await screen.findByRole(`heading`, { name: `The legal details did not load` })).toBeTruthy();
        expect(document.querySelectorAll(`section`)).toHaveLength(0);
        expect(document.body.textContent).not.toMatch(/[<>[\]]/u);
        serve(ok(details));
        fireEvent.click(screen.getByRole(`button`, { name: `Try again` }));
        await waitFor(() => {
            expect(screen.getByRole(`heading`, { name: `Who is responsible` })).toBeTruthy();
        });
    });

    it('title the tab with the page name', async () => {
        serve(ok(details));
        window.history.pushState(null, ``, `/legal/terms`);
        render(<LegalScreen page="terms" />);
        await waitFor(() => {
            expect(document.title).toBe(`Terms of use - HeXO Arena`);
        });
        window.history.pushState(null, ``, `/`);
    });
});
