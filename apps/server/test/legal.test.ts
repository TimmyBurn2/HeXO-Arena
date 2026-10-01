import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { legalDetailsPath, legalDetailsSchema, type LegalDetails } from '@hexo-arena/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { placeholderPaths, readLegalDetails } from '../src/legal';
import { createTestApp } from './helpers';

const examplePath = new URL(`../legal-details.example.json`, import.meta.url);

const invented: LegalDetails = {
    operator: { name: `Ada Beispiel`, street: `Musterweg 7`, postcodeAndCity: `12345 Beispielstadt`, country: `Germany`, email: `contact@arena.example` },
    host: { name: `Example Hosting GmbH`, street: `Serverstrasse 1`, postcodeAndCity: `54321 Rechenburg`, country: `Germany`, serverLocation: `Rechenburg, Germany` },
    supervisoryAuthority: { name: `Example Authority`, street: `Aufsichtsplatz 2`, postcodeAndCity: `11111 Landeshausen`, country: `Germany`, url: `https://authority.example/` },
};

describe('the committed legal details example', () => {
    it('matches the schema and holds a placeholder in every value, so no real value can hide in it', () => {
        const example: unknown = JSON.parse(readFileSync(examplePath, `utf8`));
        const parsed = legalDetailsSchema.parse(example);
        const leaves = JSON.stringify(parsed).match(/"(?:[^"\\]|\\.)*"(?=[,\]}])/g) ?? [];
        expect(leaves.length).toBeGreaterThan(0);
        expect(placeholderPaths(parsed)).toHaveLength(leaves.length);
        expect(parsed.operator.discord).toBeDefined();
        expect(parsed.mailProvider).toBeDefined();
    });
});

describe('readLegalDetails', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), `legal-`));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    function file(content: string): string {
        const path = join(dir, `details.json`);
        writeFileSync(path, content);
        return path;
    }

    it('accepts filled-in details in production and the placeholders outside it', () => {
        expect(readLegalDetails(file(JSON.stringify(invented)), true)).toEqual(invented);
        expect(readLegalDetails(examplePath.pathname, false).operator.name).toBe(`<operator name>`);
    });

    it('refuses in production a file that is missing, not JSON, or off the schema', () => {
        expect(() => readLegalDetails(join(dir, `absent.json`), true)).toThrow(/cannot read/);
        expect(() => readLegalDetails(file(`{ "operator": `), true)).toThrow(/not JSON/);
        expect(() => readLegalDetails(file(JSON.stringify({ ...invented, host: undefined })), true)).toThrow(/does not match the legal details at host$/);
    });

    it('names a misspelled key, which holds no value of the operator', () => {
        expect(() => readLegalDetails(file(JSON.stringify({ ...invented, operator: { ...invented.operator, emial: `x@y` } })), true)).toThrow(
            /at operator \(unknown emial\)$/,
        );
    });

    it('quotes nothing of a broken file, neither in its message nor in a cause', () => {
        let error: unknown = null;
        try {
            readLegalDetails(file(`{ "operator": { "name": Ada Beispiel } }`), true);
        } catch (thrown) {
            error = thrown;
        }
        expect(error).toBeInstanceOf(Error);
        const said = error instanceof Error ? `${error.message} ${String(error.cause)}` : ``;
        expect(said).not.toContain(`Ada`);
    });

    it('refuses in production any value that still holds a placeholder, naming where without quoting it', () => {
        expect(() => readLegalDetails(examplePath.pathname, true)).toThrow(/placeholders at operator\.name, operator\.street, operator\.postcodeAndCity, operator\.country, operator\.email/);
        expect(() => readLegalDetails(file(JSON.stringify({ ...invented, operator: { ...invented.operator, name: `Ada Beispiel>` } })), true)).toThrow(
            /placeholders at operator\.name$/,
        );
        const one = { ...invented, host: { ...invented.host, serverLocation: `<city>, Germany` } };
        let message = ``;
        try {
            readLegalDetails(file(JSON.stringify(one)), true);
        } catch (error) {
            message = error instanceof Error ? error.message : ``;
        }
        expect(message).toMatch(/placeholders at host\.serverLocation$/);
        expect(message).not.toContain(`Germany`);
    });
});

describe(`GET ${legalDetailsPath}`, () => {
    it('answers the deployment details to anyone', async () => {
        const world = await createTestApp({ legalDetails: invented });
        const response = await world.app.inject({ method: `GET`, url: legalDetailsPath });
        expect(response.statusCode).toBe(200);
        expect(legalDetailsSchema.parse(response.json())).toEqual(invented);
    });

    it('answers not found on a server started without details', async () => {
        const world = await createTestApp();
        const response = await world.app.inject({ method: `GET`, url: legalDetailsPath });
        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ code: `not_found` });
    });
});

describe('the proxy in front of the details read', () => {
    const prod = join(dirname(fileURLToPath(import.meta.url)), `../../../docker/prod`);
    const caddyfile = readFileSync(join(prod, `Caddyfile`), `utf8`);
    const compose = readFileSync(join(prod, `compose.yml`), `utf8`);

    // Where compose binds the deployment's details file into a service,
    // read-only, or undefined when it does not.
    function detailsMount(service: string): string | undefined {
        const block = new RegExp(`\\n {4}${service}:\\n([\\s\\S]*?)(?=\\n {4}\\w|\\n\\w|$)`).exec(compose)?.[1] ?? ``;
        const bind = /- type: bind\n\s+source: \.\/legal-details\.json\n\s+target: (\S+)\n\s+read_only: true\n/.exec(block);
        return bind?.[1];
    }

    // While the app is down the legal pages still name the operator: the
    // proxy answers the details read from the file the app reads, with a
    // success status, since an error route writes the error's by default.
    it('serves the details file itself, read-only, when the app answers 502 to 504', () => {
        const errors = /handle_errors 502 503 504 \{([\s\S]*?)\n\t\}/.exec(caddyfile)?.[1] ?? ``;
        const route = new RegExp(`@legalDown path ${legalDetailsPath}\\n\\s+handle @legalDown \\{([\\s\\S]*?)\\n\\t\\t\\}`).exec(errors)?.[1] ?? ``;
        const root = /root \* (\S+)/.exec(route)?.[1];
        const file = /rewrite \* (\S+)/.exec(route)?.[1];
        expect(root).toBeDefined();
        expect(file).toBeDefined();
        expect(route).toMatch(/file_server \{\n\s+status 200\n\s+\}/);
        expect(detailsMount(`caddy`)).toBe(`${root ?? ``}${file ?? ``}`);
        expect(detailsMount(`app`)).toBe(`${root ?? ``}${file ?? ``}`);
    });
});
