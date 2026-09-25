import { createServer, type Server } from 'node:http';
import { connect, type Socket } from 'node:net';

// The only destination the app ever dials: Discord's OAuth token and user
// endpoints.
// Fixed in code, not read from env, so no config file can widen it.
export const egressAllowlist: ReadonlySet<string> = new Set([`discord.com:443`]);

const idleTimeoutMs = 60_000;

function refuse(socket: Socket, status: string): void {
    socket.end(`HTTP/1.1 ${status}\r\n\r\n`);
}

// A CONNECT-only forward proxy: TLS stays end to end between the app and
// Discord, and any plain request is refused, so the proxy never sees or
// forwards a byte it can read.
export function createEgressProxy(allowlist: ReadonlySet<string>, log: (line: object) => void): Server {
    const server = createServer((request, response) => {
        log({ msg: `refused plain request`, method: request.method, url: request.url });
        response.writeHead(405).end();
    });
    server.on(`connect`, (request, client: Socket, head: Buffer) => {
        const target = (request.url ?? ``).toLowerCase();
        const separator = target.lastIndexOf(`:`);
        const host = target.slice(0, separator);
        const port = Number(target.slice(separator + 1));
        if (separator <= 0 || !allowlist.has(target)) {
            log({ msg: `refused connect`, target });
            refuse(client, `403 Forbidden`);
            return;
        }
        const upstream = connect(port, host);
        client.setTimeout(idleTimeoutMs, () => client.destroy());
        upstream.setTimeout(idleTimeoutMs, () => upstream.destroy());
        upstream.once(`connect`, () => {
            client.write(`HTTP/1.1 200 Connection Established\r\n\r\n`);
            if (head.length > 0) upstream.write(head);
            upstream.pipe(client);
            client.pipe(upstream);
        });
        upstream.once(`error`, () => {
            if (upstream.connecting) refuse(client, `502 Bad Gateway`);
            else client.destroy();
        });
        client.once(`error`, () => upstream.destroy());
        client.once(`close`, () => upstream.destroy());
        upstream.once(`close`, () => client.destroy());
    });
    return server;
}
