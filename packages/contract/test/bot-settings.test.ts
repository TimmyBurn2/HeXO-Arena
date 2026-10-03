import { describe, expect, it } from 'vitest';
import { accountDeclarationSchema, botAboutMaxLength, botClientOf, botSettingsUpdateSchema } from '../src';

describe('botClientOf', () => {
    it('reads hexo-bridge and its release from a User-Agent that leads with them', () => {
        expect(botClientOf(`hexo-bridge/0.3.0`)).toEqual({ kind: `hexo-bridge`, version: `0.3.0` });
        expect(botClientOf(`hexo-bridge/12.0.1 (Linux; CPython 3.12)`)).toEqual({ kind: `hexo-bridge`, version: `12.0.1` });
        expect(botClientOf(`  hexo-bridge/1.2.3`)).toEqual({ kind: `hexo-bridge`, version: `1.2.3` });
    });

    it('reads every other User-Agent, or none, as another client, keeping nothing of it', () => {
        for (const userAgent of [undefined, ``, `hexo-bridge`, `hexo-bridge/`, `hexo-bridge/unknown`, `hexo-bridge/0.4.0rc1`, `hexo-bridge/0.4`, `hexo-bridge/1.2.3.4`, `hexo-bridge/12345.0.0`, `Hexo-Bridge/0.3.0`, `Mozilla/5.0 hexo-bridge/0.3.0`, `python-urllib/3.12`]) {
            expect(botClientOf(userAgent), String(userAgent)).toEqual({ kind: `other` });
        }
    });
});

describe('botSettingsUpdateSchema', () => {
    it('changes the duel switch, the text, and the link, each alone, and refuses any other key', () => {
        expect(botSettingsUpdateSchema.parse({ duelsByOthers: false })).toEqual({ duelsByOthers: false });
        expect(botSettingsUpdateSchema.parse({})).toEqual({});
        expect(botSettingsUpdateSchema.parse({ about: `Plays fast`, repoUrl: `https://example.org/bot` })).toEqual({ about: `Plays fast`, repoUrl: `https://example.org/bot` });
        expect(botSettingsUpdateSchema.safeParse({ open: true }).success).toBe(false);
    });

    it('cleans the text as a declaration\'s is, capping what is left, and takes empty as clearing', () => {
        expect(botSettingsUpdateSchema.parse({ about: `\u202eTwo\nlines\t ` }).about).toBe(`Two lines`);
        expect(botSettingsUpdateSchema.parse({ about: `` }).about).toBe(``);
        expect(botSettingsUpdateSchema.safeParse({ about: `x`.repeat(botAboutMaxLength) }).success).toBe(true);
        expect(botSettingsUpdateSchema.safeParse({ about: `x`.repeat(botAboutMaxLength + 1) }).success).toBe(false);
    });

    it('takes an http or https link spelled out, trimmed, or empty, and refuses any other', () => {
        expect(botSettingsUpdateSchema.parse({ repoUrl: ` https://example.org ` }).repoUrl).toBe(`https://example.org`);
        expect(botSettingsUpdateSchema.parse({ repoUrl: `` }).repoUrl).toBe(``);
        for (const repoUrl of [`https:example.org`, `ftp://example.org`, `javascript:alert(1)`, `example.org`, `https://${`x`.repeat(2048)}`]) {
            expect(botSettingsUpdateSchema.safeParse({ repoUrl }).success, repoUrl).toBe(false);
        }
    });
});

describe('accountDeclarationSchema', () => {
    it('still accepts about and repoUrl from a bot, though the owner\'s text takes their place', () => {
        expect(accountDeclarationSchema.parse({ about: `Declared`, repoUrl: `https://example.org`, version: `1.0` })).toEqual({ about: `Declared`, repoUrl: `https://example.org`, version: `1.0` });
    });
});
