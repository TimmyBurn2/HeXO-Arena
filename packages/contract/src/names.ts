import { z } from 'zod';

/** The fewest characters a name may have: its two anchors. */
export const nameMinLength = 2;

/** The most characters a name may have. */
export const nameMaxLength = 30;

// Two anchor chars plus up to 28 middle chars: 2-30 total, first a
// letter, last a letter or digit. The lichess nameRules pattern spells
// this `(?i)[a-z][a-z0-9_-]{0,28}[a-z0-9]`; explicit classes instead of
// the flag keep the generated openapi pattern valid, and the fold is
// ASCII-only.
export const namePattern = new RegExp(`^[A-Za-z][A-Za-z0-9_-]{0,${String(nameMaxLength - nameMinLength)}}[A-Za-z0-9]$`);

export const nameSyntaxSchema = z.string().regex(namePattern);

// Exact match on the lowercase fold.
// `hexo-arena` in its three spellings and the lookalike `hexarena` name
// the site, `hexo` the house.
// `deleted` and every `deleted-<n>` are the placeholder namespace that
// deleted players are renamed into.
// `guest` stays free of any account, so no one can pass for the anonymous
// Guest labels.
export const reservedNames: readonly string[] = [
    `administrator`,
    `moderator`,
    `root`,
    `support`,
    `admin`,
    `deleted`,
    `guest`,
    `hexo-arena`,
    `hexo_arena`,
    `hexoarena`,
    `hexarena`,
    `hexo`,
];

// The charset makes lowercasing a total fold, so this is the whole collation.
export function nameKeyOf(name: string): string {
    return name.toLowerCase();
}

export const placeholderNamePattern = /^deleted-[0-9]+$/;

export function isReservedName(name: string): boolean {
    const key = nameKeyOf(name);
    return reservedNames.includes(key) || placeholderNamePattern.test(key);
}

// A placeholder's number would let a reader follow one deleted person
// across games, so no public answer carries it: a deleted participant is
// named by one of these, and the space keeps either off every real name.

/** How a deleted account reads wherever a public answer names it. */
export const deletedPlayerName = `deleted player`;

/** How a deleted bot reads wherever a public answer names it. */
export const deletedBotName = `deleted bot`;

/** The mark a public answer sets on a deleted participant; optional wherever it is used, absent for everyone else. */
export const deletedMarkSchema = z
    .literal(true)
    .meta({ id: `Deleted`, description: `Present when the account or bot was deleted: the name then reads ${deletedPlayerName} or ${deletedBotName}, and has no page.` });
