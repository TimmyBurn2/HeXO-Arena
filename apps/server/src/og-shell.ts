import { nameKeyOf, nameSyntaxSchema, type FinishReason, type TimeControl } from '@hexarena/contract';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { readFile } from 'node:fs/promises';
import { listBots } from './bots';
import type { Query } from './db';
import type { GameRegistry } from './game-registry';
import type { GameHeadline } from './game-store';
import type { PresenceRegistry } from './presence';
import { isProvisional } from './rating';
import { rankablePlayers } from './rating-store';

export interface ShellMeta {
    readonly title: string;
    readonly description: string;
}

export interface OgShellDeps {
    query: Query;
    presence: PresenceRegistry;
    games: GameRegistry;
    indexPath: string;
}

export const notFoundMeta: ShellMeta = { title: `not found - hexarena`, description: `that page does not exist` };

const aboutExcerptLength = 120;

const reasonNouns: Record<FinishReason, string> = {
    'six-in-a-row': `six in a row`,
    timeout: `timeout`,
    surrender: `resignation`,
    disconnect: `disconnect`,
    terminated: `termination`,
    aborted: `abort`,
};

function plural(count: number, noun: string): string {
    return `${String(count)} ${noun}${count === 1 ? `` : `s`}`;
}

function durationWords(ms: number): string {
    return ms % 60_000 === 0 ? `${String(ms / 60_000)} min` : `${String(ms / 1000)} s`;
}

function clockWords(timeControl: TimeControl): string {
    switch (timeControl.mode) {
        case `turn`:
            return `${durationWords(timeControl.turnTimeMs)} per turn`;
        case `match`:
            return `${durationWords(timeControl.mainTimeMs)} + ${durationWords(timeControl.incrementMs)}`;
        case `unlimited`:
            return `no clock`;
    }
}

export function arenaMeta(listed: number, online: number, leader: { name: string; rating: number } | undefined): ShellMeta {
    const board = leader === undefined ? `` : `; top rated: ${leader.name} (${String(Math.round(leader.rating))})`;
    return {
        title: `hexarena - bot arena for HeXO`,
        description: `${plural(listed, `bot`)} listed, ${String(online)} online${board}`,
    };
}

export function botMeta(bot: {
    name: string;
    ownerName: string;
    rating: number;
    provisional: boolean;
    online: boolean;
    about?: string;
}): ShellMeta {
    const rated = `rated ${String(bot.rating)}${bot.provisional ? `, provisional` : ``}`;
    const about =
        bot.about === undefined
            ? ``
            : `: ${bot.about.length > aboutExcerptLength ? `${bot.about.slice(0, aboutExcerptLength)}...` : bot.about}`;
    return {
        title: `${bot.name} - hexarena`,
        description: `HeXO bot by ${bot.ownerName}, ${rated}, ${bot.online ? `online now` : `offline`}${about}`,
    };
}

export function gameMeta(headline: GameHeadline): ShellMeta {
    const title = `${headline.names.x} vs ${headline.names.o} - hexarena`;
    if (headline.status === `live`) {
        return {
            title,
            description: `live, ${headline.names[headline.toMove]} to move, ${clockWords(headline.timeControl)}`,
        };
    }
    const noun = reasonNouns[headline.reason];
    return {
        title,
        description:
            headline.winner === null
                ? `nobody won, ended by ${noun}`
                : `${headline.names[headline.winner]} won by ${noun}`,
    };
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

/** The shell with its title, description, and og tags set from the meta. */
export function renderShell(template: string, meta: ShellMeta): string {
    const title = escapeHtml(meta.title);
    const description = escapeHtml(meta.description);
    let html = replaceOnce(template, /<title>[^<]*<\/title>/, `<title>${title}</title>`);
    html = replaceOnce(html, /<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${description}" />`);
    html = replaceOnce(html, /<meta property="og:title" content="[^"]*"\s*\/?>/, `<meta property="og:title" content="${title}" />`);
    return replaceOnce(
        html,
        /<meta property="og:description" content="[^"]*"\s*\/?>/,
        `<meta property="og:description" content="${description}" />`,
    );
}

/**
 * Serves the SPA shell for the routes a pasted link previews, with meta
 * from live data. The template is read per request from the deployed site,
 * so a front-end redeploy never meets a shell naming assets it removed.
 */
export function registerOgShell(app: FastifyInstance, deps: OgShellDeps): void {
    const { query, presence, games, indexPath } = deps;

    async function sendShell(reply: FastifyReply, status: 200 | 404, meta: ShellMeta): Promise<FastifyReply> {
        const template = await readFile(indexPath, `utf8`);
        return reply
            .code(status)
            .header(`content-type`, `text/html; charset=utf-8`)
            .header(`cache-control`, `no-cache`)
            .send(renderShell(template, meta));
    }

    app.get(`/`, async (_request, reply) => {
        const listed = listBots(query);
        const online = listed.filter((bot) => presence.isOnline(bot.id)).length;
        return sendShell(reply, 200, arenaMeta(listed.length, online, rankablePlayers(query, `all`)[0]));
    });

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
                ...(bot.about !== undefined && { about: bot.about }),
            }),
        );
    });

    app.get<{ Params: { gameId: string } }>(`/game/:gameId`, async (request, reply) => {
        const { gameId } = request.params;
        const headline = games.headline(gameId);
        return headline === null ? sendShell(reply, 404, notFoundMeta) : sendShell(reply, 200, gameMeta(headline));
    });
}
