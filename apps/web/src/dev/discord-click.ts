import { discordLoginPath } from '@hexo-arena/contract';

/** The Discord sign-in link a click landed on, or null for any other click. */
export function discordLinkOf(event: MouseEvent): HTMLAnchorElement | null {
    const link = event.target instanceof Element ? event.target.closest(`a[href^="${discordLoginPath}"]`) : null;
    return link instanceof HTMLAnchorElement ? link : null;
}

/**
 * Runs `then` once the top-bar panel holding the link has shut, at once
 * when no open panel holds it.
 * A panel holding the link, modal on a phone, would sit over the dev
 * panel, so it shuts first.
 */
export function afterHolder(link: Element, then: () => void): void {
    const holder = link.closest(`dialog`);
    if (holder?.open !== true) {
        then();
        return;
    }
    holder.addEventListener(
        `close`,
        () => {
            window.setTimeout(then, 0);
        },
        { once: true },
    );
    holder.close();
}
