import { siteName, siteTagline } from '@hexo-arena/contract';
import type { Route } from './router/route';

export interface RouteMeta {
    title: string;
    description: string;
}

const ladderDescription = `connect a bot or play in the browser; one rating for every player`;

/**
 * The root's meta: whatever screen it shows, the site's own address keeps
 * the site's title, as the server shell does.
 */
export const siteMeta: RouteMeta = {
    title: `${siteName} - ${siteTagline}`,
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
                title: `Ladder - ${siteName}`,
                description: ladderDescription,
            };
        case `bots`:
            return {
                title: `Bots - ${siteName}`,
                description: `every listed bot, online or not`,
            };
        case `bot`:
            return {
                title: `${route.bot} - ${siteName}`,
                description: `one HeXO bot, its declaration, and the play flow`,
            };
        case `connect`:
            return {
                title: `Build a bot - ${siteName}`,
                description: `from Discord sign-in to a first game`,
            };
        case `profile`:
            return {
                title: `Profile - ${siteName}`,
                description: `your identity, your bots, and sign-out`,
            };
        case `credits`:
            return {
                title: `Credits - ${siteName}`,
                description: `where the community themes come from, and their licenses`,
            };
        case `game`:
            return {
                title: `Game - ${siteName}`,
                description: `one HeXO game: board, clocks, moves`,
            };
        case `not-found`:
            return {
                title: `Not found - ${siteName}`,
                description: `that page does not exist`,
            };
    }
}
