import {
    analysisMeta,
    botMeta,
    duelMeta,
    gameMeta,
    ladderMeta,
    movedPages,
    movedPath,
    nameKeyOf,
    nameSyntaxSchema,
    notFoundMeta,
    pageMeta,
    pageNames,
    playerMeta,
    playMeta,
    reportFormMetaName,
    reportMeta,
    siteMeta,
    sitePages,
    tournamentIdSchema,
    tournamentMeta,
    type PageMeta,
    type PageName,
    type PageParams,
    type Roster,
} from '@hexo-arena/contract';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { listBots } from './bots';
import type { Query } from './db';
import { duelSummary } from './duel-api';
import type { GameRegistry } from './game-registry';
import type { Ladder } from './ladder';
import type { PresenceRegistry } from './presence';
import { isProvisional } from './rating';
import { activeSince } from './leaderboard-api';
import type { PlayerReads } from './player-api';
import { tournamentSummary } from './tournament-api';

interface OgShellDeps {
    query: Query;
    presence: PresenceRegistry;
    games: GameRegistry;
    // The API's own reads, so a preview never reads past their memos.
    ladder: Pick<Ladder, `read`>;
    players: PlayerReads;
    indexPath: string;
    publicOrigin: string;
    reportForm: boolean;
    now: () => number;
}

function escapeHtml(text: string): string {
    return text
        .replaceAll(`&`, `&amp;`)
        .replaceAll(`<`, `&lt;`)
        .replaceAll(`>`, `&gt;`)
        .replaceAll(`"`, `&quot;`)
        .replaceAll(`'`, `&#39;`);
}

// Each tag must appear exactly once: a shell that lost one would preview
// with the static text and nobody would notice, so drift fails loudly.
function replaceOnce(html: string, pattern: RegExp, replacement: string): string {
    const matches = html.match(new RegExp(pattern.source, `g`)) ?? [];
    if (matches.length !== 1) throw new Error(`the shell template holds ${String(matches.length)} of ${pattern.source}`);
    return html.replace(pattern, () => replacement);
}

/**
 * The shell with its title, description, and og tags set from the meta,
 * and its preview image on the public origin, since a preview needs an
 * absolute address and the page's own is a path.
 * Where the site takes reports through its form, the shell says so in a
 * meta tag the app reads at start, since the policy allows no inline script.
 */
export function renderShell(template: string, meta: PageMeta, publicOrigin: string, reportForm: boolean): string {
    const title = escapeHtml(meta.title);
    const description = escapeHtml(meta.description);
    const reportFormTag = reportForm ? `<meta name="${reportFormMetaName}" content="on" />` : ``;
    let html = replaceOnce(template, /<title>[^<]*<\/title>/, `<title>${title}</title>`);
    html = replaceOnce(html, /<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${description}" />${reportFormTag}`);
    html = replaceOnce(html, /<meta property="og:title" content="[^"]*"\s*\/?>/, `<meta property="og:title" content="${title}" />`);
    html = replaceOnce(
        html,
        /<meta property="og:description" content="[^"]*"\s*\/?>/,
        `<meta property="og:description" content="${description}" />`,
    );
    const image = /<meta property="og:image" content="(\/[^"]*)"\s*\/?>/;
    const path = image.exec(html)?.[1] ?? ``;
    return replaceOnce(html, image, `<meta property="og:image" content="${escapeHtml(publicOrigin + path)}" />`);
}

// The ids a game takes, so a query never reaches a read with arbitrary text.
const gameIdPattern = /^[A-Za-z0-9_-]{1,100}$/u;

// One path the shell answers for a page: its pattern, with the parameters a listed value fixes.
interface ShellPath {
    readonly name: PageName;
    readonly path: string;
    readonly fixed: Readonly<Record<string, string>>;
}

// A parameter that takes a few listed values is answered at one path per value,
// so the proxy can tell those pages from files beside them.
function shellPathsOf(name: PageName): ShellPath[] {
    let paths: ShellPath[] = [{ name, path: sitePages[name].path, fixed: {} }];
    for (const [param, values] of Object.entries(sitePages[name].values)) {
        paths = paths.flatMap((held) => (values ?? []).map((value) => ({ name, path: held.path.replace(`:${param}`, value), fixed: { ...held.fixed, [param]: value } })));
    }
    return paths;
}

const pagePaths: readonly ShellPath[] = pageNames.flatMap(shellPathsOf);

/**
 * Every route the shell answers: every page of the site, so a pasted link
 * to any of them previews with an absolute image, and every page that
 * moved, so an old link reaches the app.
 */
export const shellRoutes: readonly string[] = [...pagePaths.map((held) => held.path), ...movedPages.map((moved) => moved.from)];

const routeParamsSchema = z.record(z.string(), z.string());

function paramsOf<Name extends PageName>(_page: Name, named: unknown, fixed: Readonly<Record<string, string>>): PageParams<Name> {
    // Fastify names exactly the pattern's parameters, and a listed value fixes the rest.
    return { ...routeParamsSchema.parse(named), ...fixed } as PageParams<Name>;
}

