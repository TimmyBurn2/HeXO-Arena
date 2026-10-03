import {
    parseClockArg,
    adminRequestSchema,
    adminResponseSchema,
    clientCensusDays,
    type AdminBot,
    type AdminRequest,
    type AdminResponse,
    type AdminStatus,
    type AdminTournamentRule,
    type TimeControl,
} from '@hexo-arena/contract';
import { connect } from 'node:net';
import { parseArgs } from 'node:util';

export const adminUsage = `usage: hexo-arena-admin <op> [target] [--reason <text>]

  status
  backup [label]
  bot <name>
  pause --reason <text>
  resume --reason <text>
  ban-user <name> --reason <text>
  unban-user <name> --reason <text>
  delete-user <name> --reason <text>
  delist-bot <name> --reason <text>
  relist-bot <name> --reason <text>
  revoke-bot <name> --reason <text>
  abort-game <gameId> --reason <text>
  abort-game --bot <name> --reason <text>
  recompute-ratings [--exclude <gameId|name>]... --reason <text>
  tournament-create --name <text> --start <ISO time> --clock turn:<s>|match:<min>+<s> [--opening <plies>] [--max <bots>] --reason <text>
  tournament-cancel <tournamentId> --reason <text>
  tournament-schedule add --weekday mon|tue|wed|thu|fri|sat|sun --time <HH:MM UTC> --name <text; {date} becomes the start's date> --clock turn:<s>|match:<min>+<s> [--opening <plies>] [--max <bots>] [--ahead <days>] --reason <text>
  tournament-schedule list
  tournament-schedule remove <ruleId> --reason <text>
  report-close <reportId> --reason <note>
  delete-analysis <analysisId> --reason <text>
  duel-stop <duelId> --reason <text>`;

export type ParsedArgs = { kind: `request`; request: AdminRequest } | { kind: `usage`; error: string };

const namedOps = new Set([`ban-user`, `unban-user`, `delete-user`, `delist-bot`, `relist-bot`, `revoke-bot`]);

interface Flags {
    reason?: string | undefined;
    bot?: string | undefined;
    exclude?: string[] | undefined;
    name?: string | undefined;
    start?: string | undefined;
    clock?: string | undefined;
    opening?: string | undefined;
    max?: string | undefined;
    weekday?: string | undefined;
    time?: string | undefined;
    ahead?: string | undefined;
}

// A number flag the schema then bounds; text that is no number fails there.
function numberFlag(value: string | undefined): number | string | undefined {
    if (value === undefined) return undefined;
    return /^\d+$/.test(value) ? Number(value) : value;
}

function clockFlag(value: string | undefined): TimeControl | string | undefined {
    return value === undefined ? undefined : (parseClockArg(value) ?? value);
}

function requestBody(op: string, target: string | undefined, flags: Flags): Record<string, unknown> {
    const reason = flags.reason === undefined ? {} : { reason: flags.reason };
    if (op === `status`) return { op };
    if (op === `backup`) return { op, ...(target !== undefined && { label: target }) };
    if (op === `bot`) return { op, name: target };
    if (namedOps.has(op)) return { op, name: target, ...reason };
    if (op === `abort-game`) {
        return { op, ...(target !== undefined && { gameId: target }), ...(flags.bot !== undefined && { bot: flags.bot }), ...reason };
    }
    if (op === `recompute-ratings`) return { op, exclude: flags.exclude ?? [], ...reason };
    if (op === `tournament-create`) {
        const opening = numberFlag(flags.opening);
        const max = numberFlag(flags.max);
        return {
            op,
            name: flags.name,
            startsAt: flags.start,
            timeControl: clockFlag(flags.clock),
            ...(opening !== undefined && { openingPlies: opening }),
            ...(max !== undefined && { maxEntrants: max }),
            ...reason,
        };
    }
    if (op === `tournament-cancel` || op === `delete-analysis` || op === `duel-stop`) return { op, id: target, ...reason };
    if (op === `tournament-schedule-add`) {
        const opening = numberFlag(flags.opening);
        const max = numberFlag(flags.max);
        const ahead = numberFlag(flags.ahead);
        return {
            op,
            weekday: flags.weekday,
            time: flags.time,
            namePattern: flags.name,
            timeControl: clockFlag(flags.clock),
            ...(opening !== undefined && { openingPlies: opening }),
            ...(max !== undefined && { maxEntrants: max }),
            ...(ahead !== undefined && { daysAhead: ahead }),
            ...reason,
        };
    }
    if (op === `tournament-schedule-remove` || op === `report-close`) return { op, id: numberFlag(target), ...reason };
    return { op, ...reason };
}

