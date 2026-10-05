import { describe, expect, it } from 'vitest';
import { legalPagePath, legalPages, movedPages, movedPath, pageMeta, pageNames, pagePath, sitePages, type PageMeta } from '../src';

// The parameter names a path pattern takes, in order.
const paramsOf = (path: string): string[] => [...path.matchAll(/:(\w+)/gu)].map((match) => match[1] ?? ``);

describe('the page table', () => {
    it('gives every page a path of its own, so no two pages answer one address', () => {
        const shapes = pageNames.map((name) => sitePages[name].path.replace(/:\w+/gu, `:`));
        expect(new Set(shapes).size).toBe(pageNames.length);
        for (const moved of movedPages) expect(shapes).not.toContain(moved.from.replace(/:\w+/gu, `:`));
    });

    it('fills a path with its parameters, each encoded as one segment', () => {
        expect(pagePath(`home`, {})).toBe(`/`);
        expect(pagePath(`player`, { player: `j\u00e9r\u00f4me` })).toBe(`/players/j%C3%A9r%C3%B4me`);
        expect(pagePath(`bot`, { bot: `a/b` })).toBe(`/bots/a%2Fb`);
        for (const page of legalPages) expect(pagePath(`legal`, { page })).toBe(legalPagePath(page));
    });

    it('lists the values of a parameter that takes only a few, and only for one the path holds', () => {
        expect(sitePages.legal.values).toEqual({ page: legalPages });
        for (const name of pageNames) {
            for (const param of Object.keys(sitePages[name].values)) expect(paramsOf(sitePages[name].path)).toContain(param);
        }
    });

    it('sends each moved address to a page whose parameters the old path holds', () => {
        for (const moved of movedPages) {
            for (const param of paramsOf(sitePages[moved.to].path)) expect(paramsOf(moved.from)).toContain(param);
        }
        expect(movedPages.map((moved) => movedPath(moved, { id: `a b` }))).toEqual([
            `/tournaments/a%20b`,
            `/tournaments/a%20b`,
            `/play/tournament`,
            `/games/tournaments`,
            `/games/tournaments`,
            `/games/tournaments`,
        ]);
    });

    it('keeps an old address\'s query, and reads a duel\'s setup as a tournament\'s of its two bots', () => {
        const moved = (from: string) => movedPages.find((page) => page.from === from);
        const games = moved(`/games/duels`);
        const setup = moved(`/play/duels`);
        if (games === undefined || setup === undefined) throw new Error(`a moved page is missing`);
        expect(movedPath(games, {}, `?list=yours&bot=hextide`)).toBe(`/games/tournaments?list=yours&bot=hextide`);
        expect(movedPath(setup, {}, `?first=hextide&second=pebble&secondLevel=club&games=10&clock=turn-10&opening=3`)).toBe(
            `/play/tournament?bots=hextide%2Cpebble&level=pebble%3Aclub&games=10&clock=turn-10&opening=3`,
        );
        expect(movedPath(setup, {}, `?second=pebble`)).toBe(`/play/tournament?bots=pebble`);
        expect(movedPath(setup, {}, ``)).toBe(`/play/tournament`);
    });

    it('titles every page with the site suffix, from its parameters where it has any', () => {
        for (const name of pageNames) {
            const params = Object.fromEntries(paramsOf(sitePages[name].path).map((param) => [param, sitePages[name].values[param]?.[0] ?? `sealbot`]));
            // Every page's meta reads its parameters by name, and these are filled from its own pattern.
            const meta = (sitePages[name].meta as (params: Readonly<Record<string, string>>) => PageMeta)(params);
            expect(meta.title).toMatch(/^\S.* - HeXO Arena$|^HeXO Arena - /u);
        }
        expect(pageMeta(`bot`, { bot: `sealbot` }).title).toBe(`sealbot - HeXO Arena`);
    });
});
