import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultTheme, parseTheme, themes, themeVocabulary } from '../src/theme/themes';

const themeDir = join(import.meta.dirname, `../src/styles/themes`);
const shared = [`brand.css`, `slots.css`];

function declaredProperties(css: string): string[] {
    return [...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1] ?? ``);
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
            expect(css).toContain(`:root[data-theme='${theme.id}']`);
            const declared = declaredProperties(css);
            const slots = declaredProperties(readFileSync(join(themeDir, `slots.css`), `utf8`));
            expect(declared.filter((name) => !slots.includes(name)).sort()).toEqual([...themeVocabulary].sort());
        });
    }

    it('keep the brand out of the theme vocabulary', () => {
        const brand = declaredProperties(readFileSync(join(themeDir, `brand.css`), `utf8`));
        const vocabulary: readonly string[] = themeVocabulary;
        expect(brand.filter((name) => vocabulary.includes(name))).toEqual([]);
    });
});

describe('parseTheme', () => {
    it('keep a stored theme', () => {
        expect(parseTheme(`walnut`, null)).toBe(`walnut`);
    });

    it('fall back to the default on nothing or an unknown id', () => {
        expect(parseTheme(null, null)).toBe(defaultTheme);
        expect(parseTheme(`lava`, null)).toBe(defaultTheme);
    });

    it('carry an earlier board palette over as its theme', () => {
        expect(parseTheme(null, JSON.stringify({ palette: `walnut`, numbers: true }))).toBe(`walnut`);
        expect(parseTheme(null, JSON.stringify({ palette: `slate` }))).toBe(`slate`);
    });

    it('ignore a broken legacy entry', () => {
        expect(parseTheme(null, `{nope`)).toBe(defaultTheme);
    });
});
