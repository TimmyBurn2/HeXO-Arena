import { text } from './text';

/** The Hexo-Bot-Api repository: the bot API's spec, its examples, and the readme. */
export const botApiRepository = `https://github.com/TimmyBurn2/Hexo-Bot-Api`;

/** One standing link of the site: a page here, or a document elsewhere. */
export type SiteLink = { kind: `page`; label: string; to: string } | { kind: `external`; label: string; href: string };

/**
 * The links every framed screen carries in its footer and the game carries
 * in its drawer; a new standing link is one more row.
 */
export const siteLinks: readonly SiteLink[] = [
    { kind: `page`, label: text.shell.links.credits, to: `/credits` },
    { kind: `external`, label: text.shell.links.botApi, href: botApiRepository },
];