/**
 * Turns argv into the request the socket takes, checked against the same
 * schema the server parses with, so a malformed command never leaves the
 * container shell.
 */
export function parseAdminArgs(argv: readonly string[]): ParsedArgs {
    let parsed;
    try {
        parsed = parseArgs({
            args: [...argv],
            allowPositionals: true,
            strict: true,
            options: {
                reason: { type: `string` },
                bot: { type: `string` },
                exclude: { type: `string`, multiple: true },
                name: { type: `string` },
                start: { type: `string` },
                clock: { type: `string` },
                opening: { type: `string` },
                max: { type: `string` },
                weekday: { type: `string` },
                time: { type: `string` },
                ahead: { type: `string` },
            },
        });
    } catch (error) {
        return { kind: `usage`, error: error instanceof Error ? error.message : String(error) };
    }
    const [first, ...rest] = parsed.positionals;
    if (first === undefined) return { kind: `usage`, error: `no op given` };
    // The schedule ops name their action as a word of their own, which the
    // socket takes as part of the op.
    if (first === `tournament-schedule` && rest[0] === undefined) return { kind: `usage`, error: `name add, list, or remove` };
    const [op, target, ...extra] = first === `tournament-schedule` ? [`${first}-${rest[0] ?? ``}`, ...rest.slice(1)] : [first, ...rest];
    if (extra.length > 0) return { kind: `usage`, error: `unexpected arguments: ${extra.join(` `)}` };
    const request = adminRequestSchema.safeParse(requestBody(op, target, parsed.values));
    if (!request.success) {
        return {
            kind: `usage`,
            error: request.error.issues
                .map((issue) => `${issue.path.map(String).join(`.`) || `request`}: ${issue.message}`)
                .join(`; `),
        };
    }
    return { kind: `request`, request: request.data };
}

function clockArg(clock: TimeControl): string {
    switch (clock.mode) {
        case `turn`:
            return `turn:${String(clock.turnTimeMs / 1_000)}`;
        case `match`:
            return `match:${String(clock.mainTimeMs / 60_000)}+${String(clock.incrementMs / 1_000)}`;
        case `unlimited`:
            return `unlimited`;
    }
}

function ruleLines(rules: readonly AdminTournamentRule[]): string[] {
    const lines = [`weekly rules:`];
    if (rules.length === 0) lines.push(`  none`);
    for (const rule of rules) {
        const next = new Date(rule.nextStartsAt * 1000).toISOString();
        const settings = `${clockArg(rule.timeControl)}  opening ${String(rule.openingPlies)}  max ${String(rule.maxEntrants)}  ahead ${String(rule.daysAhead)}`;
        lines.push(`  ${String(rule.id)}  ${rule.weekday} ${rule.time}  next ${next}  ${settings}  ${rule.namePattern}`);
    }
    return lines;
}

