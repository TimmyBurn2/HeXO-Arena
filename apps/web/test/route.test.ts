import { describe, expect, it } from 'vitest';
import { parseRoute, routePath } from '../src/router/route';

describe('parseRoute', () => {
    it('route the root to the arena', () => {
        expect(parseRoute(`/`)).toEqual({ name: `arena` });
    });

    it('route the four surfaces', () => {
        expect(parseRoute(`/bots`)).toEqual({ name: `bots` });
        expect(parseRoute(`/connect`)).toEqual({ name: `connect` });
        expect(parseRoute(`/profile`)).toEqual({ name: `profile` });
    });

    it('carry the bot name and game id', () => {
        expect(parseRoute(`/bots/sealbot`)).toEqual({ name: `bot`, bot: `sealbot` });
        expect(parseRoute(`/game/g-123`)).toEqual({ name: `game`, gameId: `g-123` });
    });

    it('decode encoded path segments', () => {
        expect(parseRoute(`/bots/se%61lbot`)).toEqual({ name: `bot`, bot: `sealbot` });
    });

    it('ignore a trailing slash', () => {
        expect(parseRoute(`/bots/`)).toEqual({ name: `bots` });
    });

    it('fall through to not-found for anything else', () => {
        expect(parseRoute(`/nope`)).toEqual({ name: `not-found` });
        expect(parseRoute(`/bots/a/b`)).toEqual({ name: `not-found` });
        expect(parseRoute(`/game`)).toEqual({ name: `not-found` });
    });
});

describe('routePath', () => {
    it('builds the path for every route', () => {
        expect(routePath({ name: `arena` })).toBe(`/`);
        expect(routePath({ name: `bots` })).toBe(`/bots`);
        expect(routePath({ name: `bot`, bot: `sealbot` })).toBe(`/bots/sealbot`);
        expect(routePath({ name: `connect` })).toBe(`/connect`);
        expect(routePath({ name: `profile` })).toBe(`/profile`);
        expect(routePath({ name: `game`, gameId: `g1` })).toBe(`/game/g1`);
    });

    it('round-trips through parseRoute', () => {
        const routes = [
            { name: `arena` },
            { name: `bots` },
            { name: `bot`, bot: `sealbot` },
            { name: `connect` },
            { name: `profile` },
            { name: `game`, gameId: `g1` },
        ] as const;
        for (const route of routes) {
            expect(parseRoute(routePath(route))).toEqual(route);
        }
    });
});
