import { guestIdleSeconds, legalPageNames, sessionCookieName, sessionMaxAgeSeconds, siteName, type LegalDetails } from '@hexo-arena/contract';
import type { ReactNode } from 'react';
import { boardSettingsStorageKey } from '../board/board-settings';
import { drawerPinnedStorageKey } from '../game/use-drawer';
import { botApiRepository } from '../site-links';
import { themeStorageKey } from '../theme/themes';
import type { LegalBlock, LegalLinks, LegalTexts } from './legal';
import { rich } from './rich';

// Every sentence states what the site does today; a page changes with the
// code it describes, and the date with it.

// The age rule both the terms and the privacy policy state.
const minimumAge = 16;
const permissionUntil = 18;

const sessionDays = sessionMaxAgeSeconds / 86_400;
const guestIdleHours = guestIdleSeconds / 3_600;

const text = (words: ReactNode): LegalBlock => ({ kind: `text`, text: words });
const list = (...items: ReactNode[]): LegalBlock => ({ kind: `list`, items });
const address = (lines: readonly string[]): LegalBlock => ({ kind: `address`, lines });

// One line per place, as a sentence names it: name, then its address.
function place(entry: { readonly name: string; readonly addressLines: readonly string[] }): string {
    return [entry.name, ...entry.addressLines].join(`, `);
}

function imprint(details: LegalDetails, links: LegalLinks) {
    const { operator } = details;
    return {
        sections: [
            {
                id: `provider`,
                heading: `Provider`,
                blocks: [
                    text(`This website is provided, under sec. 18(1) Medienstaatsvertrag and sec. 5 DDG, by:`),
                    address([operator.name, ...operator.addressLines]),
                    text(`${siteName} is a private, non-commercial hobby project. It shows no ads and charges nothing.`),
                ],
            },
            {
                id: `contact`,
                heading: `Contact`,
                blocks: [
                    text(rich`Email: ${links.mail(operator.email)}`),
                    ...(operator.discord === undefined ? [] : [text(`Discord: ${operator.discord}`)]),
                    text(`You can write in English or German.`),
                ],
            },
            {
                id: `reporting`,
                heading: `Reporting content`,
                blocks: [
                    text(
                        rich`Report unlawful content or abuse to ${links.mail(operator.email)}; ${links.page(`terms`, `Reporting`, `reporting`)} in the Terms of use says what to include.`,
                    ),
                ],
            },
        ],
    };
}

