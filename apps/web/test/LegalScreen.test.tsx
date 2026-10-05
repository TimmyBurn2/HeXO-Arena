// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
    guestIdleSeconds,
    oauthCookieName,
    oauthMaxAgeSeconds,
    secureSessionCookieName,
    sessionMaxAgeSeconds,
    signupCookieName,
    signupMaxAgeSeconds,
} from '@hexo-arena/contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analysisSettingsStorageKey, analysisStorageKey } from '../src/analysis/storage-key';
import { boardSettingsStorageKey } from '../src/board/board-settings';
import { drawerPinnedStorageKey } from '../src/game/use-drawer';
import { legalStore } from '../src/legal/documents';
import { playStorageKey } from '../src/play/setup';
import { reportForm } from '../src/report-form';
import { LegalScreen } from '../src/screens/LegalScreen';
import { themeStorageKey } from '../src/theme/themes';
import { deploy, details, template } from './legal-deploy';

// A section of the page, found by its heading.
function section(heading: string): HTMLElement {
    const found = screen.getByRole(`heading`, { level: 2, name: heading }).closest(`section`);
    if (found === null) throw new Error(`no section headed ${heading}`);
    return found;
}

// The lines of a paragraph broken by line breaks, as an address is.
function lines(paragraph: Element | null | undefined): string[] {
    return [...(paragraph?.childNodes ?? [])].filter((node) => node.nodeName !== `BR`).map((node) => node.textContent ?? ``);
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    legalStore.reset();
});

