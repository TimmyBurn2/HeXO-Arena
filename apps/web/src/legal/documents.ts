import { useSyncExternalStore } from 'react';
import {
    guardianPermissionAge,
    guestIdleSeconds,
    legalDetailsPath,
    legalDocumentPath,
    legalPages,
    minimumAge,
    sessionCookieName,
    sessionMaxAgeSeconds,
    signupCookieName,
    signupMaxAgeSeconds,
    siteName,
    type LegalPage,
} from '@hexo-arena/contract';
import { z } from 'zod';
import { boardSettingsStorageKey } from '../board/board-settings';
import { drawerPinnedStorageKey } from '../game/use-drawer';
import { playStorageKey } from '../play/setup';
import { botApiRepository } from '../site-links';
import { themeStorageKey } from '../theme/themes';
import { legalDetailNames, legalDetailValues, legalDetailsSchema } from './details';

/**
 * A placeholder in a legal document: a dotted name in double braces, such
 * as `{{operator.name}}`.
 */
export const placeholderPattern = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * The facts of the site's own code that its legal documents state, under
 * `site.`: they stay true when the code changes, whoever copied the text.
 */
export const siteFacts: ReadonlyMap<string, string> = new Map([
    [`site.name`, siteName],
    [`site.sessionCookie`, sessionCookieName],
    [`site.sessionDays`, String(sessionMaxAgeSeconds / 86_400)],
    [`site.signupCookie`, signupCookieName],
    [`site.signupMinutes`, String(signupMaxAgeSeconds / 60)],
    [`site.guestIdleHours`, String(guestIdleSeconds / 3_600)],
    [`site.themeKey`, themeStorageKey],
    [`site.boardKey`, boardSettingsStorageKey],
    [`site.drawerKey`, drawerPinnedStorageKey],
    [`site.playKey`, playStorageKey],
    [`site.minimumAge`, String(minimumAge)],
    [`site.guardianAge`, String(guardianPermissionAge)],
    [`site.botApi`, botApiRepository],
]);

/** What a placeholder stands for in one deployment. */
export type Filling =
    | { readonly kind: `value`; readonly text: string }
    /** A value the details may hold and this deployment's leave out. */
    | { readonly kind: `absent` }
    /** A name neither the site nor the details know, shown as written. */
    | { readonly kind: `unknown` };

/** A legal document as the deployment serves it, with what its placeholders stand for. */
export interface LegalSource {
    readonly markdown: string;
    readonly fill: (name: string) => Filling;
}

/**
 * The deployment's legal documents once read: those it serves, and those
 * whose read failed, which it most likely has; a document in neither is
 * one it does not have.
 */
export type LegalState =
    | { status: `loading` }
    | { status: `ready`; documents: ReadonlyMap<LegalPage, LegalSource>; failed: ReadonlySet<LegalPage> };

let current: LegalState = { status: `loading` };
let started = false;
const listeners = new Set<() => void>();

function set(next: LegalState): void {
    current = next;
    for (const listener of listeners) listener();
}

/** A file of the legal folder as one read found it. */
type Read<T> = { readonly kind: `found`; readonly value: T } | { readonly kind: `absent` } | { readonly kind: `failed` };

// Only an answer of not found says the deployment lacks the file, and so
// does the site's own page, which a server answers for every path it has
// no file for; anything else is a read that failed.
async function readFile(path: string): Promise<Read<Response>> {
    try {
        const response = await fetch(path);
        if (response.status === 404 || response.status === 410) return { kind: `absent` };
        if (!response.ok) return { kind: `failed` };
        if (response.headers.get(`content-type`)?.startsWith(`text/html`) === true) return { kind: `absent` };
        return { kind: `found`, value: response };
    } catch {
        return { kind: `failed` };
    }
}

// A details file that is not valid stands for none, and says where it is
// wrong, never a value, which is the operator's own.
async function readDetails(): Promise<Read<ReadonlyMap<string, string>>> {
    const read = await readFile(legalDetailsPath);
    if (read.kind !== `found`) return read;
    let json: unknown;
    try {
        json = await read.value.json();
    } catch {
        console.warn(`${legalDetailsPath} is not JSON`);
        return { kind: `absent` };
    }
    const parsed = legalDetailsSchema.safeParse(json);
    if (!parsed.success) {
        const where = parsed.error.issues.map((issue) => {
            const at = z.core.toDotPath(issue.path) || `the top level`;
            return issue.code === `unrecognized_keys` ? `${at} (unknown ${issue.keys.join(`, `)})` : at;
        });
        console.warn(`${legalDetailsPath} does not match the legal details at ${where.join(`, `)}`);
        return { kind: `absent` };
    }
    return { kind: `found`, value: legalDetailValues(parsed.data) };
}

async function readDocument(page: LegalPage): Promise<Read<string>> {
    const read = await readFile(legalDocumentPath(page));
    if (read.kind !== `found`) return read;
    return read.value.text().then(
        (value): Read<string> => ({ kind: `found`, value }),
        (): Read<string> => ({ kind: `failed` }),
    );
}

/**
 * The deployment's documents filled from its details, as the store holds
 * them. A document that names a detail needs the details file: without
 * one it is left out rather than shown with gaps, and when the details
 * did not load it failed with them.
 */
export function legalState(texts: ReadonlyMap<LegalPage, Read<string>>, details: Read<ReadonlyMap<string, string>>): LegalState {
    const values = details.kind === `found` ? details.value : null;
    const fill = (name: string): Filling => {
        const value = siteFacts.get(name) ?? values?.get(name);
        if (value !== undefined) return { kind: `value`, text: value };
        return legalDetailNames.has(name) ? { kind: `absent` } : { kind: `unknown` };
    };
    const documents = new Map<LegalPage, LegalSource>();
    const failed = new Set<LegalPage>();
    for (const [page, read] of texts) {
        if (read.kind === `failed`) failed.add(page);
        if (read.kind !== `found`) continue;
        const needsDetails = [...read.value.matchAll(placeholderPattern)].some((match) => legalDetailNames.has(match[1] ?? ``));
        if (needsDetails && details.kind === `failed`) failed.add(page);
        else if (!needsDetails || details.kind === `found`) documents.set(page, { markdown: read.value, fill });
    }
    return { status: `ready`, documents, failed };
}

async function load(): Promise<void> {
    const [details, ...texts] = await Promise.all([readDetails(), ...legalPages.map(readDocument)]);
    const reads = new Map<LegalPage, Read<string>>();
    legalPages.forEach((page, index) => {
        reads.set(page, texts[index] ?? { kind: `failed` });
    });
    set(legalState(reads, details));
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function read(): LegalState {
    return current;
}

/**
 * The legal documents the deployment serves, as a store: read once at
 * boot, since every framed screen's footer links only those it has.
 */
export const legalStore = {
    read,
    subscribe,
    start(): void {
        if (started) return;
        started = true;
        void load();
    },
    /** Read the folder again after a read failed; the documents read stay until the answer is in. */
    retry(): Promise<void> {
        started = true;
        return load();
    },
    /** Test seam: start from boot, or from the documents given. */
    reset(state: LegalState = { status: `loading` }): void {
        started = state.status === `ready`;
        current = state;
    },
};

export function useLegal(): LegalState {
    return useSyncExternalStore(legalStore.subscribe, read, read);
}

/**
 * Whether the site links a legal document: one the deployment serves, or
 * one whose read failed, which it most likely has. Until the store has
 * read them, none.
 */
export function linksLegalPage(state: LegalState, page: LegalPage): boolean {
    return state.status === `ready` && (state.documents.has(page) || state.failed.has(page));
}
