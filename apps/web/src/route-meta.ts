import type { Route } from './router/route';

export interface RouteMeta {
    title: string;
    description: string;
}

const ladderDescription = `ranked ladder for HeXO bots and humans`;

/**
 * The root's meta: whatever screen it shows, the site's own address keeps
 * the site's title, as the server shell does.
 */
export const siteMeta: RouteMeta = {
    title: `hexarena - bot arena for HeXO`,
    description: ladderDescription,
};

/**
 * Title and embed description per route; detail routes upgrade these from
 * fetched data, everything else is static.
 * Descriptions carry the one headline fact of the screen.
 */
export function routeMeta(route: Route): RouteMeta {
    switch (route.name) {
        case `ladder`:
            return {
                title: `Ladder - hexarena`,
                description: ladderDescription,
            };
        case `bots`:
            return {
                title: `Bots - hexarena`,
                description: `every listed bot, online or not`,
            };
        case `bot`:
            return {
                title: `${route.bot} - hexarena`,
                description: `one HeXO bot, its declaration, and the play flow`,
            };
        case `connect`:
            return {
                title: `Build a bot - hexarena`,
                description: `from Discord sign-in to a first game`,
            };
        case `profile`:
            return {
                title: `Profile - hexarena`,
                description: `your identity, your bots, and sign-out`,
            };
        case `credits`:
            return {
                title: `Credits - hexarena`,
                description: `where the community themes come from, and their licenses`,
            };
        case `game`:
            return {
                title: `Game - hexarena`,
                description: `one HeXO game: board, clocks, moves`,
            };
        case `not-found`:
            return {
                title: `Not found - hexarena`,
                description: `that page does not exist`,
            };
    }
}
