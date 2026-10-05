import {
    adminRequestLimitBytes,
    adminRequestSchema,
    adminResponseSchema,
    type AdminRequest,
    type AdminResponse,
} from '@hexo-arena/contract';
import { chmodSync, lstatSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { dirname } from 'node:path';

export type AdminHandler = (request: AdminRequest) => AdminResponse;

interface AdminLog {
    error(details: object, message: string): void;
}

// An operator types one command and waits for one answer; a connection
// idle this long is a stuck client, not a slow one.
const connectionIdleMs = 5_000;

const newline = 0x0a;

// Node exposes no SO_PEERCRED, so the kernel's permission check carries the
// peer check instead: only the app uid can traverse a 0700 directory it
// owns, and with every capability dropped not even root in the container
// can bypass that.
function assertPrivateDirectory(directory: string): void {
    const stats = statSync(directory);
    if (!stats.isDirectory()) throw new Error(`admin socket directory ${directory} is not a directory`);
    const mode = stats.mode & 0o777;
    if (mode !== 0o700) {
        throw new Error(`admin socket directory ${directory} must be mode 0700, found ${mode.toString(8)}`);
    }
    const uid = process.getuid?.();
    if (stats.uid !== uid) {
        throw new Error(`admin socket directory ${directory} must be owned by uid ${String(uid)}, found ${String(stats.uid)}`);
    }
}

// Whether a process listens on the socket at `path`: a refused connection
// means the socket file outlived its server.
function socketAnswers(path: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
        const probe = connect(path);
        // The holder answers the empty request with bad_request; draining
        // that answer lets both sides close without an error on its log.
        probe.once(`connect`, () => {
            probe.resume();
            probe.end();
            resolve(true);
        });
        probe.on(`error`, (error) => {
            if (`code` in error && error.code === `ECONNREFUSED`) resolve(false);
            else reject(error);
        });
    });
}

// The container's tmpfs dies with the process, but a bare dev run keeps
// its socket on disk, and an unclean stop leaves it bound to nothing.
// Only a socket nobody answers on is removed; anything else at the path
// belongs to someone and ends the boot.
async function clearStaleSocket(path: string): Promise<void> {
    const stats = lstatSync(path, { throwIfNoEntry: false });
    if (stats === undefined) return;
    if (!stats.isSocket()) throw new Error(`admin socket path ${path} holds a file that is not a socket`);
    if (await socketAnswers(path)) throw new Error(`admin socket ${path} is held by a running server`);
    rmSync(path, { force: true });
}

function badRequest(error: string): AdminResponse {
    return { kind: `error`, code: `bad_request`, error };
}

// Parses one request line and hands it to the handler; malformed input
// answers bad_request, while a handler exception propagates to the caller.
function answerAdminRequest(text: string, handle: AdminHandler): AdminResponse {
    let body: unknown;
    try {
        body = JSON.parse(text);
    } catch {
        return badRequest(`the request is not json`);
    }
    const parsed = adminRequestSchema.safeParse(body);
    if (!parsed.success) {
        return badRequest(
            parsed.error.issues
                .map((issue) => `${issue.path.map(String).join(`.`) || `request`}: ${issue.message}`)
                .join(`; `),
        );
    }
    return adminResponseSchema.parse(handle(parsed.data));
}

// The socket shares the process that owns every game, so a handler
// exception is logged and the connection dropped; it never propagates.
function serveConnection(socket: Socket, handle: AdminHandler, log: AdminLog): void {
    const chunks: Buffer[] = [];
    let size = 0;
    let answered = false;
    const respond = (response: () => AdminResponse): void => {
        answered = true;
        let line: string;
        try {
            line = `${JSON.stringify(response())}\n`;
        } catch (error) {
            log.error({ err: error }, `admin request failed`);
            socket.destroy();
            return;
        }
        socket.end(line);
    };
    socket.setTimeout(connectionIdleMs, () => {
        socket.destroy();
    });
    socket.on(`error`, (error) => {
        log.error({ err: error }, `admin connection failed`);
    });
    socket.on(`data`, (chunk: Buffer) => {
        if (answered) return;
        const end = chunk.indexOf(newline);
        const part = end === -1 ? chunk : chunk.subarray(0, end);
        size += part.length;
        if (size > adminRequestLimitBytes) {
            respond(() => badRequest(`the request exceeds ${String(adminRequestLimitBytes)} bytes`));
            return;
        }
        chunks.push(part);
        if (end !== -1) {
            respond(() => answerAdminRequest(Buffer.concat(chunks).toString(`utf8`), handle));
        }
    });
    socket.on(`end`, () => {
        if (answered) return;
        respond(() => answerAdminRequest(Buffer.concat(chunks).toString(`utf8`), handle));
    });
}

/**
 * Creates the admin socket at `path` and serves it, replacing a stale
 * socket nobody answers on; rejects when the directory is not private to
 * this uid, the path holds anything else, or the socket cannot be bound,
 * so the caller can exit instead of running without admin.
 */
export async function listenAdminSocket(path: string, handle: AdminHandler, log: AdminLog): Promise<Server> {
    const directory = dirname(path);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    assertPrivateDirectory(directory);
    await clearStaleSocket(path);
    // Half-open, so a client that ends its side after the request still
    // reads the answer.
    const server = createServer({ allowHalfOpen: true }, (socket) => {
        serveConnection(socket, handle, log);
    });
    await new Promise<void>((resolve, reject) => {
        server.once(`error`, reject);
        server.listen(path, () => {
            server.off(`error`, reject);
            resolve();
        });
    });
    chmodSync(path, 0o600);
    server.on(`error`, (error) => {
        log.error({ err: error }, `admin socket failed`);
    });
    return server;
}
