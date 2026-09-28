import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { licenseFileName, thirdPartyLicenses } from './build/licenses.ts';

export default defineConfig({
    plugins: [react(), thirdPartyLicenses()],
    // At the site's root under a plain name, not in Vite's default dot
    // directory, so the static server hands it out like any file.
    build: { license: { fileName: licenseFileName } },
    test: {
        setupFiles: ['test/setup.ts'],
        // The browser suite under e2e runs in Playwright, not here.
        include: ['test/**/*.test.{ts,tsx}'],
    },
    server: {
        host: true,
        port: 5173,
        strictPort: true,
        // The SPA talks to the API on its own origin; dev traffic forwards
        // to the local server process.
        proxy: {
            '/api': 'http://localhost:3000',
            '/healthz': 'http://localhost:3000',
        },
    },
});
