import { describe, expect, it } from 'vitest';
import { parseRoute, routePath } from '../src/router/route';

describe('parseRoute', () => {
    it('route the root home and /ladder to the ladder', () => {
        expect(parseRoute(`/`)).toEqual({ name: `home` });
        expect(routePath({ name: `home` })).toBe(`/`);
        expect(parseRoute(`/ladder`)).toEqual({ name: `ladder` });
        expect(parseRoute(`/ladder/`)).toEqual({ name: `ladder` });
    });

    it('route the tournaments under the ladder', () => {
        expect(parseRoute(`/tournaments`)).toEqual({ name: `tournaments` });
        expect(parseRoute(`/tournaments/t_abcdefghijk2`)).toEqual({ name: `tournament`, id: `t_abcdefghijk2` });
        expect(routePath({ name: `tournament`, id: `t_abcdefghijk2` })).toBe(`/tournaments/t_abcdefghijk2`);
        expect(parseRoute(`/tournaments/a/b`)).toEqual({ name: `not-found` });
    });

    it('route the four surfaces', () => {
        expect(parseRoute(`/bots`)).toEqual({ name: `bots` });
        expect(parseRoute(`/connect`)).toEqual({ name: `connect` });
        expect(parseRoute(`/profile`)).toEqual({ name: `profile` });
        expect(parseRoute(`/credits`)).toEqual({ name: `credits` });
    });

    it('route the finished games to /games and the live ones under it, and nothing else there', () => {
        expect(parseRoute(`/games`)).toEqual({ name: `games` });
        expect(parseRoute(`/games/`)).toEqual({ name: `games` });
        expect(routePath({ name: `games` })).toBe(`/games`);
        expect(parseRoute(`/games/live`)).toEqual({ name: `live-games` });
        expect(parseRoute(`/games/live/`)).toEqual({ name: `live-games` });
        expect(routePath({ name: `live-games` })).toBe(`/games/live`);
        expect(parseRoute(`/games/finished`)).toEqual({ name: `not-found` });
    });

    it('route the first sign-in to its own page', () => {
        expect(parseRoute(`/report`)).toEqual({ name: `report` });
        expect(routePath({ name: `report` })).toBe(`/report`);
        expect(parseRoute(`/report/x`)).toEqual({ name: `not-found` });
        expect(parseRoute(`/welcome`)).toEqual({ name: `welcome` });
        expect(routePath({ name: `welcome` })).toBe(`/welcome`);
        expect(parseRoute(`/welcome/x`)).toEqual({ name: `not-found` });
    });

    it('carry the bot name, the player name, and the game id', () => {
        expect(parseRoute(`/bots/sealbot`)).toEqual({ name: `bot`, bot: `sealbot` });
        expect(parseRoute(`/players/ana`)).toEqual({ name: `player`, player: `ana` });
        expect(parseRoute(`/game/g-123`)).toEqual({ name: `game`, gameId: `g-123` });
    });

    it('decode encoded path segments', () => {
        expect(parseRoute(`/bots/se%61lbot`)).toEqual({ name: `bot`, bot: `sealbot` });
    });

    it('ignore a trailing slash', () => {
        expect(parseRoute(`/bots/`)).toEqual({ name: `bots` });
    });

    it('route the three legal pages under /legal', () => {
        expect(parseRoute(`/legal/imprint`)).toEqual({ name: `legal`, page: `imprint` });
        expect(parseRoute(`/legal/privacy/`)).toEqual({ name: `legal`, page: `privacy` });
        expect(parseRoute(`/legal/terms`)).toEqual({ name: `legal`, page: `terms` });
        expect(parseRoute(`/legal`)).toEqual({ name: `not-found` });
        expect(parseRoute(`/legal/licenses`)).toEqual({ name: `not-found` });
        expect(parseRoute(`/legal/terms/x`)).toEqual({ name: `not-found` });
    });

    it('fall through to not-found for anything else', () => {
        expect(parseRoute(`/nope`)).toEqual({ name: `not-found` });
        expect(parseRoute(`/bots/a/b`)).toEqual({ name: `not-found` });
        expect(parseRoute(`/players`)).toEqual({ name: `not-found` });
        expect(parseRoute(`/players/a/b`)).toEqual({ name: `not-found` });
        expect(parseRoute(`/game`)).toEqual({ name: `not-found` });
        expect(parseRoute(`/ladder/x`)).toEqual({ name: `not-found` });
    });
});

describe('routePath', () => {
    it('builds the path for every route', () => {
        expect(routePath({ name: `ladder` })).toBe(`/ladder`);
        expect(routePath({ name: `bots` })).toBe(`/bots`);
        expect(routePath({ name: `bot`, bot: `sealbot` })).toBe(`/bots/sealbot`);
        expect(routePath({ name: `player`, player: `j\u00e9r\u00f4me` })).toBe(`/players/j%C3%A9r%C3%B4me`);
        expect(routePath({ name: `connect` })).toBe(`/connect`);
        expect(routePath({ name: `profile` })).toBe(`/profile`);
        expect(routePath({ name: `credits` })).toBe(`/credits`);
        expect(routePath({ name: `game`, gameId: `g1` })).toBe(`/game/g1`);
        expect(routePath({ name: `legal`, page: `privacy` })).toBe(`/legal/privacy`);
    });

    it('round-trips through parseRoute', () => {
        const routes = [
            { name: `ladder` },
            { name: `bots` },
            { name: `bot`, bot: `sealbot` },
            { name: `live-games` },
            { name: `connect` },
            { name: `profile` },
            { name: `credits` },
            { name: `game`, gameId: `g1` },
            { name: `legal`, page: `imprint` },
            { name: `legal`, page: `privacy` },
            { name: `legal`, page: `terms` },
        ] as const;
        for (const route of routes) {
            expect(parseRoute(routePath(route))).toEqual(route);
        }
    });
});