// A report's own words come from the public form: printed as JSON strings,
// they cannot move the cursor or recolor the operator's terminal.
function reportLines(status: AdminStatus): string[] {
    const lines = [`open reports: ${String(status.openReportCount)}`];
    for (const report of status.openReports) {
        const at = new Date(report.at * 1000).toISOString();
        const from = [report.name, report.email].filter((part) => part !== null).map((part) => JSON.stringify(part)).join(` `);
        lines.push(`  ${String(report.id)}  ${at}  ${report.reason}  ${JSON.stringify(report.subject)}${from === `` ? `` : `  from ${from}`}`);
        lines.push(`    ${JSON.stringify(report.details)}`);
    }
    if (status.openReportCount > status.openReports.length) lines.push(`  and ${String(status.openReportCount - status.openReports.length)} more; close the oldest first`);
    return lines;
}

function formatStatus(status: AdminStatus): string {
    const lines = [
        `uptime        ${String(status.uptimeSeconds)} s`,
        `paused        ${status.paused ? `yes` : `no`}`,
        `live streams  ${String(status.liveStreams)}`,
        `active games  ${String(status.activeGames)}`,
        `live duels    ${String(status.liveDuels)}`,
        `client keys   ${String(status.clientKeys)}`,
        `keyless       ${String(status.keylessRequests)}`,
        `bot clients, last ${String(clientCensusDays)} days:`,
        ...(status.clients.length === 0 ? [`  none`] : status.clients.map((count) => `  ${count.client}  ${String(count.bots)}`)),
        `tournaments:`,
    ];
    if (status.tournaments.length === 0) lines.push(`  none running or scheduled`);
    for (const tournament of status.tournaments) {
        const at = new Date(tournament.startsAt * 1000).toISOString();
        lines.push(`  ${tournament.id}  ${tournament.status}  ${at}  ${String(tournament.entrants)} entered  ${tournament.name}`);
    }
    lines.push(...ruleLines(status.tournamentRules));
    lines.push(...reportLines(status));
    lines.push(`recent admin actions:`);
    if (status.recentActions.length === 0) lines.push(`  none`);
    for (const action of status.recentActions) {
        const at = new Date(action.at * 1000).toISOString();
        lines.push(`  ${at}  ${action.actor}  ${action.action}  ${action.target ?? `-`}  ${action.reason}`);
    }
    return lines.join(`\n`);
}

function formatBot(bot: AdminBot): string {
    const client = bot.client === null ? `none yet` : bot.client.kind === `hexo-bridge` ? `hexo-bridge/${bot.client.version}` : `other`;
    const seen = bot.clientAt === null ? `` : `  ${new Date(bot.clientAt * 1000).toISOString()}`;
    return [
        `bot           ${bot.name}`,
        `owner         ${bot.owner}`,
        `online        ${bot.online ? (bot.open ? `yes, open` : `yes, closed`) : `no`}`,
        `live games    ${String(bot.liveGames)}`,
        `delisted      ${bot.delisted ? `yes` : `no`}`,
        `version       ${bot.version === null ? `-` : JSON.stringify(bot.version)}`,
        `client        ${client}${seen}`,
    ].join(`\n`);
}

export function formatAdminResponse(response: AdminResponse): string {
    switch (response.kind) {
        case `status`:
            return formatStatus(response.status);
        case `bot`:
            return formatBot(response.bot);
        case `tournament-rules`:
            return ruleLines(response.rules).join(`\n`);
        case `done`:
            return response.summary;
        case `error`:
            return `${response.code}: ${response.error}`;
    }
}

/**
 * Sends one request over the admin socket and reads the one line that
 * answers it; a connection dropped without an answer rejects.
 */
export function sendAdminRequest(path: string, request: AdminRequest): Promise<AdminResponse> {
    return new Promise((resolve, reject) => {
        const socket = connect(path);
        let received = ``;
        socket.setEncoding(`utf8`);
        socket.on(`data`, (chunk: string) => {
            received += chunk;
        });
        socket.on(`error`, reject);
        socket.on(`close`, () => {
            if (received === ``) {
                reject(new Error(`the server closed the connection without an answer; see its log`));
                return;
            }
            try {
                resolve(adminResponseSchema.parse(JSON.parse(received)));
            } catch (error) {
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
        socket.end(`${JSON.stringify(request)}\n`);
    });
}
