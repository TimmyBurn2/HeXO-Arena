import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from './AppShell';
import './styles/tokens.css';
import './styles/site.css';

const rootElement = document.getElementById(`root`);
if (!rootElement) {
    throw new Error(`missing #root element`);
}

createRoot(rootElement).render(
    <StrictMode>
        <AppShell />
    </StrictMode>,
);
