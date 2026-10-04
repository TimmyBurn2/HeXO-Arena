import { analysisPagePath, legalPagePath, legalPages, reportPagePath, welcomePath, type LegalPage } from '@hexo-arena/contract';
import { reportForm } from '../report-form';

export type Route =
    | { readonly name: `home` }
    | { readonly name: `play` }
    | { readonly name: `bot-duel` }
    | { readonly name: `play-tournament` }
    | { readonly name: `duel`; readonly id: string }
    | { readonly name: `ladder` }
    | { readonly name: `tournament`; readonly id: string }
    | { readonly name: `bots` }
    | { readonly name: `bot`; readonly bot: string }
    | { readonly name: `player`; readonly player: string }
    | { readonly name: `games` }
    | { readonly name: `live-games` }
    | { readonly name: `games-duels` }
    | { readonly name: `games-tournaments` }
    | { readonly name: `analysis` }
    | { readonly name: `connect` }
    | { readonly name: `profile` }
    | { readonly name: `credits` }
    | { readonly name: `welcome` }
    | { readonly name: `report` }
    | { readonly name: `legal`; readonly page: LegalPage }
    | { readonly name: `game`; readonly gameId: string }
    | { readonly name: `moved`; readonly to: string }
    | { readonly name: `not-found` };

/**
 * The whole route table: parse a pathname, or build one back.
 * A page that moved parses as `moved`, naming its new path, which the
 * shell takes the reader on to in place.
 */
export function parseRoute(pathname: string): Route {
    const path = pathname.length > 1 && pathname.endsWith(`/`) ? pathname.slice(0, -1) : pathname;
    const segments = path.split(`/`).filter((segment) => segment !== ``);
    const [head, second, third] = segments;
    if (segments.length === 0) return { name: `home` };
    if (head === `play` && segments.length === 1) return { name: `play` };
    if (head === `play` && second === `duels` && segments.length === 2) return { name: `bot-duel` };
    if (head === `play` && second === `tournament` && segments.length === 2) return { name: `play-tournament` };
    if (head === `play` && second === `duels` && segments.length === 3 && third !== undefined) return { name: `moved`, to: routePath({ name: `duel`, id: safeDecode(third) }) };
    if (head === `duels` && segments.length === 1) return { name: `moved`, to: routePath({ name: `games-duels` }) };
    if (head === `duels` && segments.length === 2 && second !== undefined) return { name: `duel`, id: safeDecode(second) };
    if (head === `ladder` && segments.length === 1) return { name: `ladder` };
    if (head === `tournaments` && segments.length === 1) return { name: `moved`, to: routePath({ name: `games-tournaments` }) };
    if (head === `tournaments` && segments.length === 2 && second !== undefined) return { name: `tournament`, id: safeDecode(second) };
    if (head === `bots` && segments.length === 1) return { name: `bots` };
    if (head === `bots` && segments.length === 2 && second !== undefined) {
        return { name: `bot`, bot: safeDecode(second) };
    }
    if (head === `players` && segments.length === 2 && second !== undefined) return { name: `player`, player: safeDecode(second) };
    if (head === `games` && segments.length === 1) return { name: `games` };
    if (head === `games` && second === `live` && segments.length === 2) return { name: `live-games` };
    if (head === `games` && second === `duels` && segments.length === 2) return { name: `games-duels` };
    if (head === `games` && second === `tournaments` && segments.length === 2) return { name: `games-tournaments` };
    if (head === `analysis` && segments.length === 1) return { name: `analysis` };
    if (head === `connect` && segments.length === 1) return { name: `connect` };
    if (head === `profile` && segments.length === 1) return { name: `profile` };
    if (head === `credits` && segments.length === 1) return { name: `credits` };
    if (head === `welcome` && segments.length === 1) return { name: `welcome` };
    if (head === `report` && segments.length === 1 && reportForm.on()) return { name: `report` };
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
        case `bot-duel`:
            return `/play/duels`;
        case `play-tournament`:
            return `/play/tournament`;
        case `duel`:
            return `/duels/${encodeURIComponent(route.id)}`;
        case `ladder`:
            return `/ladder`;
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
        case `games-duels`:
            return `/games/duels`;
        case `games-tournaments`:
            return `/games/tournaments`;
        case `analysis`:
            return analysisPagePath;
        case `connect`:
            return `/connect`;
        case `profile`:
            return `/profile`;
        case `credits`:
            return `/credits`;
        case `welcome`:
            return welcomePath;
        case `report`:
            return reportPagePath;
        case `legal`:
            return legalPagePath(route.page);
        case `game`:
            return `/game/${encodeURIComponent(route.gameId)}`;
        case `moved`:
            return route.to;
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
