import { analysisPagePath } from './analysis';
import { duelListMeta, duelsMeta } from './duels';
import { legalPageMeta, legalPages } from './legal';
import {
    analysisMeta,
    botsMeta,
    connectMeta,
    creditsMeta,
    gamesMeta,
    ladderMeta,
    liveGamesMeta,
    pageTitle,
    playMeta,
    profileMeta,
    siteDescription,
    siteMeta,
    welcomeMeta,
    type PageMeta,
} from './meta';
import { playerMeta } from './players';
import { reportMeta, reportPagePath } from './reports';
import { welcomePath } from './sign-in';
import { playTournamentMeta, tournamentsMeta } from './tournaments';

// The names of a path's parameters, each a segment `:name`.
type ParamNames<Path extends string> = Path extends `${string}:${infer Name}/${infer Rest}`
    ? Name | ParamNames<`/${Rest}`>
    : Path extends `${string}:${infer Name}`
      ? Name
      : never;

// The few values a parameter may take, for one that is not free text.
type ParamValues<Path extends string> = { readonly [Name in ParamNames<Path>]?: readonly string[] };

// A path's parameters, each free text unless its values are listed.
type ParamsOf<Path extends string, Values extends ParamValues<Path>> = {
    readonly [Name in ParamNames<Path>]: Values[Name] extends readonly (infer Value extends string)[] ? Value : string;
};

/** A page of the site: its path, the values a listed parameter takes, and its meta before any data of its own. */
export interface Page<Path extends string, Params> {
    readonly path: Path;
    readonly values: Readonly<Partial<Record<string, readonly string[]>>>;
    readonly meta: (params: Params) => PageMeta;
}

function page<const Path extends string, const Values extends ParamValues<Path> = ParamValues<Path>>(
    path: Path,
    meta: (params: ParamsOf<Path, Values>) => PageMeta,
    values?: Values,
): Page<Path, ParamsOf<Path, Values>> {
    return { path, meta, values: values ?? {} };
}

/**
 * Every page of the site by name, each declared once:
 * the app's route union, parser, and paths, the meta a page shows until
 * its data lands, and the paths the server's shell answers derive from it,
 * and the app's screens and nav and the shell's live previews are keyed by its names.
 */
export const sitePages = {
    home: page(`/`, () => siteMeta()),
    play: page(`/play`, () => playMeta()),
    'bot-duel': page(`/play/duels`, () => duelsMeta),
    'play-tournament': page(`/play/tournament`, () => playTournamentMeta),
    duel: page(`/duels/:id`, () => ({ title: pageTitle(`Duel`), description: duelListMeta.description })),
    ladder: page(`/ladder`, () => ladderMeta()),
    tournament: page(`/tournaments/:id`, () => ({ title: pageTitle(`Tournament`), description: tournamentsMeta.description })),
    bots: page(`/bots`, () => botsMeta),
    bot: page(`/bots/:bot`, ({ bot }) => ({ title: pageTitle(bot), description: siteDescription })),
    player: page(`/players/:player`, ({ player }) => playerMeta(player)),
    games: page(`/games`, () => gamesMeta),
    'live-games': page(`/games/live`, () => liveGamesMeta),
    'games-duels': page(`/games/duels`, () => duelListMeta),
    'games-tournaments': page(`/games/tournaments`, () => tournamentsMeta),
    analysis: page(analysisPagePath, () => analysisMeta()),
    connect: page(`/connect`, () => connectMeta),
    profile: page(`/profile`, () => profileMeta),
    credits: page(`/credits`, () => creditsMeta),
    welcome: page(welcomePath, () => welcomeMeta),
    report: page(reportPagePath, () => reportMeta),
    legal: page(`/legal/:page`, ({ page }) => legalPageMeta[page], { page: legalPages }),
    game: page(`/game/:gameId`, () => ({ title: pageTitle(`Game`), description: siteDescription })),
};

/** A page's name in the table. */
export type PageName = keyof typeof sitePages;

/** The parameters a page's path takes, by name. */
export type PageParams<Name extends PageName> = Name extends PageName ? ((typeof sitePages)[Name] extends Page<string, infer Params> ? Params : never) : never;

/** Every page's name, in the table's order. */
export const pageNames = Object.keys(sitePages) as PageName[]; // The table's own keys are exactly its names.

// Each parameter is encoded as one segment, so a name holding a slash stays one.
function fillPath(pattern: string, params: Readonly<Record<string, string>>): string {
    return pattern.replace(/:(\w+)/gu, (_, name: string) => encodeURIComponent(params[name] ?? ``));
}

/** A page's path with its parameters filled in. */
export function pagePath<Name extends PageName>(name: Name, params: PageParams<Name>): string {
    return fillPath(sitePages[name].path, params);
}

/** A page's meta before any data of its own. */
export function pageMeta<Name extends PageName>(name: Name, params: PageParams<Name>): PageMeta {
    // A name's meta takes that name's parameters, whatever union the caller holds it in.
    return (sitePages[name].meta as (params: PageParams<Name>) => PageMeta)(params);
}

/** An address that moved: the old path, and the page now at it, which takes the parameters the old path held. */
export interface MovedPage {
    readonly from: string;
    readonly to: PageName;
}

/** Every address that moved, so an old link still lands. */
export const movedPages: readonly MovedPage[] = [
    { from: `/play/duels/:id`, to: `duel` },
    { from: `/duels`, to: `games-duels` },
    { from: `/tournaments`, to: `games-tournaments` },
];

/** The new path of a moved address, from the parameters its old path held. */
export function movedPath(moved: MovedPage, params: Readonly<Record<string, string>>): string {
    return fillPath(sitePages[moved.to].path, params);
}
