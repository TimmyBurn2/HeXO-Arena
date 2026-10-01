import {
    addressLines,
    guardianPermissionAge,
    guestIdleSeconds,
    legalPageNames,
    minimumAge,
    sessionCookieName,
    sessionMaxAgeSeconds,
    signupCookieName,
    signupMaxAgeSeconds,
    siteName,
    type LegalDetails,
    type LegalParty,
} from '@hexo-arena/contract';
import type { ReactNode } from 'react';
import { boardSettingsStorageKey } from '../board/board-settings';
import { drawerPinnedStorageKey } from '../game/use-drawer';
import { playStorageKey } from '../play/setup';
import { botApiRepository } from '../site-links';
import { themeStorageKey } from '../theme/themes';
import type { LegalBlock, LegalLinks, LegalTexts } from './legal';
import { rich } from './rich';

// Every sentence states what the site does today; a page changes with the
// code it describes, and the date with it.

const sessionDays = sessionMaxAgeSeconds / 86_400;
const guestIdleHours = guestIdleSeconds / 3_600;
const signupMinutes = signupMaxAgeSeconds / 60;

const text = (words: ReactNode): LegalBlock => ({ kind: `text`, text: words });
const list = (...items: ReactNode[]): LegalBlock => ({ kind: `list`, items });
const address = (party: LegalParty): LegalBlock => ({ kind: `address`, lines: [party.name, ...addressLines(party)] });

// One line per place, as a sentence names it: name, then its address.
function place(party: LegalParty): string {
    return [party.name, ...addressLines(party)].join(`, `);
}

