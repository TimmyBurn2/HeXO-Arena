import { readFileSync } from 'node:fs';
import { siteName } from '@hexo-arena/contract';
import { describe, expect, it } from 'vitest';
import { rootMeta, routeMeta } from '../src/route-meta';

const routes = [
    { name: `ladder` },
    { name: `bots` },
    { name: `bot`, bot: `sealbot` },
    { name: `connect` },
    { name: `profile` },
    { name: `credits` },
    { name: `game`, gameId: `g1` },
    { name: `legal`, page: `imprint` },
    { name: `legal`, page: `privacy` },
    { name: `legal`, page: `terms` },
    { name: `not-found` },
] as const;

describe('routeMeta', () => {
    it('titles every route with the site suffix', () => {
        expect(routeMeta({ name: `ladder` }).title).toBe(`Ladder - HeXO Arena`);
        expect(routeMeta({ name: `bots` }).title).toBe(`Bots - HeXO Arena`);
        expect(routeMeta({ name: `connect` }).title).toBe(`Build a bot - HeXO Arena`);
        expect(routeMeta({ name: `profile` }).title).toBe(`Profile - HeXO Arena`);
        expect(routeMeta({ name: `credits` }).title).toBe(`Credits - HeXO Arena`);
        expect(routeMeta({ name: `legal`, page: `imprint` }).title).toBe(`Impressum / Legal notice - HeXO Arena`);
        expect(routeMeta({ name: `legal`, page: `privacy` }).title).toBe(`Privacy policy - HeXO Arena`);
        expect(routeMeta({ name: `legal`, page: `terms` }).title).toBe(`Terms of use - HeXO Arena`);
        for (const route of routes) expect(routeMeta(route).title).toMatch(/^\S.* - HeXO Arena$/);
    });

    it('keep the site title for the root, with the ladder it shows described', () => {
        expect(rootMeta.title).toBe(`HeXO Arena - one ladder for bots and humans`);
        expect(rootMeta.description).toBe(routeMeta({ name: `ladder` }).description);
    });

    it('match the static page, which every route not rendered by the server shows first', () => {
        const page = readFileSync(new URL(`../index.html`, import.meta.url), `utf8`);
        expect(page).toContain(`<title>${rootMeta.title}</title>`);
        expect(page).toContain(`<meta property="og:title" content="${rootMeta.title}" />`);
        expect(page).toContain(`<meta name="description" content="${rootMeta.description}" />`);
        expect(page).toContain(`<meta property="og:description" content="${rootMeta.description}" />`);
        expect(page).toContain(`<meta property="og:site_name" content="${siteName}" />`);
    });

    it('carry the bot name into its title, and describe a page without data by the site', () => {
        expect(routeMeta({ name: `bot`, bot: `sealbot` })).toEqual({
            title: `sealbot - HeXO Arena`,
            description: `Connect a HeXO bot, or play one in the browser`,
        });
        expect(routeMeta({ name: `game`, gameId: `g1` }).description).toBe(rootMeta.description);
    });

    it('describe each screen in one line', () => {
        for (const route of routes) {
            const description = routeMeta(route).description;
            expect(description.length).toBeGreaterThan(8);
            expect(description.endsWith(`.`)).toBe(false);
        }
    });
});
