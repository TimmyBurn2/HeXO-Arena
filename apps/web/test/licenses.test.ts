// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { licenseFileName, licenseText } from '../build/licenses';
import { thirdPartyLicensesPath } from '../src/site-links';

const webRoot = fileURLToPath(new URL(`..`, import.meta.url));
const dist = new URL(`../dist/`, import.meta.url);

describe('the production build', () => {
    // A whole build takes a second or two here; the budget leaves a loaded
    // machine room.
    it('ships the third-party licenses at the root of dist, the font and GitHub\'s mark included, as the dev server serves them', async () => {
        await build({ root: webRoot, logLevel: `silent` });
        const file = new URL(licenseFileName, dist);
        expect(existsSync(file)).toBe(true);
        expect(existsSync(new URL(`.vite`, dist))).toBe(false);
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
    }, 60_000);
});
