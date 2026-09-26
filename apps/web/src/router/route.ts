export type Route =
    | { readonly name: `arena` }
    | { readonly name: `bots` }
    | { readonly name: `bot`; readonly bot: string }
    | { readonly name: `connect` }
    | { readonly name: `profile` }
    | { readonly name: `credits` }
    | { readonly name: `game`; readonly gameId: string }
    | { readonly name: `not-found` };

/**
 * The whole route table: parse a pathname, or build one back.
 * Client paths are the four surfaces and the credits, plus the bot and
 * game detail routes the server shell-renders with og tags.
 */
export function parseRoute(pathname: string): Route {
    const path = pathname.length > 1 && pathname.endsWith(`/`) ? pathname.slice(0, -1) : pathname;
    const segments = path.split(`/`).filter((segment) => segment !== ``);
    const [head, second] = segments;
    if (segments.length === 0) return { name: `arena` };
    if (head === `bots` && segments.length === 1) return { name: `bots` };
    if (head === `bots` && segments.length === 2 && second !== undefined) {
        return { name: `bot`, bot: safeDecode(second) };
    }
    if (head === `connect` && segments.length === 1) return { name: `connect` };
    if (head === `profile` && segments.length === 1) return { name: `profile` };
    if (head === `credits` && segments.length === 1) return { name: `credits` };
    if (head === `game` && segments.length === 2 && second !== undefined) {
        return { name: `game`, gameId: safeDecode(second) };
    }
    return { name: `not-found` };
}

export function routePath(route: Route): string {
    switch (route.name) {
        case `arena`:
            return `/`;
        case `bots`:
            return `/bots`;
        case `bot`:
            return `/bots/${encodeURIComponent(route.bot)}`;
        case `connect`:
            return `/connect`;
        case `profile`:
            return `/profile`;
        case `credits`:
            return `/credits`;
        case `game`:
            return `/game/${encodeURIComponent(route.gameId)}`;
        case `not-found`:
            return `/404`;
    }
}

function safeDecode(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}