// A query parameter given once, as text; any other shape names nothing.
function queryText(query: unknown, name: string): string | null {
    if (typeof query !== `object` || query === null) return null;
    const value: unknown = Reflect.get(query, name);
    return typeof value === `string` ? value : null;
}

// What the shell answers for a page: its status, and the meta its preview shows.
interface ShellAnswer {
    readonly status: 200 | 404;
    readonly meta: PageMeta;
}

const missingPage: ShellAnswer = { status: 404, meta: notFoundMeta };

function found(meta: PageMeta): ShellAnswer {
    return { status: 200, meta };
}

// The pages whose preview reads live data, by name; every other page answers with its table meta.
type LiveAnswers = { readonly [Name in PageName]?: (params: PageParams<Name>, query: unknown) => ShellAnswer };

/**
 * Serves the SPA shell for every page of the site, with meta from live
 * data where a page has any. The template is read per request from the
 * deployed site, so a front-end redeploy never meets a shell naming assets
 * it removed.
 */
export function registerOgShell(app: FastifyInstance, deps: OgShellDeps): void {
    const { query, presence, games, ladder, indexPath, publicOrigin, reportForm, now } = deps;

    async function sendShell(reply: FastifyReply, answer: ShellAnswer): Promise<FastifyReply> {
        const template = await readFile(indexPath, `utf8`);
        return reply
            .code(answer.status)
            .header(`content-type`, `text/html; charset=utf-8`)
            .header(`cache-control`, `no-cache`)
            .send(renderShell(template, answer.meta, publicOrigin, reportForm));
    }

    function roster(): Roster {
        const listed = listBots(query);
        return {
            listed: listed.length,
            online: listed.filter((bot) => presence.isOnline(bot.id)).length,
            leader: ladder.read(`all`, activeSince(now()))[0],
        };
    }

    // The directory's own filter decides visibility, so a hidden bot
    // previews exactly as an unknown one.
    function listedBot(name: string | null) {
        const key = name !== null && nameSyntaxSchema.safeParse(name).success ? nameKeyOf(name) : null;
        return key === null ? undefined : listBots(query).find((row) => nameKeyOf(row.name) === key);
    }

    const live: LiveAnswers = {
        home: () => found(siteMeta(roster())),
        ladder: () => found(ladderMeta(roster())),
        // A link to Play with a bot previews with the bot's name when the
        // directory lists it; the query is read, never logged.
        play: (_, asked) => found(playMeta(listedBot(queryText(asked, `bot`))?.name)),
        // A link to the analysis board with a stored game names that game once
        // it has finished; a live one previews as the plain board, since the
        // board opens no live game. The query is read, never logged.
        analysis: (_, asked) => {
            const named = queryText(asked, `game`);
            const headline = named !== null && gameIdPattern.test(named) ? games.headline(named) : null;
            return found(headline?.status === `finished` ? analysisMeta(headline) : analysisMeta());
        },
        // The proxy sends the form's path here whatever the setting, so
        // with the form off it is a missing page, as the app shows it.
        report: () => (reportForm ? found(reportMeta) : missingPage),
        bot: ({ bot: name }) => {
            const bot = listedBot(name);
            if (bot === undefined) return missingPage;
            return found(
                botMeta({
                    name: bot.name,
                    ownerName: bot.ownerName,
                    rating: Math.round(bot.rating.rating),
                    provisional: isProvisional(bot.rating),
                    online: presence.isOnline(bot.id),
                    openForChallenges: presence.isOpenForChallenges(bot.id),
                    about: bot.about,
                }),
            );
        },
        // A bot's name previews as a missing page here, as its own page is under Bots.
        player: ({ player }) => {
            const record = deps.players.record(player).value;
            return record === null || record.kind === `bot` ? missingPage : found(playerMeta(record.name, record));
        },
        game: ({ gameId }) => {
            const headline = games.headline(gameId);
            return headline === null ? missingPage : found(gameMeta(headline));
        },
        tournament: ({ id }) => {
            const tournament = tournamentIdSchema.safeParse(id).success ? tournamentSummary(query, id) : null;
            return tournament === null ? missingPage : found(tournamentMeta(tournament));
        },
        duel: ({ id }) => {
            const duel = duelSummary(query, id);
            return duel === null ? missingPage : found(duelMeta(duel));
        },
    };

    function answer<Name extends PageName>(name: Name, params: PageParams<Name>, asked: unknown): ShellAnswer {
        return live[name]?.(params, asked) ?? found(pageMeta(name, params));
    }

    for (const { name, path, fixed } of pagePaths) {
        app.get(path, { config: { limit: `shell` } }, async (request, reply) => sendShell(reply, answer(name, paramsOf(name, request.params, fixed), request.query)));
    }

    // Permanent, so a preview or a search follows the move once; the query is dropped, as no moved page reads one.
    for (const moved of movedPages) {
        app.get(moved.from, { config: { limit: `shell` } }, async (request, reply) => reply.redirect(movedPath(moved, routeParamsSchema.parse(request.params)), 301));
    }
}
