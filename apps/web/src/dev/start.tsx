import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DevTools } from './DevTools';
import { fetchDevAccounts } from './dev-api';
import { afterHolder, discordLinkOf } from './discord-click';

// Clicks on the Discord link held while the dev tools load, and the listener holding them.
type EarlyClicks = { held: readonly MouseEvent[]; hold: (event: MouseEvent) => void };

/**
 * Mounts the dev pill beside the app, in a root of its own, when the
 * server answers the dev accounts route; a server without the dev routes
 * gets nothing.
 * A Discord click held until the route answers then opens the panel, or
 * follows the link when the server has no dev routes.
 */
export async function startDevTools(early: EarlyClicks): Promise<void> {
    const accounts = await fetchDevAccounts().catch(() => null);
    document.removeEventListener(`click`, early.hold, true);
    const last = early.held.at(-1);
    const link = last === undefined ? null : discordLinkOf(last);
    if (accounts === null) {
        if (link !== null) window.location.assign(link.href);
        return;
    }
    const host = document.createElement(`div`);
    host.className = `dev-tools`;
    document.body.append(host);
    const mount = (opened: boolean) => {
        createRoot(host).render(
            <StrictMode>
                <DevTools initial={accounts} opened={opened} />
            </StrictMode>,
        );
    };
    if (link === null) mount(false);
    else
        afterHolder(link, () => {
            mount(true);
        });
}
