import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { routeMeta, siteMeta } from '../src/route-meta';

const routes = [
    { name: `ladder` },
    { name: `bots` },
    { name: `bot`, bot: `sealbot` },
    { name: `connect` },
    { name: `profile` },
    { name: `credits` },
    { name: `game`, gameId: `g1` },
    { name: `not-found` },
] as const;

describe('routeMeta', () => {
    it('titles every route with the site suffix', () => {
        expect(routeMeta({ name: `ladder` }).title).toBe(`Ladder - HeXO Arena`);
        expect(routeMeta({ name: `bots` }).title).toBe(`Bots - HeXO Arena`);
        expect(routeMeta({ name: `connect` }).title).toBe(`Build a bot - HeXO Arena`);
        expect(routeMeta({ name: `profile` }).title).toBe(`Profile - HeXO Arena`);
        expect(routeMeta({ name: `credits` }).title).toBe(`Credits - HeXO Arena`);
        for (const route of routes) expect(routeMeta(route).title).toMatch(/^\S.* - HeXO Arena$/);
    });

    it('keep the site title for the root, with the ladder it shows described', () => {
        expect(siteMeta.title).toBe(`HeXO Arena - an open ladder for bots and humans`);
        expect(siteMeta.description).toBe(routeMeta({ name: `ladder` }).description);
    });

    it('match the static page, which every route not rendered by the server shows first', () => {
        const page = readFileSync(new URL(`../index.html`, import.meta.url), `utf8`);
        expect(page).toContain(`<title>${siteMeta.title}</title>`);
        expect(page).toContain(`<meta property="og:title" content="${siteMeta.title}" />`);
        expect(page).toContain(`<meta name="description" content="${siteMeta.description}" />`);
        expect(page).toContain(`<meta property="og:description" content="${siteMeta.description}" />`);
    });

    it('carry the bot name into its title', () => {
        expect(routeMeta({ name: `bot`, bot: `sealbot` }).title).toBe(`sealbot - HeXO Arena`);
    });

    it('describe each screen in one line', () => {
        for (const route of routes) {
            const description = routeMeta(route).description;
            expect(description.length).toBeGreaterThan(8);
            expect(description.endsWith(`.`)).toBe(false);
        }
    });
});