function privacy(details: LegalDetails, links: LegalLinks) {
    const { operator, host, supervisoryAuthority: authority, mailProvider } = details;
    const email = () => links.mail(operator.email);
    const see = (id: string, words: string) => links.page(`privacy`, words, id);
    return {
        sections: [
            {
                id: `responsible`,
                heading: `Who is responsible`,
                blocks: [
                    address([operator.name, ...operator.addressLines]),
                    text(rich`Email: ${email()}`),
                    text(`${siteName} is a private, non-commercial hobby project run by one person. No data protection officer is required or appointed.`),
                ],
            },
            {
                id: `summary`,
                heading: `In short`,
                blocks: [
                    list(
                        `No ads, no analytics, no tracking, nothing sold. Every file, the font included, comes from this server.`,
                        `You sign in with Discord. ${siteName} keeps your Discord user ID and a public name made from your Discord username; it never receives your email address or password.`,
                        `${siteName} is a public arena: names, bots, games, and ratings are visible to everyone, and anyone can watch live games.`,
                        rich`You can have your account deleted at any time; see ${see(`deletion`, `Deleting your account`)}.`,
                    ),
                ],
            },
            {
                id: `visiting`,
                heading: `Visiting the site`,
                blocks: [
                    text(
                        `When you open a page, your browser sends the server your IP address and technical data such as the page's address, the time, and the browser type. The server needs these to deliver the page and to protect the service. The web server keeps no access log. The application log records the route called, the status, and errors, without IP addresses or names, and is rotated by size.`,
                    ),
                    text(`Legal basis: Art. 6(1)(f) GDPR; the legitimate interest is delivering the site and keeping it secure.`),
                ],
            },
            {
                id: `sign-in`,
                heading: `Signing in with Discord`,
                blocks: [
                    text(
                        rich`The sign-in button takes you to Discord. What happens there is governed by ${links.external(`https://discord.com/privacy`, `Discord's privacy policy`)}.`,
                    ),
                    text(
                        `${siteName} asks Discord only for the identify permission. Discord then sends your Discord user ID, your username, and a few profile fields such as display name, avatar, and locale. ${siteName} stores only the user ID and a public name made once from your username; everything else is discarded at once.`,
                    ),
                    text(`Discord (in the EEA, Discord Netherlands BV) is a separate controller and does not act for ${siteName}.`),
                    text(`Legal basis: Art. 6(1)(b) GDPR. The data comes from Discord (Art. 14(2)(f) GDPR).`),
                ],
            },
            {
                id: `name`,
                heading: `Your account and public name`,
                blocks: [
                    text(
                        `Your public name shows on the ladder, in your games, on your bots' pages, and in link previews. It is fixed when your account is created and does not follow later changes on Discord.`,
                    ),
                    text(`Legal basis: Art. 6(1)(b) GDPR, and Art. 6(1)(f) GDPR for showing results in a public competition, which is the purpose of the site.`),
                ],
            },
            {
                id: `bots`,
                heading: `Bots`,
                blocks: [
                    text(
                        `For each bot, ${siteName} stores its name, the about text, version, and repository link you give it, the clocks it accepts, and its token. The token is stored only as a cryptographic hash. The name, about text, version, repository link, and your name as its owner are public.`,
                    ),
                    text(`Legal basis: Art. 6(1)(b) GDPR.`),
                ],
            },
            {
                id: `games`,
                heading: `Games and ratings`,
                blocks: [
                    text(
                        `${siteName} stores every game except guest games: the players, the moves with their times, the clock, the result, and the ratings that follow from the games. Games are public, and anyone can watch them live. Ratings are calculated automatically from the game record; they have no legal or similarly significant effect on you, so no automated decision under Art. 22 GDPR is made.`,
                    ),
                    text(`Legal basis: Art. 6(1)(b) and (f) GDPR.`),
                ],
            },
            {
                id: `guests`,
                heading: `Playing as a guest`,
                blocks: [
                    text(
                        `A guest gets a random label, "Guest" and four characters, and a session cookie. Guest games stay in the server's memory and are never written to the database. They are gone when the guest session ends: when you end it or sign in with Discord, when the server restarts, or after ${String(guestIdleHours)} hours without a request while no game runs.`,
                    ),
                    text(`Legal basis: Art. 6(1)(b) GDPR.`),
                ],
            },
            {
                id: `storage`,
                heading: `Cookie and browser storage`,
                blocks: [
                    list(
                        `The cookie ${sessionCookieName}, set when you sign in or start playing as a guest: a random session reference, first-party and not readable by scripts. It lasts ${String(sessionDays)} days after sign-in, or until you close the browser for a guest.`,
                        `Browser storage (localStorage) under ${themeStorageKey}, ${boardSettingsStorageKey}, and ${drawerPinnedStorageKey}: your theme, your board settings, and whether the game panel stays pinned. It is written only when you change a setting and is never sent to the server.`,
                    ),
                    text(
                        `These are strictly necessary for functions you ask for (sec. 25(2) no. 2 TDDDG), so no consent is needed and there is no cookie banner. You can delete them at any time in your browser settings.`,
                    ),
                ],
            },
            {
                id: `moderation`,
                heading: `Moderation records`,
                blocks: [
                    text(
                        `When the operator acts on an account, a bot, or a game, or pauses the site, the action, the affected name if there is one, a reason, and the time are recorded. The records have no set end yet, and a record keeps the affected name even after that account is deleted.`,
                    ),
                    text(
                        `Legal basis: Art. 6(1)(f) GDPR; the legitimate interest is fair, documented moderation and defending against claims (Art. 17(3)(e) GDPR).`,
                    ),
                ],
            },
            {
                id: `backups`,
                heading: `Backups`,
                blocks: [
                    text(
                        `A copy of the database is made every night and kept for 14 days; copies kept off the server are encrypted and also kept for at most 14 days. Deleted data therefore leaves every backup within 14 days.`,
                    ),
                    text(`Legal basis: Art. 6(1)(f) GDPR; the legitimate interest is keeping the service available.`),
                ],
            },
            {
                id: `deletion`,
                heading: `Deleting your account`,
                blocks: [
                    text(rich`Write to ${email()} and name your account; the operator deletes it within one month.`),
                    text(
                        `Your account, sessions, and bots are deleted, and your name becomes free. Your games, and the games of each bot of yours that has a game with a winner, stay in the public record, because they are part of your opponents' histories and ratings. In them your name and those bots' names become placeholders such as deleted-12. A bot without a game with a winner is deleted with its games, including any you played against it.`,
                    ),
                    text(`Nothing the site shows links a placeholder to you; the operator's record of the deletion keeps your name.`),
                    text(rich`Legal basis for keeping the games: Art. 6(1)(f) GDPR; you can object, see ${see(`objection`, `Right to object`)}.`),
                ],
            },
            {
                id: `contact`,
                heading: `Writing to the operator`,
                blocks: [
                    text(
                        `If you write, your email address, name, and message are used to answer you or to handle your report, and are deleted 12 months after the matter is closed.`,
                    ),
                    text(`Legal basis: Art. 6(1)(b) or (f) GDPR.`),
                ],
            },
            {
                id: `recipients`,
                heading: `Who receives data`,
                blocks: [
                    list(
                        `The public: everything this policy describes as public.`,
                        `${place(host)}, hosts the server under a data processing agreement (Art. 28 GDPR); the server stands in ${host.serverLocation}.`,
                        ...(mailProvider === undefined ? [] : [`${place(mailProvider)}, hosts the contact mailbox.`]),
                    ),
                    text(`Nobody else receives data, nothing is sold, and ${siteName} itself transfers no data outside the EU.`),
                ],
            },
            {
                id: `retention`,
                heading: `Retention at a glance`,
                blocks: [
                    list(
                        `Account and bots: until deletion.`,
                        `Sessions: ${String(sessionDays)} days.`,
                        `Guest data: in memory only.`,
                        `Games: kept as the public record, under a placeholder after account deletion.`,
                        `Moderation records: no set end yet.`,
                        `Backups: 14 days.`,
                        `Messages to the operator: 12 months after the matter is closed.`,
                    ),
                ],
            },
            {
                id: `rights`,
                heading: `Your rights`,
                blocks: [
                    text(
                        rich`You have the right of access (Art. 15), rectification (Art. 16), erasure (Art. 17), restriction (Art. 18), data portability (Art. 20), and objection (Art. 21 GDPR). Write to ${email()}; you get an answer within one month.`,
                    ),
                    text(
                        rich`You may also complain to a data protection authority, for example the one responsible for ${siteName}: ${place(authority)}, ${links.external(authority.url, authority.url)}.`,
                    ),
                ],
            },
            {
                id: `objection`,
                heading: `Right to object`,
                standout: true,
                blocks: [
                    text(
                        `Where processing rests on Art. 6(1)(f) GDPR, as public display, moderation records, and backups do, you may object at any time on grounds relating to your particular situation. The processing then stops, unless compelling legitimate grounds override your interests or it serves legal claims.`,
                    ),
                ],
            },
            {
                id: `required`,
                heading: `Do you have to provide data?`,
                blocks: [
                    text(
                        `No law requires it. Without the Discord sign-in you cannot have an account or own bots; you can still watch games and play as a guest.`,
                    ),
                ],
            },
            {
                id: `age`,
                heading: `Age`,
                blocks: [
                    text(
                        `You must be at least ${String(minimumAge)} to create an account. If you are under ${String(permissionUntil)}, you need permission from a parent or guardian.`,
                    ),
                ],
            },
            {
                id: `changes`,
                heading: `Changes`,
                blocks: [text(`This policy changes when the site changes; its date shows the current version.`)],
            },
        ],
    };
}

