import { EventEmitter } from 'node:events';
import http from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../src/env';
import { handleStopSignals } from '../src/signals';
import { createTestApp, loginAs, mintBot } from './helpers';

function wired(fastStop: boolean): { target: EventEmitter; drain: () => void; stop: () => void } {
    const target = new EventEmitter();
    const paths = { drain: vi.fn(), stop: vi.fn() };
    handleStopSignals(target, fastStop, paths);
    return { target, ...paths };
}

describe('DEV_FAST_STOP env flag', () => {
    it.each([
        [{ DEV_FAST_STOP: `1` }, true],
        [{ DEV_FAST_STOP: `0` }, false],
        [{}, false],
    ])('%j parses to %j', (source, enabled) => {
        expect(parseEnv(source).DEV_FAST_STOP).toBe(enabled);
    });

    it.each([`1`, `0`])('set to %j in production refuses to parse', (value) => {
        expect(() => parseEnv({ NODE_ENV: `production`, DEV_FAST_STOP: value })).toThrow(/DEV_FAST_STOP/);
    });
});

describe('stop signals', () => {
    it('drain on SIGTERM without the fast stop', () => {
        const { target, drain, stop } = wired(false);
        target.emit(`SIGTERM`);
        expect(drain).toHaveBeenCalledOnce();
        expect(stop).not.toHaveBeenCalled();
    });

    it('stop at once on SIGTERM with the fast stop', () => {
        const { target, drain, stop } = wired(true);
        target.emit(`SIGTERM`);
        expect(stop).toHaveBeenCalledOnce();
        expect(drain).not.toHaveBeenCalled();
    });

    it('stop at once on SIGINT, cutting a drain short', () => {
        const { target, drain, stop } = wired(false);
        target.emit(`SIGTERM`);
        target.emit(`SIGINT`);
        expect(drain).toHaveBeenCalledOnce();
        expect(stop).toHaveBeenCalledOnce();
    });
});

describe('the immediate stop', () => {
    it('ends an open bot stream instead of waiting on it', async () => {
        const world = await createTestApp({ logger: false });
        const token = await mintBot(world.app, await loginAs(world.app, `owner`), `stopbot`);
        const port = await world.app.listen({ host: `127.0.0.1`, port: 0 }).then((address) => Number(new URL(address).port));
        // Wrapped, since resolving with a bare promise would wait for the end.
        const stream = await new Promise<{ ended: Promise<void> }>((resolve) => {
            http.get({ host: `127.0.0.1`, port, path: `/api/bot/stream`, headers: { authorization: `Bearer ${token}` } }, (response) => {
                response.resume();
                resolve({ ended: new Promise((done) => response.once(`end`, done)) });
            });
        });
        expect(world.presence.streamCount()).toBe(1);
        await world.app.close();
        await stream.ended;
        expect(world.presence.streamCount()).toBe(0);
    });
});
