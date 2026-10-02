import { relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import config from '../vite.config';

const repository = fileURLToPath(new URL(`../../..`, import.meta.url));

describe('the dev server', () => {
    it('listens on the loopback address alone, unless VITE_HOST says otherwise', () => {
        expect(process.env.VITE_HOST).toBeUndefined();
        expect(config.server?.host).toBe(`127.0.0.1`);
    });

    it('serves files from the web app, the packages, the legal folder, and node_modules, never the server or its data', () => {
        const allowed = (config.server?.fs?.allow ?? []).map((path) => relative(repository, path).split(sep).join(`/`));
        expect(allowed).toEqual([`apps/web`, `packages`, `legal`, `node_modules`]);
    });
});