function terms(details: LegalDetails, links: LegalLinks) {
    const { operator } = details;
    return {
        sections: [
            {
                id: `service`,
                heading: `The service`,
                blocks: [
                    text(
                        rich`${siteName} is a free, non-commercial hobby project run by ${operator.name}; see the ${links.page(`imprint`, `Impressum / Legal notice`)}. There is no right to any particular feature or to availability, and the service may change or end at any time.`,
                    ),
                ],
            },
            {
                id: `accounts`,
                heading: `Accounts`,
                blocks: [
                    text(
                        `You sign in with Discord. You must be at least ${String(minimumAge)}; under ${String(permissionUntil)} you need permission from a parent or guardian. One person, one account. Keep your bot tokens secret; you are responsible for what your bots do.`,
                    ),
                ],
            },
            {
                id: `fair-play`,
                heading: `Fair play`,
                blocks: [
                    text(
                        rich`Bots follow the published ${links.external(botApiRepository, `Bot API`)} and its limits. Do not attack or overload the service, do not use several accounts to raise ratings, and do not let a bot or another person play for you in games you play yourself.`,
                    ),
                ],
            },
            {
                id: `names`,
                heading: `Names and texts`,
                blocks: [
                    text(
                        `Names, bot names, about texts, and repository links must not be unlawful, hateful, harassing, sexual, misleading, or impersonating, must not infringe the rights of others, and must not advertise.`,
                    ),
                    text(
                        `By entering a text you grant ${operator.name} a free, non-exclusive, worldwide right to store, show, shorten, and make it available on the site and through its public API for as long as it is stored, and you confirm that you may grant this right.`,
                    ),
                ],
            },
            {
                id: `public`,
                heading: `Public by design`,
                blocks: [text(`Names, bots, games, and ratings are public. Anyone may watch the games and study their records.`)],
            },
            {
                id: `moderation`,
                heading: `Moderation`,
                blocks: [
                    text(
                        `The operator may delist bots, revoke their tokens, abort games or take them out of the ratings, and ban or delete accounts when these terms or the law are broken, or to protect the service. Decisions are made by a person, not automatically. You are told the reason unless that is impossible, and you can contest a decision by email; it is then reviewed.`,
                    ),
                ],
            },
            {
                id: `reporting`,
                heading: `Reporting`,
                blocks: [
                    text(
                        rich`Report unlawful content or abuse to ${links.mail(operator.email)}. Give the link, what is wrong and why, and your name and email address. You get a confirmation and a decision. In an emergency, call the police first.`,
                    ),
                ],
            },
            {
                id: `ratings`,
                heading: `Ratings`,
                blocks: [text(`Ratings come from a formula and are not guaranteed to be correct.`)],
            },
            {
                id: `liability`,
                heading: `Liability`,
                blocks: [
                    text(
                        `${siteName} is free. The operator is liable without limit for intent and gross negligence, for injury to life, body, or health, and under the Product Liability Act. For slight negligence the operator is liable only for breach of an obligation essential to the service, limited to the damage typical and foreseeable for a free service of this kind; otherwise there is no liability for slight negligence.`,
                    ),
                ],
            },
            {
                id: `ending`,
                heading: `Ending`,
                blocks: [
                    text(
                        rich`You can have your account deleted at any time; see ${links.page(`privacy`, `Deleting your account`, `deletion`)} in the Privacy policy. The operator may end an account for breach of these terms, or end the service with notice on the site.`,
                    ),
                ],
            },
            {
                id: `changes`,
                heading: `Changes`,
                blocks: [
                    text(
                        `Changes take effect 30 days after they are published on this page, whose date shows the current version. If you disagree, you can have your account deleted before they take effect.`,
                    ),
                ],
            },
            {
                id: `law`,
                heading: `Law`,
                blocks: [text(`German law applies.`)],
            },
        ],
    };
}

/** The legal pages in English. */
export const legalEn: LegalTexts = {
    names: legalPageNames,
    pages: { imprint, privacy, terms },
    updated: `Last updated 28 September 2026`,
    onThisPage: `On this page`,
    failed: `The legal details did not load`,
};
