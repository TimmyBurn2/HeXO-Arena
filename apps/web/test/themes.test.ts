import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultTheme, parseTheme, themes, themeVocabulary } from '../src/theme/themes';

const themeDir = join(import.meta.dirname, `../src/styles/themes`);
const shared = [`brand.css`, `slots.css`];

function declaredProperties(css: string): string[] {
    return [...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1] ?? ``);
}

// Every rule's selector list, whitespace folded, with comments and at-rule
// preludes dropped.
function ruleSelectors(css: string): string[] {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, ``);
    return [...bare.matchAll(/([^{};]+)\{/g)]
        .map((match) => (match[1] ?? ``).replace(/\s+/g, ` `).trim())
        .filter((selector) => !selector.startsWith(`@`));
}

function themeFiles(): string[] {
    return readdirSync(themeDir)
        .filter((file) => file.endsWith(`.css`) && !shared.includes(file))
        .map((file) => file.replace(/\.css$/, ``));
}

describe('theme sheets', () => {
    it('match the registry one to one', () => {
        expect(themeFiles().sort()).toEqual(themes.map((theme) => theme.id).sort());
    });

    for (const theme of themes) {
        it(`name every vocabulary color and only known slots in ${theme.id}`, () => {
            const css = readFileSync(join(themeDir, `${theme.id}.css`), `utf8`);
            const declared = declaredProperties(css);
            const slots = declaredProperties(readFileSync(join(themeDir, `slots.css`), `utf8`));
            expect(declared.filter((name) => !slots.includes(name)).sort()).toEqual([...themeVocabulary].sort());
        });
    }

    for (const theme of themes) {
        it(`apply ${theme.id} on the root and inside a preview of it, in one block`, () => {
            const css = readFileSync(join(themeDir, `${theme.id}.css`), `utf8`);
            expect(ruleSelectors(css)).toEqual([`:root[data-theme='${theme.id}'], [data-theme-preview='${theme.id}']`]);
        });
    }

    it('start every preview from the neutral slots, as the root does', () => {
        const css = readFileSync(join(themeDir, `slots.css`), `utf8`);
        expect(ruleSelectors(css)).toEqual([`:root, [data-theme-preview]`]);
    });

    it('keep the brand out of the theme vocabulary', () => {
        const brand = declaredProperties(readFileSync(join(themeDir, `brand.css`), `utf8`));
        const vocabulary: readonly string[] = themeVocabulary;
        expect(brand.filter((name) => vocabulary.includes(name))).toEqual([]);
    });
});

describe('parseTheme', () => {
    it('keep a stored theme', () => {
        expect(parseTheme(`omok`)).toBe(`omok`);
    });

    it('never read a stored name through to an object prototype', () => {
        expect(parseTheme(`constructor`)).toBe(defaultTheme);
        expect(parseTheme(`__proto__`)).toBe(defaultTheme);
    });

    it('fall back to the default on nothing or an unknown id', () => {
        expect(parseTheme(null)).toBe(defaultTheme);
        expect(parseTheme(`lava`)).toBe(defaultTheme);
    });
});
