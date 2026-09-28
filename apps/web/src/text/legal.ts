import type { LegalDetails, LegalPage } from '@hexo-arena/contract';
import type { ReactNode } from 'react';
import { legalEn } from './legal-en';

/** One piece of a legal page's section: running text, a list, or an address. */
export type LegalBlock =
    | { readonly kind: `text`; readonly text: ReactNode }
    | { readonly kind: `list`; readonly items: readonly ReactNode[] }
    | { readonly kind: `address`; readonly lines: readonly string[] };

/** A headed part of a legal page. */
export interface LegalSection {
    /** The anchor, the same in every language, so links into a page hold. */
    readonly id: string;
    readonly heading: string;
    readonly blocks: readonly LegalBlock[];
    /** Set apart from the sections around it, as a notice the law wants seen. */
    readonly standout?: boolean;
}

/** A legal page's text, the operator's values filled in. */
export interface LegalDocument {
    readonly sections: readonly LegalSection[];
}

/** The elements a page's text asks for around its own words. */
export interface LegalLinks {
    /** Another legal page, or one of its sections. */
    readonly page: (target: LegalPage, words: string, section?: string) => ReactNode;
    /** An address to write to, shown as written. */
    readonly mail: (address: string) => ReactNode;
    /** A document elsewhere, named by the words. */
    readonly external: (href: string, words: string) => ReactNode;
}

/**
 * The legal pages in one language: each page's text as a function of the
 * deployment's details, plus the words the pages share.
 * A second language is a second value of this type.
 */
export interface LegalTexts {
    readonly names: { readonly [page in LegalPage]: string };
    readonly pages: { readonly [page in LegalPage]: (details: LegalDetails, links: LegalLinks) => LegalDocument };
    /** When the pages last changed, as every page states it. */
    readonly updated: string;
    readonly onThisPage: string;
    readonly failed: string;
}

/** The legal pages' text every screen reads. */
export const legal: LegalTexts = legalEn;
