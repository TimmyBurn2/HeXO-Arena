import { request } from 'node:http';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEgressProxy, egressAllowlist } from '../src/egress-proxy';

function listen(server: { listen(port: number, host: string, done: () => void): unknown; address(): unknown }): Promise<number> {
    return new Promise((resolve) => {
        server.listen(0, `127.0.0.1`, () => {
            // Bound to a TCP port, so the address is never a pipe path.
            resolve((server.address() as AddressInfo).port);
        });
    });
}

// Opens a tunnel and answers the proxy's status, plus the echo of one
// line when the tunnel opened.
function tunnel(proxyPort: number, target: string): Promise<{ status: number; echo: string | null }> {
    return new Promise((resolve, reject) => {
        const outgoing = request({ host: `127.0.0.1`, port: proxyPort, method: `CONNECT`, path: target });
        outgoing.once(`connect`, (response, socket) => {
            if (response.statusCode !== 200) {
                socket.destroy();
                resolve({ status: response.statusCode ?? 0, echo: null });
                return;
            }
            socket.once(`data`, (chunk: Buffer) => {
                socket.destroy();
                resolve({ status: 200, echo: chunk.toString() });
            });
            socket.write(`ping\n`);
        });
        outgoing.once(`error`, reject);
        outgoing.end();
    });
}

describe('egress proxy', () => {
    let echo: Server;
    let echoPort: number;
    let dials: number;
    let proxy: ReturnType<typeof createEgressProxy>;
    let proxyPort: number;
    let logged: object[];

    beforeEach(async () => {
        dials = 0;
        echo = createServer((socket) => {
            dials += 1;
            socket.pipe(socket);
        });
        echoPort = await listen(echo);
        logged = [];
        proxy = createEgressProxy(new Set([`127.0.0.1:${String(echoPort)}`]), (line) => logged.push(line));
        proxyPort = await listen(proxy);
    });

    afterEach(() => {
        proxy.closeAllConnections();
        proxy.close();
        echo.close();
    });

    it('allows discord.com on 443 and nothing else by default', () => {
        expect([...egressAllowlist]).toEqual([`discord.com:443`]);
    });

    it('tunnels an allowed target both ways', async () => {
        expect(await tunnel(proxyPort, `127.0.0.1:${String(echoPort)}`)).toEqual({ status: 200, echo: `ping\n` });
        expect(dials).toBe(1);
    });

    it('refuses another port on an allowed host without dialing', async () => {
        expect(await tunnel(proxyPort, `127.0.0.1:${String(echoPort + 1)}`)).toEqual({ status: 403, echo: null });
        expect(await tunnel(proxyPort, `localhost:${String(echoPort)}`)).toEqual({ status: 403, echo: null });
        expect(dials).toBe(0);
        expect(logged).toHaveLength(2);
    });

    it('refuses plain proxied requests', async () => {
        const status = await new Promise<number>((resolve, reject) => {
            const outgoing = request({ host: `127.0.0.1`, port: proxyPort, path: `http://127.0.0.1:${String(echoPort)}/` }, (response) => {
                response.resume();
                resolve(response.statusCode ?? 0);
            });
            outgoing.once(`error`, reject);
            outgoing.end();
        });
        expect(status).toBe(405);
        expect(dials).toBe(0);
    });
});
