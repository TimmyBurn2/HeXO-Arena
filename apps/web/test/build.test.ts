// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { licenseFileName, licenseText } from '../build/licenses';
import { thirdPartyLicensesPath } from '../src/site-links';
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
    beforeAll(() => {
        // A build of its own, as pnpm build runs it: vitest's NODE_ENV would make an in-process build a dev one.
        execFileSync(process.execPath, [join(webRoot, `node_modules/vite/bin/vite.js`), `build`, `--outDir`, outDir, `--emptyOutDir`, `--logLevel`, `error`], {
            cwd: webRoot,
            env: { ...process.env, NODE_ENV: `production` },
        });
    }, 120_000);

    it('holds no dev route and none of the dev pill', () => {
        const shipped = [...files(outDir)].filter((path) => /\.(?:js|css|html)$/u.test(path)).map((path) => readFileSync(path, `utf8`)).join(`\n`);
        // The scan reads the real bundle: the session route is in it.
        expect(shipped).toContain(`/api/me`);
        expect(shipped).not.toContain(`/api/dev`);
        for (const trace of [`dev-pill`, `dev-panel`, `dev-tools`, devEn.title, devEn.empty, devEn.firstSignInNote]) {
            expect(shipped).not.toContain(trace);
        }
    });

    it('ships the third-party licenses at the root, the font and GitHub\'s mark included, as the dev server serves them', () => {
        const file = join(outDir, licenseFileName);
        expect(existsSync(file)).toBe(true);
        expect(existsSync(join(outDir, `.vite`))).toBe(false);
        const text = readFileSync(file, `utf8`);
        for (const name of [`react`, `react-dom`, `scheduler`, `zod`]) {
            expect(text).toMatch(new RegExp(`^## ${name} - \\S+ \\(MIT\\)$`, `m`));
        }
        expect(text).toMatch(/^## Chakra Petch \(OFL-1\.1\)$/m);
        expect(text).toContain(`SIL OPEN FONT LICENSE Version 1.1`);
        expect(text).toMatch(/^## Octicons mark-github \(MIT\)$/m);
        expect(text).toContain(`Copyright (c) 2026 GitHub Inc.`);
        expect(text).toBe(licenseText());
        expect(thirdPartyLicensesPath).toBe(`/${licenseFileName}`);
    });

    it('links the layer order before every bundled sheet, so no layer is first named out of order', () => {
        const html = readFileSync(join(outDir, `index.html`), `utf8`);
        const sheets = [...html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/gu)].map((match) => match[1]);
        expect(sheets[0]).toBe(`/layers.css`);
        expect(sheets.length).toBeGreaterThan(1);
        const order = readFileSync(join(outDir, `layers.css`), `utf8`).match(/@layer ([a-z, ]+);/u)?.[1];
        expect(order).toBe(`scale, brand, theme, base, components, screens, preferences`);
    });
});
