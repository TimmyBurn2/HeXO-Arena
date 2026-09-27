import { describe, expect, it } from 'vitest';
import { routeMeta, siteMeta } from '../src/route-meta';

describe('routeMeta', () => {
    it('titles every route with the site suffix', () => {
        expect(routeMeta({ name: `ladder` }).title).toBe(`Ladder - hexarena`);
        expect(routeMeta({ name: `bots` }).title).toBe(`Bots - hexarena`);
        expect(routeMeta({ name: `connect` }).title).toBe(`Build a bot - hexarena`);
        expect(routeMeta({ name: `profile` }).title).toBe(`Profile - hexarena`);
        expect(routeMeta({ name: `credits` }).title).toBe(`Credits - hexarena`);
    });

    it('keep the site title for the root, with the ladder it shows described', () => {
        expect(siteMeta.title).toBe(`hexarena - bot arena for HeXO`);
        expect(siteMeta.description).toBe(routeMeta({ name: `ladder` }).description);
    });

    it('carry the bot name into its title', () => {
        expect(routeMeta({ name: `bot`, bot: `sealbot` }).title).toBe(`sealbot - hexarena`);
    });

    it('describe each screen in one line', () => {
        for (const route of [
            { name: `ladder` },
            { name: `bots` },
            { name: `bot`, bot: `sealbot` },
            { name: `connect` },
            { name: `profile` },
            { name: `credits` },
            { name: `game`, gameId: `g1` },
            { name: `not-found` },
        ] as const) {
            const description = routeMeta(route).description;
            expect(description.length).toBeGreaterThan(8);
            expect(description.endsWith(`.`)).toBe(false);
        }
    });
});
