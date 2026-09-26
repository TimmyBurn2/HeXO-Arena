// The layer order must be declared before any component sheet loads, so
// the style imports lead.
import './styles/layers.css';
import './styles/scale.css';
import './styles/base.css';
import './styles/primitives.css';
import './styles/cut.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from './AppShell';
import { boardSettingsStore } from './board/board-settings';
import { meStore } from './me';
import { themeStore } from './theme/themes';

// Every sheet under themes loads; the root attribute picks one, so adding
// a theme needs no import here.
import.meta.glob(`./styles/themes/*.css`, { eager: true });
themeStore.start();
boardSettingsStore.start();
meStore.start();

const rootElement = document.getElementById(`root`);
if (!rootElement) {
    throw new Error(`missing #root element`);
}

createRoot(rootElement).render(
    <StrictMode>
        <AppShell />
    </StrictMode>,
);
