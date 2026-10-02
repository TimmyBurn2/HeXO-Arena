import { pageTitle, siteName, type PageMeta } from './meta';

/** The youngest age at which a person may have an account. */
export const minimumAge = 16;

/** Below this age a person needs a parent's or guardian's permission. */
export const guardianPermissionAge = 18;

/** The legal pages every framed screen and the game link to. */
export const legalPages = [`imprint`, `privacy`, `terms`] as const;
export type LegalPage = (typeof legalPages)[number];

/** Each legal page's name, as its heading and its title read it. */
export const legalPageNames: Readonly<Record<LegalPage, string>> = {
    imprint: `Impressum / Legal notice`,
    privacy: `Privacy policy`,
    terms: `Terms of use`,
};

/** Where a legal page lives. */
export function legalPagePath(page: LegalPage): string {
    return `/legal/${page}`;
}

/** A legal document's file in the deployment's legal folder, its Markdown. */
export function legalDocumentFile(page: LegalPage): string {
    return `${page}.md`;
}

/** Where the deployment serves a legal document, beside the page that renders it. */
export function legalDocumentPath(page: LegalPage): string {
    return `/legal/${legalDocumentFile(page)}`;
}

/** Where the deployment serves the details its legal documents fill in. */
export const legalDetailsPath = `/legal/details.json`;

/** Each legal page's title and description, for the site and its link previews. */
export const legalPageMeta: Readonly<Record<LegalPage, PageMeta>> = {
    imprint: { title: pageTitle(legalPageNames.imprint), description: `Who runs ${siteName} and how to reach the operator` },
    privacy: { title: pageTitle(legalPageNames.privacy), description: `What ${siteName} stores, why, for how long, and your rights` },
    terms: { title: pageTitle(legalPageNames.terms), description: `The rules for accounts, bots, names, and games on ${siteName}` },
};
