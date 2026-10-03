import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { legalFiles } from './build/legal.ts';
import { licenseFileName, thirdPartyLicenses } from './build/licenses.ts';

export default defineConfig({
    plugins: [react(), thirdPartyLicenses(), legalFiles()],
    // At the site's root under a plain name, not in Vite's default dot
    // directory, so the static server hands it out like any file.
    build: { license: { fileName: licenseFileName } },
    test: {
        setupFiles: ['test/setup.ts'],
        // The browser suite under e2e runs in Playwright, not here.
        include: ['test/**/*.test.{ts,tsx}'],
    },
    server: {
        // The dev server signs anyone in and serves dev bot tokens, so it
        // stays on the loopback address unless asked otherwise, and serves
        // no file outside what the site loads.
        host: process.env.VITE_HOST ?? `127.0.0.1`,
        fs: { allow: [`.`, `../../packages`, `../../legal`, `../../node_modules`].map((path) => fileURLToPath(new URL(path, import.meta.url))) },
        port: 5173,
        strictPort: true,
        // The SPA talks to the API on its own origin; dev traffic forwards
        // to the local server process, websockets included, so a bot run
        // against this origin opens its game and analysis sockets.
        proxy: {
            '/api': { target: 'http://localhost:3000', ws: true },
            '/healthz': 'http://localhost:3000',
        },
    },
});
