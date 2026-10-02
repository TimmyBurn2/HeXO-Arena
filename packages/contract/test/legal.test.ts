import { describe, expect, it } from 'vitest';
import { legalDetailsFaults, legalDetailsPath, legalDocumentPath, legalPageMeta, legalPagePath, legalPages } from '../src';

describe('legal pages', () => {
    it('live under /legal, titled by their own names and described in one line each', () => {
        expect(legalPages.map(legalPagePath)).toEqual([`/legal/imprint`, `/legal/privacy`, `/legal/terms`]);
        expect(legalPageMeta).toEqual({
            imprint: { title: `Impressum / Legal notice - HeXO Arena`, description: `Who runs HeXO Arena and how to reach the operator` },
            privacy: { title: `Privacy policy - HeXO Arena`, description: `What HeXO Arena stores, why, for how long, and your rights` },
            terms: { title: `Terms of use - HeXO Arena`, description: `The rules for accounts, bots, names, and games on HeXO Arena` },
        });
    });

    it('come from Markdown files beside them, with the details as one JSON file', () => {
        expect(legalPages.map(legalDocumentPath)).toEqual([`/legal/imprint.md`, `/legal/privacy.md`, `/legal/terms.md`]);
        expect(legalDetailsPath).toBe(`/legal/details.json`);
    });
});

describe('legal details', () => {
    it('need no server location and no supervisory authority, and keep every other detail required', () => {
        const operator = { name: `Ada Beispiel`, email: `contact@arena.example` };
        const host = { name: `Example Hosting GmbH`, street: `Serverstrasse 1`, postcodeAndCity: `54321 Rechenburg`, country: `Germany` };
        expect(legalDetailsFaults({ operator, host })).toEqual([]);
        const { name: _name, ...nameless } = host;
        expect(legalDetailsFaults({ operator, host: nameless })).toEqual([`host.name`]);
        expect(legalDetailsFaults({ operator, host, supervisoryAuthority: { name: `Example Authority` } })).toEqual([
            `supervisoryAuthority.street`,
            `supervisoryAuthority.postcodeAndCity`,
            `supervisoryAuthority.country`,
            `supervisoryAuthority.url`,
        ]);
    });
});
