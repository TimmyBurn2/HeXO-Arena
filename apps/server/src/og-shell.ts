import {
    botMeta,
    botsMeta,
    connectMeta,
    creditsMeta,
    welcomeMeta,
    welcomePath,
    gameMeta,
    gamesMeta,
    ladderMeta,
    legalPageMeta,
    legalPagePath,
    legalPages,
    liveGamesMeta,
    nameKeyOf,
    nameSyntaxSchema,
    notFoundMeta,
    playMeta,
    profileMeta,
    playerMeta,
    siteMeta,
    tournamentIdSchema,
    tournamentMeta,
    tournamentsMeta,
    type PageMeta,
    type Roster,
} from '@hexo-arena/contract';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { readFile } from 'node:fs/promises';
import { listBots } from './bots';
import type { Query } from './db';
import type { GameRegistry } from './game-registry';
import type { PresenceRegistry } from './presence';
import { isProvisional } from './rating';
import { activeSince } from './leaderboard-api';
import type { PlayerReads } from './player-api';
import { rankablePlayers } from './rating-store';
import { tournamentSummary } from './tournament-api';

export interface OgShellDeps {
    query: Query;
    presence: PresenceRegistry;
    games: GameRegistry;
    // The player API's own reads, so a preview never reads past its memo.
    players: PlayerReads;
    indexPath: string;
    publicOrigin: string;
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
 */
export function renderShell(template: string, meta: PageMeta, publicOrigin: string): string {
    const title = escapeHtml(meta.title);
    const description = escapeHtml(meta.description);
    let html = replaceOnce(template, /<title>[^<]*<\/title>/, `<title>${title}</title>`);
    html = replaceOnce(html, /<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${description}" />`);
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

// Pages whose meta needs no data, each at its own path.
const fixedPages: readonly (readonly [string, PageMeta])[] = [
    [`/bots`, botsMeta],
    [`/games`, gamesMeta],
    [`/games/live`, liveGamesMeta],
    [`/tournaments`, tournamentsMeta],
    [`/connect`, connectMeta],
    [`/profile`, profileMeta],
    [`/credits`, creditsMeta],
    [welcomePath, welcomeMeta],
    ...legalPages.map((page) => [legalPagePath(page), legalPageMeta[page]] as const),
];

/**
 * Every route the shell answers, in the order the proxy lists them: every
 * page of the site, so a pasted link to any of them previews with an
 * absolute image.
 */
export const shellRoutes: readonly string[] = [`/`, `/play`, `/ladder`, `/bots/:name`, `/players/:name`, `/game/:gameId`, `/tournaments/:id`, ...fixedPages.map(([path]) => path)];

/**
 * Serves the SPA shell for every page of the site, with meta from live
 * data where a page has any. The template is read per request from the
 * deployed site, so a front-end redeploy never meets a shell naming assets
 * it removed.
 */
export function registerOgShell(app: FastifyInstance, deps: OgShellDeps): void {
    const { query, presence, games, indexPath, publicOrigin, now } = deps;

    async function sendShell(reply: FastifyReply, status: 200 | 404, meta: PageMeta): Promise<FastifyReply> {
        const template = await readFile(indexPath, `utf8`);
        return reply
            .code(status)
            .header(`content-type`, `text/html; charset=utf-8`)
            .header(`cache-control`, `no-cache`)
            .send(renderShell(template, meta, publicOrigin));
    }

    function roster(): Roster {
        const listed = listBots(query);
        return {
            listed: listed.length,
            online: listed.filter((bot) => presence.isOnline(bot.id)).length,
            leader: rankablePlayers(query, { kind: `all`, activeSince: activeSince(now()) })[0],
        };
    }

    app.get(`/`, { config: { limit: `shell` } }, async (_request, reply) => sendShell(reply, 200, siteMeta(roster())));

    app.get(`/ladder`, { config: { limit: `shell` } }, async (_request, reply) => sendShell(reply, 200, ladderMeta(roster())));

    // A link to Play with a bot previews with the bot's name when the
    // directory lists it; the query is read, never logged.
    app.get<{ Querystring: { bot?: unknown } }>(`/play`, { config: { limit: `shell` } }, async (request, reply) => {
        const named = request.query.bot;
        const key = typeof named === `string` && nameSyntaxSchema.safeParse(named).success ? nameKeyOf(named) : null;
        const bot = key === null ? undefined : listBots(query).find((row) => nameKeyOf(row.name) === key);
        return sendShell(reply, 200, playMeta(bot?.name));
    });

    for (const [path, meta] of fixedPages) {
        app.get(path, { config: { limit: `shell` } }, async (_request, reply) => sendShell(reply, 200, meta));
    }

    app.get<{ Params: { name: string } }>(`/bots/:name`, { config: { limit: `shell` } }, async (request, reply) => {
        const { name } = request.params;
        const key = nameSyntaxSchema.safeParse(name).success ? nameKeyOf(name) : null;
        // The directory's own filter decides visibility, so a hidden bot
        // previews exactly as an unknown one.
        const bot = key === null ? undefined : listBots(query).find((row) => nameKeyOf(row.name) === key);
        if (bot === undefined) return sendShell(reply, 404, notFoundMeta);
        return sendShell(
            reply,
            200,
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
    });

    // A bot's name previews as a missing page here, as its own page is under Bots.
    app.get<{ Params: { name: string } }>(`/players/:name`, { config: { limit: `shell` } }, async (request, reply) => {
        const record = deps.players.record(request.params.name).value;
        return record === null || record.kind === `bot` ? sendShell(reply, 404, notFoundMeta) : sendShell(reply, 200, playerMeta(record.name, record));
    });

    app.get<{ Params: { gameId: string } }>(`/game/:gameId`, { config: { limit: `shell` } }, async (request, reply) => {
        const { gameId } = request.params;
        const headline = games.headline(gameId);
        return headline === null ? sendShell(reply, 404, notFoundMeta) : sendShell(reply, 200, gameMeta(headline));
    });

    app.get<{ Params: { id: string } }>(`/tournaments/:id`, { config: { limit: `shell` } }, async (request, reply) => {
        const { id } = request.params;
        const tournament = tournamentIdSchema.safeParse(id).success ? tournamentSummary(query, id) : null;
        return tournament === null ? sendShell(reply, 404, notFoundMeta) : sendShell(reply, 200, tournamentMeta(tournament));
    });
}
