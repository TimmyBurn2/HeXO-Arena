import {
    adminRequestSchema,
    adminResponseSchema,
    type AdminRequest,
    type AdminResponse,
    type AdminStatus,
} from '@hexo-arena/contract';
import { connect } from 'node:net';
import { parseArgs } from 'node:util';

export const adminUsage = `usage: hexo-arena-admin <op> [target] [--reason <text>]

  status
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
  recompute-ratings [--exclude <gameId|name>]... --reason <text>`;

export type ParsedArgs = { kind: `request`; request: AdminRequest } | { kind: `usage`; error: string };

const namedOps = new Set([`ban-user`, `unban-user`, `delete-user`, `delist-bot`, `relist-bot`, `revoke-bot`]);

function requestBody(
    op: string,
    target: string | undefined,
    flags: { reason?: string | undefined; bot?: string | undefined; exclude?: string[] | undefined },
): Record<string, unknown> {
    const reason = flags.reason === undefined ? {} : { reason: flags.reason };
    if (op === `status`) return { op };
    if (namedOps.has(op)) return { op, name: target, ...reason };
    if (op === `abort-game`) {
        return { op, ...(target !== undefined && { gameId: target }), ...(flags.bot !== undefined && { bot: flags.bot }), ...reason };
    }
    if (op === `recompute-ratings`) return { op, exclude: flags.exclude ?? [], ...reason };
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
            },
        });
    } catch (error) {
        return { kind: `usage`, error: error instanceof Error ? error.message : String(error) };
    }
    const [op, target, ...extra] = parsed.positionals;
    if (op === undefined) return { kind: `usage`, error: `no op given` };
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

function formatStatus(status: AdminStatus): string {
    const lines = [
        `uptime        ${String(status.uptimeSeconds)} s`,
        `paused        ${status.paused ? `yes` : `no`}`,
        `live streams  ${String(status.liveStreams)}`,
        `active games  ${String(status.activeGames)}`,
        `recent admin actions:`,
    ];
    if (status.recentActions.length === 0) lines.push(`  none`);
    for (const action of status.recentActions) {
        const at = new Date(action.at * 1000).toISOString();
        lines.push(`  ${at}  ${action.actor}  ${action.action}  ${action.target ?? `-`}  ${action.reason}`);
    }
    return lines.join(`\n`);
}

export function formatAdminResponse(response: AdminResponse): string {
    switch (response.kind) {
        case `status`:
            return formatStatus(response.status);
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
