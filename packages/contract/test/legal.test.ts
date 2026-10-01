import { describe, expect, it } from 'vitest';
import { legalDetailsSchema, legalPageMeta, legalPagePath, legalPages } from '../src';

const details = {
    operator: {
        name: `Ada Beispiel`,
        street: `Musterweg 7`,
        postcodeAndCity: `12345 Beispielstadt`,
        country: `Germany`,
        email: `contact@arena.example`,
        discord: `ada_b`,
    },
    host: {
        name: `Example Hosting GmbH`,
        street: `Serverstrasse 1`,
        postcodeAndCity: `54321 Rechenburg`,
        country: `Germany`,
        serverLocation: `Rechenburg, Germany`,
    },
    supervisoryAuthority: {
        name: `Example State Data Protection Authority`,
        street: `Aufsichtsplatz 2`,
        postcodeAndCity: `11111 Landeshausen`,
        country: `Germany`,
        url: `https://authority.example/`,
    },
    mailProvider: { name: `Example Mail AG`, street: `Postfach 3`, postcodeAndCity: `22222 Briefstadt`, country: `Germany` },
};

describe('legal details', () => {
    it('parse the operator, the host, the authority, and an optional mail provider', () => {
        expect(legalDetailsSchema.parse(details)).toEqual(details);
        const { mailProvider: _mail, ...withoutMail } = details;
        const { discord: _discord, ...operator } = details.operator;
        expect(legalDetailsSchema.parse({ ...withoutMail, operator })).toEqual({ ...withoutMail, operator });
    });

    it('trim every value', () => {
        expect(legalDetailsSchema.parse({ ...details, operator: { ...details.operator, name: `  Ada Beispiel ` } }).operator.name).toBe(`Ada Beispiel`);
    });

    it('refuse unknown keys, since a misspelled key would drop its value unseen', () => {
        expect(legalDetailsSchema.safeParse({ ...details, operater: details.operator }).success).toBe(false);
        expect(legalDetailsSchema.safeParse({ ...details, host: { ...details.host, location: `x` } }).success).toBe(false);
    });

    it('refuse empty names and addresses, an address without an at sign, and a plain-http authority link', () => {
        const bad = [
            { ...details, operator: { ...details.operator, name: ` ` } },
            { ...details, operator: { ...details.operator, street: `` } },
            { ...details, host: { ...details.host, postcodeAndCity: ` ` } },
            { ...details, supervisoryAuthority: { ...details.supervisoryAuthority, country: undefined } },
            { ...details, operator: { ...details.operator, email: `contact.arena.example` } },
            { ...details, supervisoryAuthority: { ...details.supervisoryAuthority, url: `http://authority.example/` } },
            { ...details, supervisoryAuthority: undefined },
        ];
        for (const candidate of bad) expect(legalDetailsSchema.safeParse(candidate).success).toBe(false);
    });
});

describe('legal pages', () => {
    it('live under /legal, titled by their own names and described in one line each', () => {
        expect(legalPages.map(legalPagePath)).toEqual([`/legal/imprint`, `/legal/privacy`, `/legal/terms`]);
        expect(legalPageMeta).toEqual({
            imprint: { title: `Impressum / Legal notice - HeXO Arena`, description: `Who runs HeXO Arena and how to reach the operator` },
            privacy: { title: `Privacy policy - HeXO Arena`, description: `What HeXO Arena stores, why, for how long, and your rights` },
            terms: { title: `Terms of use - HeXO Arena`, description: `The rules for accounts, bots, names, and games on HeXO Arena` },
        });
    });
});
