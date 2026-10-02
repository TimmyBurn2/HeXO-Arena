import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { legalDetailsPath, legalDocumentPath, legalPages } from '@hexo-arena/contract';
import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/env';
import { reportLegalDocuments } from '../src/legal';
import { createTestApp } from './helpers';

const prod = join(dirname(fileURLToPath(import.meta.url)), `../../../docker/prod`);
const caddyfile = readFileSync(join(prod, `Caddyfile`), `utf8`);
const compose = readFileSync(join(prod, `compose.yml`), `utf8`);

// A service's block of the compose file.
function service(name: string): string {
    return new RegExp(`\\n {4}${name}:\\n([\\s\\S]*?)(?=\\n {4}\\w|\\n\\w|$)`).exec(compose)?.[1] ?? ``;
}

describe('the legal documents', () => {
    it('are files the proxy serves from the deployment folder it mounts read-only, those four and nothing else of it', () => {
        const matcher = /@legalFile path (.+)\n/.exec(caddyfile)?.[1]?.split(` `);
        expect(matcher).toEqual([...legalPages.map(legalDocumentPath), legalDetailsPath]);
        const route = /handle @legalFile \{([\s\S]*?)\n\t\}/.exec(caddyfile)?.[1] ?? ``;
        const root = /root \* (\S+)/.exec(route)?.[1];
        expect(route).toMatch(/\n\t\tfile_server\n|\n\t\tfile_server$/);
        expect(service(`caddy`)).toContain(`- ./legal:${root ?? `?`}/legal:ro\n`);
    });

    it('are read-only to the app, at the folder the image names', () => {
        const dir = /LEGAL_DIR=(\S+)/.exec(readFileSync(join(prod, `Dockerfile`), `utf8`))?.[1];
        expect(dir).toBe(`/srv/legal`);
        expect(service(`app`)).toContain(`- ./legal:${dir ?? `?`}:ro\n`);
    });

    it('missing from the folder are named in one line at boot, which goes on', () => {
        const dir = mkdtempSync(join(tmpdir(), `legal-`));
        try {
            const lines: string[] = [];
            const log = { warn: (message: string) => lines.push(message) };
            writeFileSync(join(dir, `privacy.md`), `# Privacy policy\n`);
            reportLegalDocuments(dir, log);
            expect(lines).toEqual([`legal documents missing from ${dir}: imprint.md, terms.md`]);
            writeFileSync(join(dir, `imprint.md`), ``);
            writeFileSync(join(dir, `terms.md`), ``);
            reportLegalDocuments(dir, log);
            expect(lines).toHaveLength(1);
            reportLegalDocuments(join(dir, `nowhere`), log);
            expect(lines.at(-1)).toBe(`legal documents missing from ${join(dir, `nowhere`)}: imprint.md, privacy.md, terms.md`);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('all stand in the repository folder the dev boot reads by default', () => {
        const lines: string[] = [];
        reportLegalDocuments(join(dirname(fileURLToPath(import.meta.url)), `..`, parseEnv({}).LEGAL_DIR), { warn: (message) => lines.push(message) });
        expect(lines).toEqual([]);
    });

    it('never reach the app, which serves no legal read', async () => {
        expect(caddyfile).not.toContain(`/api/legal`);
        const world = await createTestApp();
        const response = await world.app.inject({ method: `GET`, url: `/api/legal` });
        expect(response.statusCode).toBe(404);
        await world.app.close();
    });
});