describe('LegalScreen', () => {
    it('name the operator in the imprint with an address, a written-out mail link, and Discord beside it', async () => {
        deploy(details);
        render(<LegalScreen page="imprint" />);
        expect(screen.getByRole(`heading`, { level: 1, name: `Impressum / Legal notice` })).toBeTruthy();
        await screen.findByRole(`heading`, { level: 2, name: `Provider` });
        expect(screen.getByText(`Last updated 2 October 2026`).closest(`header`)).toBeTruthy();
        const provider = section(`Provider`);
        expect(provider.querySelector(`p`)?.textContent).toBe(`Under sec. 18(1) Medienstaatsvertrag and sec. 5 DDG:`);
        expect(lines(provider.querySelectorAll(`p`)[1])).toEqual([`Ada Beispiel`, `Musterweg 7`, `12345 Beispielstadt`, `Germany`]);
        const mail = screen.getAllByRole(`link`, { name: `contact@arena.example` })[0];
        expect(mail?.getAttribute(`href`)).toBe(`mailto:contact@arena.example`);
        expect(screen.getByText(`Discord: ada_b`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Reporting` }).getAttribute(`href`)).toBe(`/legal/terms#reporting`);
        expect(screen.getByRole(`link`, { name: `report form` }).getAttribute(`href`)).toBe(`/report`);
        // A short page needs no list of its sections.
        expect(screen.queryByRole(`navigation`)).toBe(null);
    });

    it('say what the ladder, the game search, and the bot list make public, and what challenges and bot deletion keep', async () => {
        deploy(details);
        render(<LegalScreen page="privacy" />);
        await screen.findByRole(`navigation`, { name: `On this page` });
        expect(section(`Your account and public name`).textContent).toContain(
            `anyone can search the games by it, which shows your results and your record against each opponent.`,
        );
        const games = section(`Games and ratings`).textContent;
        expect(games).toContain(`stores every game, guest games included:`);
        expect(games).toContain(`each rated player's rating before and after. Games, ratings, and the rating history are public`);
        expect(games).toContain(`each player's rating, rated games played, and when the last one finished`);
        const bots = section(`Bots`);
        expect(bots.textContent).toContain(`whether the bot is connected, whether it is open to challenges, and how many games it is playing`);
        expect(bots.textContent).toContain(`These records are not public, count toward the daily challenge limits, and are deleted 90 days after the challenge was sent.`);
        expect(bots.textContent).toContain(`for the challenge records, Art. 6(1)(f) GDPR, legitimate interest: enforcing fair challenge limits.`);
        expect(within(bots).getByRole(`link`, { name: `Deleting your account` }).getAttribute(`href`)).toBe(`#deleting-your-account`);
        expect(document.getElementById(`deleting-your-account`)?.querySelector(`h2`)?.textContent).toBe(`Deleting your account`);
        // Every kind of data says how long it is kept.
        expect(bots.textContent).toContain(`A bot is kept until you delete it.`);
        expect(bots.textContent).toContain(`A bot you enter in a tournament is listed there with you as its owner, its rating at the start, its results, and its standing, all public.`);
        expect(games).toContain(`Games and ratings are kept as the public record.`);
        expect(section(`Your account and public name`).textContent).toContain(`It is kept until it is deleted.`);
        expect(section(`Your account and public name`).textContent).toContain(`Your public player page shows your rating and its history, your record, and the opponents you met most.`);
    });

    it('say that the Feedback link leads to GitHub, a separate controller, where posts are public, and that data requests go to the operator', async () => {
        deploy(details);
        render(<LegalScreen page="privacy" />);
        await screen.findByRole(`navigation`, { name: `On this page` });
        const feedback = section(`Feedback on GitHub`);
        expect(within(feedback).getByRole(`link`, { name: `GitHub's privacy statement` }).getAttribute(`href`)).toBe(
            `https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement`,
        );
        expect(feedback.textContent).toContain(`GitHub (GitHub, Inc. or GitHub B.V.) is a separate controller.`);
        expect(feedback.textContent).toContain(`What you post there, such as an issue or a comment, is public under your GitHub name.`);
        expect(feedback.textContent).toContain(`Requests about your data go to the operator, never into a public issue;`);
    });

    it('leave out Discord and the mail provider when the deployment names none', async () => {
        const { mailProvider: _mail, ...rest } = details;
        const { discord: _discord, ...operator } = details.operator;
        deploy({ ...rest, operator });
        const { unmount } = render(<LegalScreen page="imprint" />);
        await screen.findByRole(`heading`, { name: `Contact` });
        expect(document.body.textContent).not.toContain(`Discord:`);
        expect(section(`Contact`).querySelectorAll(`p`)).toHaveLength(2);
        unmount();
        render(<LegalScreen page="privacy" />);
        await screen.findByRole(`heading`, { name: `Who receives data` });
        expect(document.body.textContent).not.toContain(`contact mailbox`);
        expect(section(`Who receives data`).querySelectorAll(`li`)).toHaveLength(2);
    });

    it('leave out the server location and name no authority when the deployment gives neither, keeping the right to complain', async () => {
        const { supervisoryAuthority: _authority, ...rest } = details;
        const { serverLocation: _location, ...host } = details.host;
        deploy({ ...rest, host });
        render(<LegalScreen page="privacy" />);
        await screen.findByRole(`heading`, { name: `Who receives data` });
        const recipients = section(`Who receives data`);
        expect(recipients.querySelectorAll(`li`)).toHaveLength(3);
        expect(recipients.textContent).toContain(`Example Hosting GmbH, Serverstrasse 1, 54321 Rechenburg, Germany, hosts the server under a data processing agreement (Art. 28 GDPR).`);
        expect(recipients.textContent).not.toContain(`stands in`);
        const rights = section(`Your rights`);
        expect(rights.textContent).toContain(`You may complain to a supervisory authority, in particular where you live or work or where the law was broken (Art. 77 GDPR).`);
        expect(rights.textContent).not.toContain(`authority responsible`);
        expect(document.body.textContent).not.toMatch(/\{\{|\}\}/u);
    });

    it('open every document with a note to the operator on the law it was written for, which the page never shows', async () => {
        const writtenFor = {
            imprint: `Written for an operator in Germany, whose law requires this notice.`,
            privacy: `Written for an operator in the EU, under the GDPR.`,
            terms: `Written for an operator in the EU; its law and liability clauses follow German law.`,
        } as const;
        for (const page of [`imprint`, `privacy`, `terms`] as const) {
            const note = /^<!--\n([^]*?)\n-->\n\n# /u.exec(template(page))?.[1];
            expect(note?.split(`\n`)).toEqual([writtenFor[page], `Adapt this document to your law, or delete it.`, `The site never shows this note.`]);
            deploy(details);
            const { unmount } = render(<LegalScreen page={page} />);
            await screen.findAllByRole(`heading`, { level: 2 });
            expect(document.body.textContent).not.toContain(`Adapt this document`);
            unmount();
        }
    });

    it('name the operator and a mail link in the privacy policy when the deployment gives no postal address', async () => {
        const { street: _street, postcodeAndCity: _city, country: _country, ...operator } = details.operator;
        deploy({ ...details, operator });
        render(<LegalScreen page="privacy" />);
        await screen.findByRole(`heading`, { name: `Who is responsible` });
        const responsible = section(`Who is responsible`);
        expect(lines(responsible.querySelector(`p`))).toEqual([`Ada Beispiel`]);
        expect(within(responsible).getByRole(`link`, { name: `contact@arena.example` }).getAttribute(`href`)).toBe(`mailto:contact@arena.example`);
        expect(document.body.textContent).not.toContain(`Musterweg`);
    });

    it('fill the privacy policy from the details and list its sections with links to each', async () => {
        deploy(details);
        render(<LegalScreen page="privacy" />);
        const contents = await screen.findByRole(`navigation`, { name: `On this page` });
        const entries = within(contents).getAllByRole(`link`);
        const sections = [...document.querySelectorAll(`section[id]`)];
        expect(entries.map((entry) => entry.getAttribute(`href`))).toEqual(sections.map((section) => `#${section.id}`));
        expect(entries.map((entry) => entry.textContent)).toEqual(sections.map((section) => section.querySelector(`h2`)?.textContent));
        const text = document.body.textContent;
        expect(text).toContain(`Example Hosting GmbH, Serverstrasse 1, 54321 Rechenburg, Germany, hosts the server under a data processing agreement (Art. 28 GDPR).`);
        expect(text).toContain(`Example Mail AG, Postfach 3, 22222 Briefstadt, Germany, hosts the contact mailbox.`);
        expect(section(`Who receives data`).textContent).toContain(`The server stands in Rechenburg, Germany.`);
        expect(text).toContain(`The authority responsible for HeXO Arena is Example Authority, Aufsichtsplatz 2, 11111 Landeshausen, Germany, https://authority.example/.`);
        expect(screen.getByRole(`link`, { name: `https://authority.example/` }).getAttribute(`href`)).toBe(`https://authority.example/`);
        expect(text).not.toMatch(/\{\{|\}\}/u);
        // Every processing on a legitimate interest names that interest.
        for (const block of document.querySelectorAll(`.legal-section p`)) {
            if (block.textContent.includes(`Art. 6(1)(f)`) && !block.closest(`#right-to-object`)) expect(block.textContent).toContain(`legitimate interest:`);
        }
        expect(section(`Right to object`).classList.contains(`card`)).toBe(true);
        expect(section(`Right to object`).querySelector(`blockquote`)).toBe(null);
        // Plain sections: the page's landmarks stay the site's own.
        expect(screen.queryAllByRole(`region`)).toHaveLength(0);
    });

    it('state the cookie, its lifetime, the storage keys, and the guest idle window as the code sets them', async () => {
        deploy(details);
        render(<LegalScreen page="privacy" />);
        await screen.findByRole(`heading`, { name: `Cookies and browser storage` });
        const storage = section(`Cookies and browser storage`).textContent;
        expect(storage).toContain(`The cookie ${secureSessionCookieName}, set when you sign in`);
        expect(storage).toContain(`It lasts ${String(sessionMaxAgeSeconds / 86_400)} days after sign-in`);
        expect(storage).toContain(`The cookie ${oauthCookieName}, set when you start a sign-in with Discord`);
        expect(storage).toContain(`It lasts ${String(oauthMaxAgeSeconds / 60)} minutes, or until Discord sends you back.`);
        expect(storage).toContain(`under ${themeStorageKey}, ${boardSettingsStorageKey}, ${drawerPinnedStorageKey}, ${playStorageKey}, and ${analysisSettingsStorageKey}:`);
        expect(storage).toContain(`Session storage (sessionStorage) under ${analysisStorageKey}: the turns and variations on the analysis board`);
        expect(section(`Playing as a guest`).textContent).toContain(
            `when you end it or sign in with Discord, when the server restarts, or after ${String(guestIdleSeconds / 3_600)} hours without a request while no game runs.`,
        );
    });

    it('state the request counters against flooding: a keyed hash of the address, in memory, an hour at most', async () => {
        deploy(details);
        render(<LegalScreen page="privacy" />);
        await screen.findByRole(`heading`, { name: `Visiting the site` });
        expect(section(`Visiting the site`).textContent).toContain(
            `To limit flooding, the server counts requests under a keyed hash of your IP address (for IPv6, of its first half), held in memory for an hour at most after your last request, or while you watch a game, and never written to disk or to a log; the key is random and replaced every day.`,
        );
    });

    it('state what a sign-in keeps from Discord, for how long, and the first sign-in held until the name is chosen', async () => {
        deploy(details);
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

    it('state deletion from the profile and by email, the export, the moderation records, and the note a restore reads', async () => {
        deploy(details);
        render(<LegalScreen page="privacy" />);
        await screen.findByRole(`heading`, { name: `Deleting your account` });
        const deletion = section(`Deleting your account`);
        expect(deletion.textContent).toContain(`Use Delete account on your Profile page and type your public name to confirm; the deletion takes effect at once.`);
        expect(deletion.textContent).toContain(`You can also write to contact@arena.example and name your account; the operator deletes it within one month.`);
        expect(deletion.textContent).toContain(
            `Your games, and those of each bot of yours that won or lost a game against an account or a bot, or played in a tournament, stay in the public record, where you read as "deleted player" and those bots as "deleted bot".`,
        );
        expect(deletion.textContent).toContain(`legitimate interest: keeping your opponents' histories and ratings whole.`);
        expect(deletion.textContent).toContain(`Nothing the site shows links "deleted player" or "deleted bot" to you, and the operator's moderation records name a placeholder instead of your name.`);
        expect(within(deletion).getByRole(`link`, { name: `Right to object` }).getAttribute(`href`)).toBe(`#right-to-object`);
        const moderation = section(`Moderation records`).textContent;
        expect(moderation).toContain(`The records are kept for the rest of the year of the action and the 3 calendar years after it, then deleted.`);
        expect(moderation).toContain(`every record naming it or one of its bots names a placeholder instead, such as deleted-12, which only the operator sees.`);
        expect(section(`Backups`).textContent).toContain(`each deletion is also noted, by account ID and time alone, in a file kept apart from the database; after a restore, the account is deleted again.`);
        expect(section(`Your rights`).textContent).toContain(`Download my data on your Profile page hands you, at once, every record of your account and your bots as one file.`);
    });

    it('say what a report stores, who reads it, and when it goes', async () => {
        deploy(details);
        render(<LegalScreen page="privacy" />);
        await screen.findByRole(`heading`, { name: `Reports` });
        const reports = section(`Reports`).textContent;
        expect(reports).toContain(`A report stores the page address, the reason and description you give, your name and email address if you give them, your statement that the report is accurate and in good faith, and the time.`);
        expect(reports).toContain(`It is not linked to your account, even when you are signed in.`);
        expect(reports).toContain(`a report is deleted 12 months after the operator closes it.`);
        expect(within(section(`Reports`)).getByRole(`link`, { name: `report form` }).getAttribute(`href`)).toBe(`/report`);
        expect(section(`Playing as a guest`).textContent).toContain(
            `Guest games are unrated and join the public record like every other game, shown and kept under the random label, which is all a game keeps of a guest`,
        );
    });

    it('name the report form and its page in the privacy policy, the terms, and the imprint only where the deployment takes reports through it', async () => {
        deploy(details);
        render(<LegalScreen page="terms" />);
        await screen.findByRole(`heading`, { name: `Reporting` });
        expect(section(`Reporting`).textContent).toContain(`Report unlawful content or abuse with the report form, linked at the foot of every page, or write to contact@arena.example`);
        cleanup();
        render(<LegalScreen page="imprint" />);
        await screen.findByRole(`heading`, { name: `Reporting content` });
        expect(within(section(`Reporting content`)).getByRole(`link`, { name: `report form` }).getAttribute(`href`)).toBe(`/report`);
        cleanup();
        reportForm.reset(false);
        render(<LegalScreen page="privacy" />);
        await screen.findByRole(`heading`, { name: `Writing to the operator` });
        expect(screen.queryByRole(`heading`, { name: `Reports` })).toBe(null);
        expect(within(screen.getByRole(`navigation`, { name: `On this page` })).queryByRole(`link`, { name: `Reports` })).toBe(null);
        expect(section(`Writing to the operator`).textContent).toContain(`used to answer you or to handle your report`);
        expect(screen.queryByRole(`link`, { name: `report form` })).toBe(null);
        expect(document.body.textContent).not.toContain(`{{`);
        cleanup();
        render(<LegalScreen page="terms" />);
        await screen.findByRole(`heading`, { name: `Reporting` });
        expect(section(`Reporting`).textContent).toBe(
            `ReportingReport unlawful content or abuse by writing to contact@arena.example with the link and what is wrong and why. You get a confirmation, and a decision where you leave an email address. In an emergency, call the police first.`,
        );
        expect(within(section(`Reporting`)).getByRole(`link`, { name: `contact@arena.example` }).getAttribute(`href`)).toBe(`mailto:contact@arena.example`);
        cleanup();
        render(<LegalScreen page="imprint" />);
        await screen.findByRole(`heading`, { name: `Reporting content` });
        expect(section(`Reporting content`).textContent).toBe(`Reporting contentReport unlawful content or abuse to contact@arena.example; Reporting in the Terms of use says what to include.`);
        expect(screen.queryByRole(`link`, { name: `report form` })).toBe(null);
    });

    it('run the terms under the operator name and email, needing no Impressum, and link the privacy policy section on deletion', async () => {
        deploy(details);
        render(<LegalScreen page="terms" />);
        expect(await screen.findByText(/run by Ada Beispiel, reachable at/u)).toBeTruthy();
        expect(within(section(`The service`)).getByRole(`link`, { name: `contact@arena.example` }).getAttribute(`href`)).toBe(`mailto:contact@arena.example`);
        expect(template(`terms`)).not.toContain(`/legal/imprint`);
        expect(screen.getByRole(`link`, { name: `Deleting your account` }).getAttribute(`href`)).toBe(`/legal/privacy#deleting-your-account`);
        expect(screen.getByRole(`link`, { name: `Bot API` }).getAttribute(`href`)).toBe(`https://github.com/TimmyBurn2/Hexo-Bot-Api`);
        expect(screen.getByRole(`navigation`, { name: `On this page` })).toBeTruthy();
        expect(section(`Accounts`).textContent).toContain(`You must be at least 16; under 18 you need permission from a parent or guardian.`);
        expect(section(`Moderation`).textContent).toContain(`abort games or take them out of the ratings`);
    });

    it('hold guests to the terms, say what a guest session is, and let a guest stop before changes apply', async () => {
        deploy(details);
        render(<LegalScreen page="terms" />);
        await screen.findByRole(`heading`, { name: `Guests` });
        const headings = screen.getAllByRole(`heading`, { level: 2 }).map((heading) => heading.textContent);
        expect(headings.indexOf(`Guests`)).toBe(headings.indexOf(`Accounts`) + 1);
        const guests = section(`Guests`);
        expect(guests.textContent).toBe(
            `GuestsYou can play as a guest, without an account. These terms, the age rule included, apply to guests too. Guest games are unrated and stay in the public record under the guest's label; see Playing as a guest in the Privacy policy. The operator may end a guest session and its live games at any time.`,
        );
        expect(within(guests).getByRole(`link`, { name: `Playing as a guest` }).getAttribute(`href`)).toBe(`/legal/privacy#playing-as-a-guest`);
        expect(section(`Moderation`).textContent).toContain(`and ban or delete accounts or end guest sessions when these terms or the law are broken`);
        expect(section(`Changes`).textContent).toContain(`If you disagree, you can delete your account, or stop playing as a guest, before then.`);
        expect(within(section(`Reporting`)).getByRole(`link`, { name: `report form` }).getAttribute(`href`)).toBe(`/report`);
    });

    it('hold the title and a placeholder frame until the documents are read, never text with gaps', () => {
        legalStore.reset();
        render(<LegalScreen page="privacy" />);
        expect(screen.getByRole(`heading`, { level: 1, name: `Privacy policy` })).toBeTruthy();
        expect(document.querySelectorAll(`section`)).toHaveLength(0);
        expect(document.querySelector(`.skeleton`)).toBeTruthy();
    });

    it('show a document the deployment lacks as a page that is not there, and one naming details while they are missing', async () => {
        deploy(details, { terms: null });
        const { unmount } = render(<LegalScreen page="terms" />);
        expect(await screen.findByRole(`heading`, { level: 1, name: `Not found` })).toBeTruthy();
        unmount();
        deploy(null);
        render(<LegalScreen page="imprint" />);
        expect(await screen.findByRole(`heading`, { level: 1, name: `Not found` })).toBeTruthy();
        expect(document.body.textContent).not.toMatch(/\{\{/u);
    });

    it('show a document whose read failed as the error frame, and the document once a retry reads it', async () => {
        let up = false;
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) => {
                if (url === `/legal/details.json`) return Promise.resolve(new Response(JSON.stringify(details), { headers: { 'content-type': `application/json` } }));
                if (url === `/legal/terms.md` && up) return Promise.resolve(new Response(template(`terms`), { headers: { 'content-type': `text/markdown` } }));
                return Promise.resolve(new Response(null, { status: url === `/legal/terms.md` ? 500 : 404 }));
            }),
        );
        legalStore.reset();
        legalStore.start();
        render(<LegalScreen page="terms" />);
        expect(await screen.findByRole(`heading`, { level: 2, name: `This document did not load` })).toBeTruthy();
        expect(screen.getByRole(`heading`, { level: 1, name: `Terms of use` })).toBeTruthy();
        up = true;
        fireEvent.click(screen.getByRole(`button`, { name: `Try again` }));
        expect(await screen.findByRole(`heading`, { level: 2, name: `The service` })).toBeTruthy();
    });

    it('leave the words of a link to a document the deployment lacks unlinked, never a way to a missing page', async () => {
        deploy(details, { privacy: null });
        render(<LegalScreen page="terms" />);
        await screen.findByRole(`heading`, { level: 2, name: `Guests` });
        expect(section(`Guests`).textContent).toContain(`see Playing as a guest in the Privacy policy.`);
        expect(screen.queryByRole(`link`, { name: `Playing as a guest` })).toBe(null);
        expect(screen.getByRole(`link`, { name: `Bot API` }).getAttribute(`href`)).toBe(`https://github.com/TimmyBurn2/Hexo-Bot-Api`);
    });

    it('drop raw HTML and images from a deployment\'s own text, and never run them', async () => {
        const ran = vi.fn();
        vi.stubGlobal(`hexoRan`, ran);
        deploy(details, {
            terms: [
                `# Terms of use`,
                ``,
                `## Plain`,
                ``,
                `<script>window.hexoRan()</script>`,
                ``,
                `Inline <b>bold</b> <img src="x" onerror="window.hexoRan()"> and ![a picture](https://elsewhere.example/p.png) [a trap](javascript:window.hexoRan()) here.`,
                ``,
                `<div onclick="window.hexoRan()">a block</div>`,
            ].join(`\n`),
        });
        render(<LegalScreen page="terms" />);
        const plain = await screen.findByRole(`heading`, { level: 2, name: `Plain` });
        const body = plain.closest(`section`);
        expect(body?.textContent).toBe(`PlainInline bold  and  a trap here.`);
        expect(document.querySelectorAll(`script, img, b, div[onclick]`)).toHaveLength(0);
        expect(screen.queryByRole(`link`, { name: `a trap` })).toBe(null);
        expect(ran).not.toHaveBeenCalled();
    });

    it('title the tab with the page name', async () => {
        deploy(details);
        window.history.pushState(null, ``, `/legal/terms`);
        render(<LegalScreen page="terms" />);
        await waitFor(() => {
            expect(document.title).toBe(`Terms of use - HeXO Arena`);
        });
        window.history.pushState(null, ``, `/`);
    });
});
