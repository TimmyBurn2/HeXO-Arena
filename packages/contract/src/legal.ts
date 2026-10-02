import { z } from 'zod';
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

/** The details file in the deployment's legal folder, which its documents fill in. */
export const legalDetailsFile = `details.json`;

/** The repository's details, every value a placeholder, which a development server reads in place of a deployment's. */
export const legalDetailsExampleFile = `details.example.json`;

/** Where the deployment serves the details its legal documents fill in. */
export const legalDetailsPath = `/legal/${legalDetailsFile}`;

const line = z.string().trim().min(1).max(200);

// A postal address in the order a letter carries it, one named field per
// line, so whoever fills in the file sees what goes where.
const postalAddress = {
    street: line,
    postcodeAndCity: line,
    country: line,
};

// The checks on the address and the link stay loose enough for the
// committed example's placeholders; strict objects make a misspelled key
// fail instead of vanishing.
const operatorSchema = z.strictObject({
    name: line,
    ...postalAddress,
    email: z.string().trim().max(254).regex(/^[^\s@]+@[^\s@]+$/),
    discord: line.max(64).optional(),
});

const hostSchema = z.strictObject({
    name: line,
    ...postalAddress,
    serverLocation: line,
});

const authoritySchema = z.strictObject({
    name: line,
    ...postalAddress,
    url: z.string().trim().max(2048).regex(/^https:\/\/\S+$/),
});

const mailProviderSchema = z.strictObject({
    name: line,
    ...postalAddress,
});

/** Each party the details name, with the fields it holds. */
export const legalDetailParties = { operator: operatorSchema, host: hostSchema, supervisoryAuthority: authoritySchema, mailProvider: mailProviderSchema };

/**
 * Who runs a deployment and who processes its data, as its legal documents
 * name them: the operator, the host and where the server stands, the
 * supervisory authority, and the mail provider if the contact address has
 * one. The deployment serves them as one file beside the documents.
 */
export const legalDetailsSchema = z.strictObject({
    operator: operatorSchema,
    host: hostSchema,
    supervisoryAuthority: authoritySchema,
    mailProvider: mailProviderSchema.optional(),
});
export type LegalDetails = z.infer<typeof legalDetailsSchema>;

/**
 * Where a details file's JSON fails the details, by dotted name, an
 * unknown key named beside its party; empty when it holds.
 * Never a value, which is the operator's own.
 */
export function legalDetailsFaults(json: unknown): string[] {
    const parsed = legalDetailsSchema.safeParse(json);
    if (parsed.success) return [];
    return parsed.error.issues.map((issue) => {
        const at = z.core.toDotPath(issue.path) || `the top level`;
        return issue.code === `unrecognized_keys` ? `${at} (unknown ${issue.keys.join(`, `)})` : at;
    });
}

/** Each legal page's title and description, for the site and its link previews. */
export const legalPageMeta: Readonly<Record<LegalPage, PageMeta>> = {
    imprint: { title: pageTitle(legalPageNames.imprint), description: `Who runs ${siteName} and how to reach the operator` },
    privacy: { title: pageTitle(legalPageNames.privacy), description: `What ${siteName} stores, why, for how long, and your rights` },
    terms: { title: pageTitle(legalPageNames.terms), description: `The rules for accounts, bots, names, and games on ${siteName}` },
};
