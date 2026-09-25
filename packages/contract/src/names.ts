import { z } from 'zod';

// Two anchor chars plus up to 28 middle chars: 2-30 total, first a letter,
// last a letter or digit (SPEC.md section 4, the lichess nameRules pattern
// `(?i)[a-z][a-z0-9_-]{0,28}[a-z0-9]`; explicit classes instead of the flag
// keep the generated openapi pattern valid, and the fold is ASCII-only).
export const namePattern = /^[A-Za-z][A-Za-z0-9_-]{0,28}[A-Za-z0-9]$/;

export const nameSyntaxSchema = z.string().regex(namePattern);

// Exact match on the lowercase fold. `deleted` keeps ADMIN.md's delete-user
// placeholder namespace free; the last two are the site and house names.
export const reservedNames: readonly string[] = [
    `administrator`,
    `moderator`,
    `root`,
    `support`,
    `admin`,
    `deleted`,
    `hexarena`,
    `hexo`,
];

// The charset makes lowercasing a total fold, so this is the whole collation.
export function nameKeyOf(name: string): string {
    return name.toLowerCase();
}

export function isReservedName(name: string): boolean {
    return reservedNames.includes(nameKeyOf(name));
}
