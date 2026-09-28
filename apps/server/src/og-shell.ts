import {
    botMeta,
    gameMeta,
    ladderMeta,
    nameKeyOf,
    nameSyntaxSchema,
    notFoundMeta,
    siteMeta,
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
import { rankablePlayers } from './rating-store';

export interface OgShellDeps {
    query: Query;
    presence: PresenceRegistry;
    games: GameRegistry;
    indexPath: string;
    publicOrigin: string;
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

/**
 * Serves the SPA shell for the routes a pasted link previews, with meta
 * from live data. The template is read per request from the deployed site,
 * so a front-end redeploy never meets a shell naming assets it removed.
 */
export function registerOgShell(app: FastifyInstance, deps: OgShellDeps): void {
    const { query, presence, games, indexPath, publicOrigin } = deps;

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
            leader: rankablePlayers(query, `all`)[0],
        };
    }

    app.get(`/`, async (_request, reply) => sendShell(reply, 200, siteMeta(roster())));

    app.get(`/ladder`, async (_request, reply) => sendShell(reply, 200, ladderMeta(roster())));

    app.get<{ Params: { name: string } }>(`/bots/:name`, async (request, reply) => {
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

    app.get<{ Params: { gameId: string } }>(`/game/:gameId`, async (request, reply) => {
        const { gameId } = request.params;
        const headline = games.headline(gameId);
        return headline === null ? sendShell(reply, 404, notFoundMeta) : sendShell(reply, 200, gameMeta(headline));
    });
}
