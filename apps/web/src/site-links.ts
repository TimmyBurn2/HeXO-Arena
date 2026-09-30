import { legalPagePath } from '@hexo-arena/contract';
import { text } from './text';

/** The Hexo-Bot-Api repository: the bot API's spec, its examples, and the readme. */
export const botApiRepository = `https://github.com/TimmyBurn2/Hexo-Bot-Api`;

/** One standing link of the site: a page of the app, or a document it does not render. */
export type SiteLink = { kind: `page`; label: string; to: string } | { kind: `external`; label: string; href: string };

/**
 * The links every framed screen carries in its footer and the game carries
 * in its drawer; a new standing link is one more row.
 */
export const siteLinks: readonly SiteLink[] = [
    { kind: `page`, label: text.shell.links.build, to: `/connect` },
    { kind: `page`, label: text.shell.links.credits, to: `/credits` },
    { kind: `external`, label: text.shell.links.botApi, href: botApiRepository },
];

/** The licenses of the code and the font the site ships, a file the build writes at the site's root. */
export const thirdPartyLicensesPath = `/third-party-licenses.txt`;

/**
 * The legal pages, which the law wants a click or two from every screen,
 * and the licenses: the footer's last group, and the drawer's.
 */
export const legalLinks: readonly SiteLink[] = [
    { kind: `page`, label: text.shell.links.imprint, to: legalPagePath(`imprint`) },
    { kind: `page`, label: text.shell.links.privacy, to: legalPagePath(`privacy`) },
    { kind: `page`, label: text.shell.links.terms, to: legalPagePath(`terms`) },
    { kind: `external`, label: text.shell.links.licenses, href: thirdPartyLicensesPath },
];
