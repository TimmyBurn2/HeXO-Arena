import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { legalDetailsExampleFile, legalDetailsPath, legalDetailsSchema, legalDocumentPath, legalPages } from '@hexo-arena/contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exampleDetailsFile, legalFileRoutes } from '../build/legal';
import { legalStore, placeholderPattern, siteFacts, type LegalState } from '../src/legal/documents';
import { deploy, details, template } from './legal-deploy';
import { legalDetailNames } from '../src/legal/details';

const folder = join(import.meta.dirname, `../../../legal`);

// The store's state once it has read the deployment's files.
async function settled(): Promise<Extract<LegalState, { status: `ready` }>> {
    await vi.waitFor(() => {
        expect(legalStore.read().status).toBe(`ready`);
    });
    const state = legalStore.read();
    if (state.status !== `ready`) throw new Error(`the documents were not read`);
    return state;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    legalStore.reset();
});

describe('the legal documents a deployment serves', () => {
    it('are the ones whose files answer, each filled from the details', async () => {
        deploy(details, { imprint: null });
        const { documents } = await settled();
        expect([...documents.keys()]).toEqual([`privacy`, `terms`]);
        expect(documents.get(`terms`)?.fill(`operator.name`)).toEqual({ kind: `value`, text: `Ada Beispiel` });
        expect(documents.get(`terms`)?.fill(`site.minimumAge`)).toEqual({ kind: `value`, text: `16` });
    });

    it('leave out a document naming a detail when the details file is missing, and keep one that names none', async () => {
        deploy(null, { terms: `# Terms of use\n\n## Plain\n\nNo details here, only {{site.name}}.` });
        const { documents } = await settled();
        expect([...documents.keys()]).toEqual([`terms`]);
    });

    it('read an invalid details file as missing, naming where it is wrong and never a value', async () => {
        const warn = vi.spyOn(console, `warn`).mockImplementation(() => undefined);
        deploy({ ...details, operator: { ...details.operator, email: `Ada Beispiel at home` }, operater: {} });
        const { documents } = await settled();
        expect(documents.size).toBe(0);
        const said = warn.mock.calls.map((call) => call.join(` `)).join(`\n`);
        expect(said).toContain(`operator.email`);
        expect(said).toContain(`operater`);
        expect(said).not.toContain(`Ada Beispiel`);
    });

    it('take a page the server answers with the site itself for a missing file', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn(() => Promise.resolve(new Response(`<!doctype html><title>HeXO Arena</title>`, { headers: { 'content-type': `text/html; charset=utf-8` } }))),
        );
        legalStore.reset();
        legalStore.start();
        expect((await settled()).documents.size).toBe(0);
    });

    it('tell a document the deployment lacks from one whose read failed, which it most likely has', async () => {
        const answers: Record<string, () => Promise<Response>> = {
            [legalDetailsPath]: () => Promise.resolve(new Response(JSON.stringify(details), { headers: { 'content-type': `application/json` } })),
            [legalDocumentPath(`imprint`)]: () => Promise.resolve(new Response(null, { status: 404 })),
            [legalDocumentPath(`privacy`)]: () => Promise.resolve(new Response(`down`, { status: 502 })),
            [legalDocumentPath(`terms`)]: () => Promise.reject(new TypeError(`offline`)),
        };
        vi.stubGlobal(`fetch`, vi.fn((url: string) => answers[url]?.() ?? Promise.resolve(new Response(null, { status: 404 }))));
        legalStore.reset();
        legalStore.start();
        const state = await settled();
        expect(state.documents.size).toBe(0);
        expect([...state.failed]).toEqual([`privacy`, `terms`]);
    });

    it('fail the documents naming a detail with a details read that failed, and read again on a retry', async () => {
        let up = false;
        const served = vi.fn((url: string) => {
            if (url === legalDetailsPath && !up) return Promise.resolve(new Response(null, { status: 503 }));
            if (url === legalDetailsPath) return Promise.resolve(new Response(JSON.stringify(details), { headers: { 'content-type': `application/json` } }));
            const page = legalPages.find((candidate) => legalDocumentPath(candidate) === url);
            return Promise.resolve(page === undefined ? new Response(null, { status: 404 }) : new Response(template(page), { headers: { 'content-type': `text/markdown` } }));
        });
        vi.stubGlobal(`fetch`, served);
        legalStore.reset();
        legalStore.start();
        const failed = await settled();
        expect([...failed.failed]).toEqual([...legalPages]);
        up = true;
        await legalStore.retry();
        const read = legalStore.read();
        expect(read.status === `ready` ? [...read.documents.keys()] : []).toEqual([...legalPages]);
        expect(read.status === `ready` ? read.failed.size : -1).toBe(0);
    });

    it('tell a value the details leave out from a name nobody knows', async () => {
        const { mailProvider: _mail, ...rest } = details;
        deploy(rest);
        const fill = (await settled()).documents.get(`privacy`)?.fill;
        expect(fill?.(`mailProvider.name`)).toEqual({ kind: `absent` });
        expect(fill?.(`operator.nmae`)).toEqual({ kind: `unknown` });
        expect(fill?.(`site.nothing`)).toEqual({ kind: `unknown` });
    });
});

describe('the repository legal folder', () => {
    it('names only placeholders the site or the details know, and every site fact a document states', () => {
        const used = new Set(legalPages.flatMap((page) => [...template(page).matchAll(placeholderPattern)].map((match) => match[1] ?? ``)));
        expect([...used].filter((name) => !siteFacts.has(name) && !legalDetailNames.has(name))).toEqual([]);
        expect([...siteFacts.keys()].filter((name) => !used.has(name))).toEqual([]);
    });

    it('holds an example of the details that matches them and holds a placeholder in every value, so no real value can hide in it', () => {
        const example: unknown = JSON.parse(readFileSync(join(folder, exampleDetailsFile), `utf8`));
        const parsed = legalDetailsSchema.parse(example);
        const values = Object.values(parsed).flatMap((party) => Object.values(party ?? {}));
        expect(values.length).toBe(legalDetailNames.size);
        expect(values.filter((value) => !/<[^>]+>/.test(value))).toEqual([]);
    });

    it('is what the dev server serves, at the paths the site reads', () => {
        expect([...legalFileRoutes.keys()]).toEqual([...legalPages.map(legalDocumentPath), legalDetailsPath]);
        expect(legalFileRoutes.get(legalDetailsPath)?.file).toBe(exampleDetailsFile);
        expect(exampleDetailsFile).toBe(legalDetailsExampleFile);
        for (const page of legalPages) expect(legalFileRoutes.get(legalDocumentPath(page))?.file).toBe(`${page}.md`);
    });
});
