import { describe, expect, it } from 'vitest';
import { legalDetailsPath, legalDocumentPath, legalPageMeta, legalPagePath, legalPages } from '../src';

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
