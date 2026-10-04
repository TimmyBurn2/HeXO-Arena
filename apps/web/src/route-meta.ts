import {
    analysisMeta,
    botsMeta,
    connectMeta,
    creditsMeta,
    duelListMeta,
    duelsMeta,
    gamesMeta,
    ladderMeta,
    legalPageMeta,
    liveGamesMeta,
    notFoundMeta,
    pageTitle,
    playerMeta,
    playMeta,
    playTournamentMeta,
    profileMeta,
    reportMeta,
    siteDescription,
    siteMeta,
    tournamentsMeta,
    welcomeMeta,
    type PageMeta,
} from '@hexo-arena/contract';
import { parseRoute, type Route } from './router/route';
import { text } from './text';

/** The root's meta: the site's own title, as the server shell renders it. */
export const rootMeta: PageMeta = siteMeta();

/**
 * Title and embed description per route, from the builders the server
 * shell uses; detail routes upgrade these from fetched data, and a page
 * without data of its own takes the site's description.
 */
export function routeMeta(route: Route): PageMeta {
    switch (route.name) {
        case `home`:
            return rootMeta;
        case `play`:
            return playMeta();
        case `bot-duel`:
            return duelsMeta;
        case `play-tournament`:
            return playTournamentMeta;
        case `duel`:
            return { title: pageTitle(text.meta.duel), description: duelListMeta.description };
        case `ladder`:
            return ladderMeta();
        case `tournament`:
            return { title: pageTitle(text.meta.tournament), description: tournamentsMeta.description };
        case `bots`:
            return botsMeta;
        case `bot`:
            return { title: pageTitle(route.bot), description: siteDescription };
        case `player`:
            return playerMeta(route.player);
        case `games`:
            return gamesMeta;
        case `live-games`:
            return liveGamesMeta;
        case `games-duels`:
            return duelListMeta;
        case `games-tournaments`:
            return tournamentsMeta;
        case `analysis`:
            return analysisMeta();
        case `connect`:
            return connectMeta;
        case `profile`:
            return profileMeta;
        case `credits`:
            return creditsMeta;
        case `welcome`:
            return welcomeMeta;
        case `report`:
            return reportMeta;
        case `legal`:
            return legalPageMeta[route.page];
        case `game`:
            return { title: pageTitle(text.meta.game), description: siteDescription };
        case `moved`:
            return routeMeta(parseRoute(route.to));
        case `not-found`:
            return notFoundMeta;
    }
}
