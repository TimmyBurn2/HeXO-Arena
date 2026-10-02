import { z } from 'zod';

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

const parties = { operator: operatorSchema, host: hostSchema, supervisoryAuthority: authoritySchema, mailProvider: mailProviderSchema };

/** Every value the details can hold, by its dotted name: `operator.name`, `host.serverLocation`. */
export const legalDetailNames: ReadonlySet<string> = new Set(
    Object.entries(parties).flatMap(([party, schema]) => Object.keys(schema.shape).map((field) => `${party}.${field}`)),
);

/** The values a deployment's details hold, by their dotted names; a value left out has no entry. */
export function legalDetailValues(details: LegalDetails): ReadonlyMap<string, string> {
    return new Map(
        Object.entries(details).flatMap(([party, values]) =>
            Object.entries(values ?? {}).map(([field, value]) => [`${party}.${field}`, value] as const),
        ),
    );
}
