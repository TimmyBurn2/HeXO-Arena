import {
    botsMeta,
    connectMeta,
    creditsMeta,
    ladderMeta,
    legalPageMeta,
    notFoundMeta,
    pageTitle,
    playMeta,
    profileMeta,
    siteDescription,
    siteMeta,
    welcomeMeta,
    type PageMeta,
} from '@hexo-arena/contract';
import type { Route } from './router/route';
import { text } from './text';

/**
 * The root's meta: whatever screen it shows, the site's own address keeps
 * the site's title, as the server shell does.
 */
export const rootMeta: PageMeta = siteMeta();

/**
 * Title and embed description per route, from the builders the server
 * shell uses; detail routes upgrade these from fetched data, and a page
 * without data of its own takes the site's description.
 */
export function routeMeta(route: Route): PageMeta {
    switch (route.name) {
        case `play`:
            return playMeta();
        case `ladder`:
            return ladderMeta();
        case `bots`:
            return botsMeta;
        case `bot`:
            return { title: pageTitle(route.bot), description: siteDescription };
        case `connect`:
            return connectMeta;
        case `profile`:
            return profileMeta;
        case `credits`:
            return creditsMeta;
        case `welcome`:
            return welcomeMeta;
        case `legal`:
            return legalPageMeta[route.page];
        case `game`:
            return { title: pageTitle(text.meta.game), description: siteDescription };
        case `not-found`:
            return notFoundMeta;
    }
}
