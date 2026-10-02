import { legalDetailParties, type LegalDetails } from '@hexo-arena/contract';

/** Every value the details can hold, by its dotted name: `operator.name`, `host.serverLocation`. */
export const legalDetailNames: ReadonlySet<string> = new Set(
    Object.entries(legalDetailParties).flatMap(([party, schema]) => Object.keys(schema.shape).map((field) => `${party}.${field}`)),
);

/** The values a deployment's details hold, by their dotted names; a value left out has no entry. */
export function legalDetailValues(details: LegalDetails): ReadonlyMap<string, string> {
    return new Map(
        Object.entries(details).flatMap(([party, values]) =>
            Object.entries(values ?? {}).flatMap(([field, value]) => (value === undefined ? [] : [[`${party}.${field}`, value] as const])),
        ),
    );
}
