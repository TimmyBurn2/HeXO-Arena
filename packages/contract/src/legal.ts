import { z } from 'zod';
import { pageTitle, siteName, type PageMeta } from './meta';

/** The public read that serves the operator's legal details to the site's legal pages. */
export const legalDetailsPath = `/api/legal`;

const line = z.string().trim().min(1).max(200);
const addressLines = z.array(line).min(1).max(6);

// The checks on the address and the link stay loose enough for the
// committed example's placeholders, which a production boot refuses on its
// own; strict objects make a misspelled key fail instead of vanishing.
const operatorSchema = z.strictObject({
    name: line,
    addressLines,
    email: z.string().trim().max(254).regex(/^[^\s@]+@[^\s@]+$/),
    discord: line.max(64).optional(),
});

const hostSchema = z.strictObject({
    name: line,
    addressLines,
    serverLocation: line,
});

const authoritySchema = z.strictObject({
    name: line,
    addressLines,
    url: z.string().trim().max(2048).regex(/^https:\/\/\S+$/),
});

const mailProviderSchema = z.strictObject({
    name: line,
    addressLines,
});

/**
 * Who runs a deployment and who processes its data, as the legal pages
 * name them: the operator, the host and where the server stands, the
 * supervisory authority, and the mail provider if the contact address has
 * one. The deployment provides them in a file; no commit carries them.
 */
export const legalDetailsSchema = z
    .strictObject({
        operator: operatorSchema,
        host: hostSchema,
        supervisoryAuthority: authoritySchema,
        mailProvider: mailProviderSchema.optional(),
    })
    .meta({
        id: `LegalDetails`,
        description: `The operator, the host with the server's location, the supervisory authority, and an optional mail provider.`,
    });
export type LegalDetails = z.infer<typeof legalDetailsSchema>;

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

/** Each legal page's title and description, for the site and its link previews. */
export const legalPageMeta: Readonly<Record<LegalPage, PageMeta>> = {
    imprint: { title: pageTitle(legalPageNames.imprint), description: `Who runs ${siteName} and how to reach the operator` },
    privacy: { title: pageTitle(legalPageNames.privacy), description: `What ${siteName} stores, why, for how long, and your rights` },
    terms: { title: pageTitle(legalPageNames.terms), description: `The rules for accounts, bots, names, and games on ${siteName}` },
};
