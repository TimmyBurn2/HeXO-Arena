import { useSyncExternalStore } from 'react';
import type { Me, MeUpdateRequest } from '@hexo-arena/contract';
import { deleteAccount, fetchMe, signOut, startGuest, updateMe } from './api/client';
import { text } from './text';

export type MeState = { status: `loading` } | { status: `ready`; me: Me };

let current: MeState = { status: `loading` };
let started = false;
const listeners = new Set<() => void>();

function set(next: MeState): void {
    current = next;
    for (const listener of listeners) listener();
}

async function refresh(): Promise<Me> {
    try {
        const me = await fetchMe();
        set({ status: `ready`, me });
        return me;
    } catch {
        // An unreachable server reads as signed out; the next action that
        // needs a session asks again.
        set({ status: `ready`, me: null });
        return null;
    }
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function read(): MeState {
    return current;
}

/**
 * Who the browser is, as a store: read once at boot, then again after
 * anything that changes the session.
 */
export const meStore = {
    read,
    subscribe,
    refresh,
    start(): void {
        if (started) return;
        started = true;
        void refresh();
    },
    async signOut(): Promise<void> {
        await signOut();
        await refresh();
    },
    /**
     * Delete the signed-in account, then read who the browser is: no one.
     * `deleted` runs between the two, so a page can say so before it reads as signed out.
     */
    async deleteAccount(name: string, deleted: () => void): Promise<void> {
        await deleteAccount(name);
        deleted();
        await refresh();
    },
    /** Change the signed-in user's settings; the user the server answers with is who the browser is then. */
    async update(changes: MeUpdateRequest): Promise<void> {
        const me = await updateMe(changes);
        set({ status: `ready`, me });
    },
    /** The positions the signed-in user may still have read today, as an answer of the server counted them. */
    positionsLeft(left: number): void {
        if (current.status !== `ready` || current.me?.kind !== `user` || current.me.analysisLeft.positions === left) return;
        set({ status: `ready`, me: { ...current.me, analysisLeft: { ...current.me.analysisLeft, positions: left } } });
    },
    /** Become a guest, or keep the guest this browser already is. */
    async guest(): Promise<void> {
        await startGuest();
        await refresh();
    },
    /** Test seam: forget the session so each test starts from boot. */
    reset(): void {
        started = false;
        current = { status: `loading` };
    },
};

export function useMe(): MeState {
    return useSyncExternalStore(meStore.subscribe, read, read);
}

/** The name a person reads for themselves: their account name or guest label. */
export function selfName(state: MeState): string {
    return state.status === `ready` && state.me !== null ? state.me.name : text.game.you;
}
