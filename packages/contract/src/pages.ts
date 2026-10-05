import { analysisPagePath } from './analysis';
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
    'play-tournament': page(`/play/tournament`, () => playTournamentMeta),
    ladder: page(`/ladder`, () => ladderMeta()),
    tournament: page(`/tournaments/:id`, () => ({ title: pageTitle(`Tournament`), description: tournamentsMeta.description })),
    bots: page(`/bots`, () => botsMeta),
    bot: page(`/bots/:bot`, ({ bot }) => ({ title: pageTitle(bot), description: siteDescription })),
    player: page(`/players/:player`, ({ player }) => playerMeta(player)),
    games: page(`/games`, () => gamesMeta),
    'live-games': page(`/games/live`, () => liveGamesMeta),
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

/** An address that moved: the old path, the page now at it, which takes the parameters the old path held, and how its query reads there. */
export interface MovedPage {
    readonly from: string;
    readonly to: PageName;
    /** The query the new page reads for the old one's; the old query as it stands when absent. */
    readonly query?: (old: URLSearchParams) => URLSearchParams;
}

// A duel's setup as its old link carried it, its two bots and their
// strengths, read as the setup of a tournament of those two bots; its
// games, clock, and opening read alike in both.
function duelSetupQuery(old: URLSearchParams): URLSearchParams {
    const query = new URLSearchParams();
    const picked = [
        { name: old.get(`first`), level: old.get(`firstLevel`) },
        { name: old.get(`second`), level: old.get(`secondLevel`) },
    ].flatMap((bot) => (bot.name === null || bot.name === `` ? [] : [{ name: bot.name, level: bot.level }]));
    if (picked.length > 0) query.set(`bots`, picked.map((bot) => bot.name).join(`,`));
    for (const bot of picked) if (bot.level !== null && bot.level !== ``) query.append(`level`, `${bot.name}:${bot.level}`);
    for (const key of [`games`, `clock`, `opening`]) {
        const value = old.get(key);
        if (value !== null) query.set(key, value);
    }
    return query;
}

/** Every address that moved, so an old link still lands. */
export const movedPages: readonly MovedPage[] = [
    { from: `/play/duels/:id`, to: `tournament` },
    { from: `/duels/:id`, to: `tournament` },
    { from: `/play/duels`, to: `play-tournament`, query: duelSetupQuery },
    { from: `/games/duels`, to: `games-tournaments` },
    { from: `/duels`, to: `games-tournaments` },
    { from: `/tournaments`, to: `games-tournaments` },
];

/** The new address of a moved one, from the parameters its old path held and its query, a leading question mark or none. */
export function movedPath(moved: MovedPage, params: Readonly<Record<string, string>>, search = ``): string {
    const path = fillPath(sitePages[moved.to].path, params);
    const old = new URLSearchParams(search);
    const query = (moved.query === undefined ? old : moved.query(old)).toString();
    return query === `` ? path : `${path}?${query}`;
}
