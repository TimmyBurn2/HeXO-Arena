import { legalPagePath, reportPagePath, reportSubjectParam, type LegalPage } from '@hexo-arena/contract';
import { text } from './text';

/** The Hexo-Bot-Api repository: the bot API's spec, its examples, and the readme. */
export const botApiRepository = `https://github.com/TimmyBurn2/Hexo-Bot-Api`;

/** The hexo-bridge repository: the runner that plays a bot author's engine through the bot API. */
export const bridgeRepository = `https://github.com/TimmyBurn2/hexo-bridge`;

/** The command that installs hexo-bridge. */
// The bridge tags no releases yet, so this installs its default branch;
// it moves to a tagged install once the bridge tags one.
export const bridgeInstall = `pip install git+${bridgeRepository}`;

/** The site's own repository: its code, the legal templates, and how to run it. */
export const siteRepository = `https://github.com/TimmyBurn2/HeXO-Arena`;

/** Whether the standing links lead to the site's repository; off while the repository is private. */
// Widened from the literal: the switch is a setting either value must type-check against.
export const siteRepositoryPublic = false as boolean;

/**
 * One standing link of the site: a page of the app, or a document it does
 * not render, which may carry the mark of the place it opens.
 */
export type SiteLink = { kind: `page`; label: string; to: string } | { kind: `external`; label: string; href: string; mark?: `github` };

/** The site's repository as a standing link, under GitHub's mark. */
export const sourceLink: SiteLink = { kind: `external`, label: text.shell.links.source, href: siteRepository, mark: `github` };

/**
 * The links every framed screen carries in its footer and the game carries
 * in its drawer; a new standing link is one more row.
 */
export const siteLinks: readonly SiteLink[] = [
    { kind: `page`, label: text.shell.links.tournaments, to: `/tournaments` },
    { kind: `page`, label: text.shell.links.build, to: `/connect` },
    { kind: `page`, label: text.shell.links.credits, to: `/credits` },
    { kind: `external`, label: text.shell.links.botApi, href: botApiRepository },
    ...(siteRepositoryPublic ? [sourceLink] : []),
];

/** The licenses of the code and the font the site ships, a file the build writes at the site's root. */
export const thirdPartyLicensesPath = `/third-party-licenses.txt`;

/** Each legal page as a standing link, which the law wants a click or two from every screen. */
export const legalPageLinks: Readonly<Record<LegalPage, SiteLink>> = {
    imprint: { kind: `page`, label: text.shell.links.imprint, to: legalPagePath(`imprint`) },
    privacy: { kind: `page`, label: text.shell.links.privacy, to: legalPagePath(`privacy`) },
    terms: { kind: `page`, label: text.shell.links.terms, to: legalPagePath(`terms`) },
};

/** The licenses as a standing link, the last of the legal group. */
export const licensesLink: SiteLink = { kind: `external`, label: text.shell.links.licenses, href: thirdPartyLicensesPath };

/** The report form with the page a report is about filled in; from the form itself, the form alone. */
export function reportPathOf(subject: string): string {
    if (subject === reportPagePath || subject.startsWith(`${reportPagePath}?`)) return reportPagePath;
    return `${reportPagePath}?${new URLSearchParams({ [reportSubjectParam]: subject }).toString()}`;
}

/** The report form as a standing link, about the page it stands on. */
export function reportLinkOf(subject: string): SiteLink {
    return { kind: `page`, label: text.shell.links.report, to: reportPathOf(subject) };
}
