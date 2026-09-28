// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { guestIdleSeconds, sessionCookieName, sessionMaxAgeSeconds, type LegalDetails } from '@hexo-arena/contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boardSettingsStorageKey } from '../src/board/board-settings';
import { drawerPinnedStorageKey } from '../src/game/use-drawer';
import { LegalScreen } from '../src/screens/LegalScreen';
import { themeStorageKey } from '../src/theme/themes';

const details: LegalDetails = {
    operator: { name: `Ada Beispiel`, addressLines: [`Musterweg 7`, `12345 Beispielstadt`, `Germany`], email: `contact@arena.example`, discord: `ada_b` },
    host: { name: `Example Hosting GmbH`, addressLines: [`Serverstrasse 1`, `54321 Rechenburg`], serverLocation: `Rechenburg, Germany` },
    supervisoryAuthority: { name: `Example Authority`, addressLines: [`Aufsichtsplatz 2`, `11111 Landeshausen`], url: `https://authority.example/` },
    mailProvider: { name: `Example Mail AG`, addressLines: [`Postfach 3`, `22222 Briefstadt`] },
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
        expect(screen.getByText(`This website is provided, under sec. 18(1) Medienstaatsvertrag and sec. 5 DDG, by:`)).toBeTruthy();
        expect(address.closest(`address`)?.textContent).toBe(`Ada BeispielMusterweg 712345 BeispielstadtGermany`);
        const mail = screen.getAllByRole(`link`, { name: `contact@arena.example` })[0];
        expect(mail?.getAttribute(`href`)).toBe(`mailto:contact@arena.example`);
        expect(screen.getByText(`Discord: ada_b`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Reporting` }).getAttribute(`href`)).toBe(`/legal/terms#reporting`);
        // A short page needs no list of its sections.
        expect(screen.queryByRole(`navigation`)).toBe(null);
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
        expect(text).toContain(`Example Hosting GmbH, Serverstrasse 1, 54321 Rechenburg, hosts the server under a data processing agreement (Art. 28 GDPR); the server stands in Rechenburg, Germany.`);
        expect(text).toContain(`Example Mail AG, Postfach 3, 22222 Briefstadt, hosts the contact mailbox.`);
        expect(text).toContain(`Example Authority, Aufsichtsplatz 2, 11111 Landeshausen, https://authority.example/.`);
        expect(text).toContain(`You must be at least 16 to create an account. If you are under 18, you need permission from a parent or guardian.`);
        const summary = section(`In short`);
        expect(within(summary).getByRole(`link`, { name: `Deleting your account` }).getAttribute(`href`)).toBe(`#deletion`);
        expect(screen.getByRole(`link`, { name: `https://authority.example/` }).getAttribute(`href`)).toBe(`https://authority.example/`);
        expect(section(`Right to object`).classList.contains(`card`)).toBe(true);
        // Plain sections: the page's landmarks stay the site's own.
        expect(screen.queryAllByRole(`region`)).toHaveLength(0);
    });

    it('state the cookie, its lifetime, the storage keys, and the guest idle window as the code sets them', async () => {
        serve(ok(details));
        render(<LegalScreen page="privacy" />);
        await screen.findByRole(`heading`, { name: `Cookie and browser storage` });
        const storage = section(`Cookie and browser storage`).textContent;
        expect(storage).toContain(`The cookie ${sessionCookieName}, set when you sign in`);
        expect(storage).toContain(`It lasts ${String(sessionMaxAgeSeconds / 86_400)} days after sign-in`);
        expect(storage).toContain(`under ${themeStorageKey}, ${boardSettingsStorageKey}, and ${drawerPinnedStorageKey}:`);
        expect(section(`Retention at a glance`).textContent).toContain(`Sessions: ${String(sessionMaxAgeSeconds / 86_400)} days.`);
        expect(section(`Playing as a guest`).textContent).toContain(
            `when you end it or sign in with Discord, when the server restarts, or after ${String(guestIdleSeconds / 3_600)} hours without a request while no game runs.`,
        );
    });

    it('state deletion by email and the moderation records as they are today', async () => {
        serve(ok(details));
        render(<LegalScreen page="privacy" />);
        await screen.findByRole(`heading`, { name: `Deleting your account` });
        const deletion = section(`Deleting your account`);
        expect(deletion.textContent).toContain(`Write to contact@arena.example and name your account; the operator deletes it within one month.`);
        expect(deletion.textContent).toContain(
            `Your account, sessions, and bots are deleted, and your name becomes free. Your games, and the games of each bot of yours that has a game with a winner, stay in the public record, because they are part of your opponents' histories and ratings.`,
        );
        expect(deletion.textContent).toContain(
            `In them your name and those bots' names become placeholders such as deleted-12. A bot without a game with a winner is deleted with its games, including any you played against it.`,
        );
        expect(deletion.textContent).toContain(`Nothing the site shows links a placeholder to you; the operator's record of the deletion keeps your name.`);
        expect(section(`Moderation records`).textContent).toContain(
            `The records have no set end yet, and a record keeps the affected name even after that account is deleted.`,
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
