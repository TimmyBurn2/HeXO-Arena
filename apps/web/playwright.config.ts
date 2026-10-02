import { defineConfig, devices } from '@playwright/test';

// The browser suite runs against the Vite dev server with the API mocked
// at the network layer, so it needs no server, database, or Discord.
// E2E_PORT lets two checkouts run the suite side by side.
const port = Number(process.env.E2E_PORT ?? 5199);

export default defineConfig({
    testDir: `e2e`,
    outputDir: `e2e/results`,
    fullyParallel: true,
    reporter: [[`list`]],
    use: {
        baseURL: `http://127.0.0.1:${String(port)}`,
        ...devices[`Desktop Chrome`],
        // Playwright moves Chrome's shared memory from /dev/shm to /tmp, a
        // default meant for containers with a tiny /dev/shm; on a host whose
        // /tmp is a quota-limited tmpfs, parallel runs exhaust it and the
        // renderers crash, so shared memory stays in /dev/shm.
        launchOptions: { ignoreDefaultArgs: [`--disable-dev-shm-usage`] },
    },
    webServer: {
        command: `node node_modules/vite/bin/vite.js --port ${String(port)} --strictPort`,
        url: `http://127.0.0.1:${String(port)}`,
        // A server left over from another checkout would serve stale code.
        reuseExistingServer: false,
    },
});
