import { useCallback, useState, useSyncExternalStore } from 'react';
import { readStored, writeStored } from '../stored';

export type DrawerTab = `moves` | `game`;

// How the drawer came open: by hand it takes the keyboard, by hovering
// the edge it leaves the keyboard on the board.
export type Opener = `hand` | `hover`;

export interface Drawer {
    // Shown, whether opened by hand or held open by the pin.
    visible: boolean;
    openedBy: Opener;
    pinned: boolean;
    // Pinning needs room beside the board; narrower screens ignore it.
    pinnable: boolean;
    tab: DrawerTab;
    show: (tab?: DrawerTab, by?: Opener) => void;
    hide: () => void;
    toggle: () => void;
    choose: (tab: DrawerTab) => void;
    pin: (pinned: boolean) => void;
}

const pinKey = `hexarena.drawer-pinned.v1`;
const wideQuery = `(min-width: 80rem)`;

function subscribeWide(listener: () => void): () => void {
    const query = window.matchMedia(wideQuery);
    query.addEventListener(`change`, listener);
    return () => {
        query.removeEventListener(`change`, listener);
    };
}

function readWide(): boolean {
    return typeof window.matchMedia === `function` && window.matchMedia(wideQuery).matches;
}

/**
 * The game drawer: closed by default, one tab at a time, and pinnable on
 * wide screens, where the pin persists so a player who likes the feed
 * beside the board keeps it there.
 */
export function useDrawer(): Drawer {
    const [open, setOpen] = useState(false);
    const [pinned, setPinned] = useState(() => readStored(pinKey) === `1`);
    const [tab, setTab] = useState<DrawerTab>(`moves`);
    const [openedBy, setOpenedBy] = useState<Opener>(`hand`);
    const wide = useSyncExternalStore(
        (listener) => (typeof window.matchMedia === `function` ? subscribeWide(listener) : () => undefined),
        readWide,
        () => false,
    );
    const held = pinned && wide;

    const show = useCallback((next?: DrawerTab, by: Opener = `hand`) => {
        if (next !== undefined) setTab(next);
        setOpenedBy(by);
        setOpen(true);
    }, []);
    const hide = useCallback(() => {
        setOpen(false);
    }, []);
    const toggle = useCallback(() => {
        setOpenedBy(`hand`);
        setOpen((current) => !current);
    }, []);
    const pin = useCallback((next: boolean) => {
        setPinned(next);
        writeStored(pinKey, next ? `1` : `0`);
        if (!next) setOpen(false);
    }, []);

    return {
        visible: open || held,
        openedBy,
        pinned: held,
        pinnable: wide,
        tab,
        show,
        hide,
        toggle: held ? () => undefined : toggle,
        choose: setTab,
        pin,
    };
}
