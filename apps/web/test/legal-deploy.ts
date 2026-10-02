import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { legalDetailsPath, legalDocumentFile, legalDocumentPath, legalPages, type LegalPage } from '@hexo-arena/contract';
import { vi } from 'vitest';
import type { LegalDetails } from '../src/legal/details';
import { legalStore } from '../src/legal/documents';

const folder = join(import.meta.dirname, `../../../legal`);

/** A document as the repository's legal folder holds it. */
export function template(page: LegalPage): string {
    return readFileSync(join(folder, legalDocumentFile(page)), `utf8`);
}

/** Invented details, filled in as a deployment would, with every optional value. */
export const details: LegalDetails = {
    operator: { name: `Ada Beispiel`, street: `Musterweg 7`, postcodeAndCity: `12345 Beispielstadt`, country: `Germany`, email: `contact@arena.example`, discord: `ada_b` },
    host: { name: `Example Hosting GmbH`, street: `Serverstrasse 1`, postcodeAndCity: `54321 Rechenburg`, country: `Germany`, serverLocation: `Rechenburg, Germany` },
    supervisoryAuthority: { name: `Example Authority`, street: `Aufsichtsplatz 2`, postcodeAndCity: `11111 Landeshausen`, country: `Germany`, url: `https://authority.example/` },
    mailProvider: { name: `Example Mail AG`, street: `Postfach 3`, postcodeAndCity: `22222 Briefstadt`, country: `Germany` },
};

/** A deployment that has these legal documents and no others, already read. */
export function onlyLegal(...pages: LegalPage[]): void {
    legalStore.reset({
        status: `ready`,
        documents: new Map(pages.map((page) => [page, { markdown: template(page), fill: () => ({ kind: `unknown` }) }])),
        failed: new Set(),
    });
}

const notFound = () => new Response(null, { status: 404 });

/**
 * Serve a deployment's legal folder to the store, which reads it again
 * from boot: the repository's templates unless others are given, a page
 * mapped to null left out, and the details as given, absent when null.
 * Every other request answers 404.
 */
export function deploy(served: unknown, documents: Partial<Record<LegalPage, string | null>> = {}): void {
    vi.stubGlobal(
        `fetch`,
        vi.fn((url: string) => {
            if (url === legalDetailsPath) {
                return Promise.resolve(served === null ? notFound() : new Response(JSON.stringify(served), { headers: { 'content-type': `application/json` } }));
            }
            const page = legalPages.find((candidate) => legalDocumentPath(candidate) === url);
            if (page === undefined) return Promise.resolve(notFound());
            const markdown = page in documents ? documents[page] : template(page);
            return Promise.resolve(markdown === null || markdown === undefined ? notFound() : new Response(markdown, { headers: { 'content-type': `text/markdown` } }));
        }),
    );
    legalStore.reset();
    legalStore.start();
}
