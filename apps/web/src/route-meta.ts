import { notFoundMeta, pageMeta, siteMeta, type PageMeta } from '@hexo-arena/contract';
import { parseRoute, type Route } from './router/route';

/** The root's meta: the site's own title, as the server shell renders it. */
export const rootMeta: PageMeta = siteMeta();

/**
 * Title and embed description per route, from the page table the server
 * shell reads; detail routes upgrade these from fetched data, and a page
 * without data of its own takes the site's description.
 */
export function routeMeta(route: Route): PageMeta {
    if (route.name === `moved`) return routeMeta(parseRoute(route.to));
    if (route.name === `not-found`) return notFoundMeta;
    return pageMeta(route.name, route);
}
