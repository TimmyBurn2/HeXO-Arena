import { legalPagePath, legalPages, welcomePath, type LegalPage } from '@hexo-arena/contract';

export type Route =
    | { readonly name: `home` }
    | { readonly name: `play` }
    | { readonly name: `ladder` }
    | { readonly name: `tournaments` }
    | { readonly name: `tournament`; readonly id: string }
    | { readonly name: `bots` }
    | { readonly name: `bot`; readonly bot: string }
    | { readonly name: `player`; readonly player: string }
    | { readonly name: `games` }
    | { readonly name: `live-games` }
    | { readonly name: `connect` }
    | { readonly name: `profile` }
    | { readonly name: `credits` }
    | { readonly name: `welcome` }
    | { readonly name: `legal`; readonly page: LegalPage }
    | { readonly name: `game`; readonly gameId: string }
    | { readonly name: `not-found` };

/** The whole route table: parse a pathname, or build one back. */
export function parseRoute(pathname: string): Route {
    const path = pathname.length > 1 && pathname.endsWith(`/`) ? pathname.slice(0, -1) : pathname;
    const segments = path.split(`/`).filter((segment) => segment !== ``);
    const [head, second] = segments;
    if (segments.length === 0) return { name: `home` };
    if (head === `play` && segments.length === 1) return { name: `play` };
    if (head === `ladder` && segments.length === 1) return { name: `ladder` };
    if (head === `tournaments` && segments.length === 1) return { name: `tournaments` };
    if (head === `tournaments` && segments.length === 2 && second !== undefined) return { name: `tournament`, id: safeDecode(second) };
    if (head === `bots` && segments.length === 1) return { name: `bots` };
    if (head === `bots` && segments.length === 2 && second !== undefined) {
        return { name: `bot`, bot: safeDecode(second) };
    }
    if (head === `players` && segments.length === 2 && second !== undefined) return { name: `player`, player: safeDecode(second) };
    if (head === `games` && segments.length === 1) return { name: `games` };
    if (head === `games` && second === `live` && segments.length === 2) return { name: `live-games` };
    if (head === `connect` && segments.length === 1) return { name: `connect` };
    if (head === `profile` && segments.length === 1) return { name: `profile` };
    if (head === `credits` && segments.length === 1) return { name: `credits` };
    if (head === `welcome` && segments.length === 1) return { name: `welcome` };
    if (head === `legal` && segments.length === 2) {
        const page = legalPages.find((candidate) => candidate === second);
        if (page !== undefined) return { name: `legal`, page };
    }
    if (head === `game` && segments.length === 2 && second !== undefined) {
        return { name: `game`, gameId: safeDecode(second) };
    }
    return { name: `not-found` };
}

export function routePath(route: Route): string {
    switch (route.name) {
        case `home`:
            return `/`;
        case `play`:
            return `/play`;
        case `ladder`:
            return `/ladder`;
        case `tournaments`:
            return `/tournaments`;
        case `tournament`:
            return `/tournaments/${encodeURIComponent(route.id)}`;
        case `bots`:
            return `/bots`;
        case `bot`:
            return `/bots/${encodeURIComponent(route.bot)}`;
        case `player`:
            return `/players/${encodeURIComponent(route.player)}`;
        case `games`:
            return `/games`;
        case `live-games`:
            return `/games/live`;
        case `connect`:
            return `/connect`;
        case `profile`:
            return `/profile`;
        case `credits`:
            return `/credits`;
        case `welcome`:
            return welcomePath;
        case `legal`:
            return legalPagePath(route.page);
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
