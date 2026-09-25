import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [react()],
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
