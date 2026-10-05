import { devAccountsPath, devLoginPath } from '@hexo-arena/contract';
import { afterEach, describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../../../packages/contract/src/openapi';
import { createTestApp, type TestApp } from './helpers';

let world: TestApp;

afterEach(async () => {
    await world.app.close();
    world.sqlite.close();
});

const methods = new Set([`get`, `put`, `post`, `delete`, `patch`, `head`, `options`]);

// Each operation as the server names its route: the method, then the path with Fastify's `:param`.
function documented(): string[] {
    return Object.entries(buildOpenApiDocument().paths)
        .flatMap(([path, item]) => Object.keys(item).filter((key) => methods.has(key)).map((method) => `${method.toUpperCase()} ${path.replace(/\{(\w+)\}/gu, `:$1`)}`))
        .sort();
}

// Fastify answers HEAD on every GET route by itself; the document names the GET.
async function served(app: TestApp[`app`], limits: TestApp[`limits`]): Promise<string[]> {
    await app.ready();
    const routes = [...limits.classes.keys()];
    return routes.filter((route) => !route.startsWith(`HEAD `) || !routes.includes(route.replace(/^HEAD /u, `GET `))).sort();
}

describe('the server routes', () => {
    it('are the operations the OpenAPI document names, no more and no fewer', async () => {
        world = await createTestApp({ devLogin: false, reportForm: true });
        expect(await served(world.app, world.limits)).toEqual(documented());
    });

    it('add only the dev routes, which the document leaves out, where dev login is on', async () => {
        world = await createTestApp({ devLogin: true, reportForm: true });
        expect(await served(world.app, world.limits)).toEqual([...documented(), `GET ${devAccountsPath}`, `POST ${devLoginPath}`].sort());
    });
});
