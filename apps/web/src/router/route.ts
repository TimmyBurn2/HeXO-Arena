import { movedPages, movedPath, pageNames, pagePath, sitePages, type MovedPage, type PageName, type PageParams } from '@hexo-arena/contract';
import { reportForm } from '../report-form';

/** One page of the site with its parameters, as the address names it. */
export type PageRoute<Name extends PageName = PageName> = Name extends PageName ? { readonly name: Name } & PageParams<Name> : never;

/**
 * Where the reader is: a page of the site's table, an old address on its
 * way to the page that took its place, or nothing the site has.
 */
export type Route = PageRoute | { readonly name: `moved`; readonly to: string } | { readonly name: `not-found` };

// The parameters a path's segments give a pattern, decoded, or null when the path is not the pattern's;
// a parameter with listed values takes only those.
function matched(pattern: string, segments: readonly string[], values: Readonly<Partial<Record<string, readonly string[]>>>): Record<string, string> | null {
    const parts = pattern.split(`/`).filter((part) => part !== ``);
    if (parts.length !== segments.length) return null;
    const params: Record<string, string> = {};
    for (const [index, part] of parts.entries()) {
        const segment = segments[index] ?? ``;
        if (!part.startsWith(`:`)) {
            if (part !== segment) return null;
            continue;
        }
        const name = part.slice(1);
        const value = safeDecode(segment);
        if (values[name]?.includes(value) === false) return null;
        params[name] = value;
    }
    return params;
}

/**
 * The route a pathname names, a trailing slash ignored.
 * A page that moved parses as `moved`, naming its new path, which the
 * shell takes the reader on to in place.
 */
export function parseRoute(pathname: string): Route {
    const segments = pathname.split(`/`).filter((segment) => segment !== ``);
    const moved = movedOf(segments);
    if (moved !== null) return { name: `moved`, to: movedPath(moved.page, moved.params) };
    for (const name of pageNames) {
        // The report form is a page only where the site takes reports through it.
        if (name === `report` && !reportForm.on()) continue;
        const params = matched(sitePages[name].path, segments, sitePages[name].values);
        // The params match the page's pattern, so they are exactly its parameters.
        if (params !== null) return { name, ...params } as PageRoute;
    }
    return { name: `not-found` };
}

// The moved address a path's segments name, with the parameters its old path held.
function movedOf(segments: readonly string[]): { page: MovedPage; params: Record<string, string> } | null {
    for (const page of movedPages) {
        const params = matched(page.from, segments, {});
        if (params !== null) return { page, params };
    }
    return null;
}

/** Where an address that moved goes: its new path, and its query as the new page reads it; null for one that did not move. */
export function movedTo(pathname: string, search: string): string | null {
    const moved = movedOf(pathname.split(`/`).filter((segment) => segment !== ``));
    return moved === null ? null : movedPath(moved.page, moved.params, search);
}

/** The path a route names; a missing page's is the conventional /404. */
export function routePath(route: Route): string {
    if (route.name === `moved`) return route.to;
    if (route.name === `not-found`) return `/404`;
    return pagePath(route.name, route);
}

function safeDecode(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}
