import './styles/scale.css';
import './styles/base.css';
import './styles/primitives.css';
import './styles/cut.css';
import { discordLoginPath } from '@hexo-arena/contract';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from './AppShell';
import { boardSettingsStore } from './board/board-settings';
import { legalStore } from './legal/documents';
import { meStore } from './me';
import { themeStore } from './theme/themes';

// Every sheet under themes loads; the root attribute picks one, so adding
// a theme needs no import here.
import.meta.glob(`./styles/themes/*.css`, { eager: true });
themeStore.start();
boardSettingsStore.start();
meStore.start();
legalStore.start();

const rootElement = document.getElementById(`root`);
if (!rootElement) {
    throw new Error(`missing #root element`);
}

createRoot(rootElement).render(
    <StrictMode>
        <AppShell />
    </StrictMode>,
);

// Only the dev server's bundle holds the dev pill: the build drops the
// branch, and the module with it.
// Dev has no Discord, so the dev tools take the sign-in link over, and a
// click on it while they load is held for them.
if (import.meta.env.DEV) {
    const held: MouseEvent[] = [];
    const hold = (event: MouseEvent) => {
        if (!(event.target instanceof Element) || event.target.closest(`a[href^="${discordLoginPath}"]`) === null) return;
        event.preventDefault();
        event.stopPropagation();
        held.push(event);
    };
    document.addEventListener(`click`, hold, true);
    void import(`./dev/start`).then((dev) => dev.startDevTools({ held, hold }));
}
