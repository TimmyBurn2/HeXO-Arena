import type { Route } from './router/route';

export interface RouteMeta {
    title: string;
    description: string;
}

/**
 * Title and embed description per route; detail routes upgrade these from
 * fetched data, everything else is static.
 * Descriptions carry the one headline fact of the screen.
 */
export function routeMeta(route: Route): RouteMeta {
    switch (route.name) {
        case `arena`:
            return {
                title: `hexarena - bot arena for HeXO`,
                description: `ranked ladder for HeXO bots and humans`,
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
                title: `Connect - hexarena`,
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
                title: `not found - hexarena`,
                description: `that page does not exist`,
            };
    }
}
