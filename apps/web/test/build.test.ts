// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { devEn } from '../src/text/dev-en';

const webRoot = fileURLToPath(new URL(`..`, import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), `hexo-arena-web-build-`));

function* files(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) yield* files(path);
        else yield path;
    }
}

afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
});

describe('the production build', () => {
    it('holds no dev route and none of the dev pill', () => {
        // A build of its own, as pnpm build runs it: vitest's NODE_ENV would make an in-process build a dev one.
        execFileSync(process.execPath, [join(webRoot, `node_modules/vite/bin/vite.js`), `build`, `--outDir`, outDir, `--emptyOutDir`, `--logLevel`, `error`], {
            cwd: webRoot,
            env: { ...process.env, NODE_ENV: `production` },
        });
        const shipped = [...files(outDir)].filter((path) => /\.(?:js|css|html)$/u.test(path)).map((path) => readFileSync(path, `utf8`)).join(`\n`);
        // The scan reads the real bundle: the session route is in it.
        expect(shipped).toContain(`/api/me`);
        expect(shipped).not.toContain(`/api/dev`);
        for (const trace of [`dev-pill`, `dev-panel`, `dev-tools`, devEn.title, devEn.empty, devEn.firstSignInNote]) {
            expect(shipped).not.toContain(trace);
        }
    }, 120_000);
});