function imprint(details: LegalDetails, links: LegalLinks) {
    const { operator } = details;
    return {
        sections: [
            {
                id: `provider`,
                heading: `Provider`,
                blocks: [text(`Under sec. 18(1) Medienstaatsvertrag and sec. 5 DDG:`), address(operator)],
            },
            {
                id: `contact`,
                heading: `Contact`,
                blocks: [
                    text(rich`Email: ${links.mail(operator.email)}`),
                    ...(operator.discord === undefined ? [] : [text(`Discord: ${operator.discord}`)]),
                    text(`Write in English or German.`),
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
                blocks: [address(operator), text(rich`Email: ${email()}`)],
            },
            {
                id: `visiting`,
                heading: `Visiting the site`,
                blocks: [
                    text(`${siteName} has no ads, analytics, or tracking, and loads every file, the font included, from its own server.`),
                    text(
                        `Your browser sends your IP address and technical data such as the page address, the time, and the browser type, which the server needs to deliver the page. To limit flooding, the server counts requests under a keyed hash of your IP address (for IPv6, of its first half), held in memory for an hour at most after your last request, or while you watch a game, and never written to disk or to a log; the key is random and replaced every day. The web server keeps no access log; the application log records the route, the status, and errors, without IP addresses or names, and is rotated by size.`,
                    ),
                    text(`Legal basis: Art. 6(1)(f) GDPR; legitimate interest: delivering the site and keeping it secure.`),
                ],
            },
            {
                id: `sign-in`,
                heading: `Signing in with Discord`,
                blocks: [
                    text(
                        rich`The sign-in button leads to Discord, where ${links.external(`https://discord.com/privacy`, `Discord's privacy policy`)} applies; Discord (in the EEA, Discord Netherlands BV) is a separate controller.`,
                    ),
                    text(
                        `${siteName} asks Discord only for the identify permission and never receives your email address or password. It keeps your Discord user ID, username, and display name, and discards the rest, such as your avatar and locale.`,
                    ),
                    text(
                        `On your first sign-in these are held for up to ${String(signupMinutes)} minutes while you choose your public name, and deleted if you do not create the account. After that, the user ID stays with your account, and your username and display name are kept with each sign-in session, shown only to you, and updated at each sign-in, until you sign out or the session ends after ${String(sessionDays)} days.`,
                    ),
                    text(`Legal basis: Art. 6(1)(b) GDPR. Source: Discord (Art. 14(2)(f) GDPR).`),
                ],
            },
            {
                id: `name`,
                heading: `Your account and public name`,
                blocks: [
                    text(
                        `You choose your public name when you create your account, starting from your Discord username; it stays fixed when your Discord name changes. It shows on the ladder, in your games, on your bots' pages, and in link previews, and anyone can search the games by it, which shows your results and your record against each opponent.`,
                    ),
                    text(`Your account also records when it was created and, if it is banned, when. It is kept until it is deleted.`),
                    text(`Legal basis: Art. 6(1)(b) GDPR; for showing results, Art. 6(1)(f) GDPR, legitimate interest: running a public competition.`),
                ],
            },
            {
                id: `bots`,
                heading: `Bots`,
                blocks: [
                    text(
                        `For each bot, ${siteName} stores its name, about text, version, repository link, the clocks it accepts, and its token, the token only as a cryptographic hash. All but the token is public, with your name as owner, and so is whether the bot is connected, whether it is open to challenges, and how many games it is playing, which shows when you run it.`,
                    ),
                    text(
                        `Each challenge between bots records both bots, the clock, the opening, the outcome, and the times. These records are not public, count toward the daily challenge limits, and have no set end yet.`,
                    ),
                    text(
                        rich`A bot is kept until you delete it. A bot with a game that has a winner then stays in the public record under a placeholder (see ${see(`deletion`, `Deleting your account`)}); any other bot is deleted with its games and challenges.`,
                    ),
                    text(`Legal basis: Art. 6(1)(b) GDPR; for the challenge records, Art. 6(1)(f) GDPR, legitimate interest: enforcing fair challenge limits.`),
                ],
            },
            {
                id: `games`,
                heading: `Games and ratings`,
                blocks: [
                    text(
                        `${siteName} stores every game except guest games: the players, the moves with their times, the clock, the result, and each player's rating before and after. Games, ratings, and the rating history are public, and anyone can watch games live. The ladder shows each player's rating, rated games played, and when the last one finished; by default it lists only players with a game in the last 30 days.`,
                    ),
                    text(
                        `Games and ratings are kept as the public record. Ratings are calculated automatically from the games and the time since a player's last game; they have no legal or similarly significant effect on you, so no automated decision under Art. 22 GDPR is made.`,
                    ),
                    text(`Legal basis: Art. 6(1)(b) GDPR, and Art. 6(1)(f) GDPR, legitimate interest: running a public competition.`),
                ],
            },
            {
                id: `guests`,
                heading: `Playing as a guest`,
                blocks: [
                    text(
                        `A guest gets a random label, "Guest" and four characters, and a session cookie. Guest games stay in the server's memory, never in the database, and are gone when the guest session ends: when you end it or sign in with Discord, when the server restarts, or after ${String(guestIdleHours)} hours without a request while no game runs.`,
                    ),
                    text(`Legal basis: Art. 6(1)(b) GDPR.`),
                ],
            },
            {
                id: `storage`,
                heading: `Cookies and browser storage`,
                blocks: [
                    list(
                        `The cookie ${sessionCookieName}, set when you sign in or start playing as a guest: a random session reference, first-party and not readable by scripts. It lasts ${String(sessionDays)} days after sign-in, or until you close the browser for a guest.`,
                        `The cookie ${signupCookieName}, set when a first sign-in returns from Discord: a random reference to the unfinished sign-up, first-party and not readable by scripts. It lasts ${String(signupMinutes)} minutes, or until you create the account or cancel.`,
                        `Browser storage (localStorage) under ${themeStorageKey}, ${boardSettingsStorageKey}, ${drawerPinnedStorageKey}, and ${playStorageKey}: your theme, your board settings, whether the game panel stays pinned, and the opponent and clock of your last game. It is written only when you change a setting or start a game, and never sent to the server.`,
                    ),
                    text(`These are strictly necessary for functions you ask for (sec. 25(2) no. 2 TDDDG), so they need no consent. You can delete them in your browser.`),
                ],
            },
            {
                id: `moderation`,
                heading: `Moderation records`,
                blocks: [
                    text(
                        `When the operator acts on an account, a bot, or a game, or pauses the site, the action, the affected name if any, a reason, and the time are recorded. The records have no set end yet and keep the name after the account is deleted.`,
                    ),
                    text(`Legal basis: Art. 6(1)(f) GDPR; legitimate interest: fair, documented moderation and defending legal claims (Art. 17(3)(e) GDPR).`),
                ],
            },
            {
                id: `backups`,
                heading: `Backups`,
                blocks: [
                    text(
                        `A copy of the database is made every night and kept for 14 days; copies off the server are encrypted and kept for at most 14 days. Deleted data leaves every backup within 14 days.`,
                    ),
                    text(`Legal basis: Art. 6(1)(f) GDPR; legitimate interest: keeping the service available.`),
                ],
            },
            {
                id: `deletion`,
                heading: `Deleting your account`,
                blocks: [
                    text(rich`Write to ${email()} and name your account; the operator deletes it within one month.`),
                    text(
                        `Your account, sessions, and bots are deleted, and your name becomes free. Your games, and the games of each bot of yours with a game that has a winner, stay in the public record, your name and those bots' names replaced by placeholders such as deleted-12. A bot without a game that has a winner is deleted with its games, yours against it included.`,
                    ),
                    text(`Nothing the site shows links a placeholder to you; the operator's record of the deletion keeps your name.`),
                    text(
                        rich`Legal basis for keeping the games: Art. 6(1)(f) GDPR; legitimate interest: keeping your opponents' histories and ratings whole. You can object; see ${see(`objection`, `Right to object`)}.`,
                    ),
                ],
            },
            {
                id: `contact`,
                heading: `Writing to the operator`,
                blocks: [
                    text(`If you write, your email address, name, and message are used to answer you or to handle your report, and deleted 12 months after the matter is closed.`),
                    text(`Legal basis: Art. 6(1)(b) GDPR, or Art. 6(1)(f) GDPR, legitimate interest: answering messages and handling reports.`),
                ],
            },
            {
                id: `recipients`,
                heading: `Who receives data`,
                blocks: [
                    list(
                        `The public: everything this policy calls public.`,
                        `${place(host)}, hosts the server under a data processing agreement (Art. 28 GDPR); the server stands in ${host.serverLocation}.`,
                        ...(mailProvider === undefined ? [] : [`${place(mailProvider)}, hosts the contact mailbox.`]),
                    ),
                    text(`Nobody else receives data, and ${siteName} transfers no data outside the EU.`),
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
                        rich`You may complain to a data protection authority, such as the one responsible for ${siteName}: ${place(authority)}, ${links.external(authority.url, authority.url)}.`,
                    ),
                ],
            },
            {
                id: `objection`,
                heading: `Right to object`,
                standout: true,
                blocks: [
                    text(
                        `Where processing rests on Art. 6(1)(f) GDPR, you may object at any time on grounds relating to your particular situation. The processing then stops, unless compelling legitimate grounds override your interests or it serves legal claims.`,
                    ),
                ],
            },
            {
                id: `required`,
                heading: `Do you have to provide data?`,
                blocks: [text(`No law requires it. Without the Discord sign-in you cannot have an account or own bots; you can still watch games and play as a guest.`)],
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
                        `You sign in with Discord. You must be at least ${String(minimumAge)}; under ${String(guardianPermissionAge)} you need permission from a parent or guardian. One person, one account. Keep your bot tokens secret; you are responsible for what your bots do.`,
                    ),
                ],
            },
            {
                id: `guests`,
                heading: `Guests`,
                blocks: [
                    text(
                        rich`You can play as a guest, without an account. These terms, the age rule included, apply to guests too. Guest games are unrated and end with the guest session; see ${links.page(`privacy`, `Playing as a guest`, `guests`)} in the Privacy policy. The operator may end a guest session and its games at any time.`,
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
                        `The operator may delist bots, revoke their tokens, abort games or take them out of the ratings, and ban or delete accounts or end guest sessions when these terms or the law are broken, or to protect the service. A person decides, not an automatic system. You are told the reason unless that is impossible, and you can contest a decision by email, which is then reviewed.`,
                    ),
                ],
            },
            {
                id: `reporting`,
                heading: `Reporting`,
                blocks: [
                    text(
                        rich`Report unlawful content or abuse to ${links.mail(operator.email)} with the link, what is wrong and why, and your name and email address. You get a confirmation and a decision. In an emergency, call the police first.`,
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
                        `The operator is liable without limit for intent and gross negligence, for injury to life, body, or health, and under the Product Liability Act. For slight negligence the operator is liable only for breach of an obligation essential to the service, limited to the damage typical and foreseeable for a free service of this kind; otherwise there is no liability for slight negligence.`,
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
                        `Changes take effect 30 days after they are published on this page, whose date shows the current version. If you disagree, you can have your account deleted, or stop playing as a guest, before then.`,
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
    updated: `Last updated 1 October 2026`,
    onThisPage: `On this page`,
    failed: `The legal details did not load`,
};
