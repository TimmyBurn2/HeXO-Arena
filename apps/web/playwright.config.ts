import { defineConfig, devices } from '@playwright/test';

// The browser suite runs against the Vite dev server with the API mocked
// at the network layer, so it needs no server, database, or Discord.
// E2E_BUILD=1 runs it against the production build instead, which alone
// shows what bundling changes, such as the order of the style sheets.
// E2E_PORT lets two checkouts run the suite side by side.
// E2E_SHOTS=1 also writes screenshots of the screens to e2e/shots for review.
// CI's browser job leaves out the tests tagged @sweep.
const port = Number(process.env.E2E_PORT ?? 5199);
const vite = `node node_modules/vite/bin/vite.js`;
const build = process.env.E2E_BUILD === `1`;

export default defineConfig({
    testDir: `e2e`,
    outputDir: `e2e/results`,
    fullyParallel: true,
    // A focused test left in would pass CI on that test alone.
    forbidOnly: process.env.CI !== undefined,
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
        command: build ? `${vite} build && ${vite} preview --port ${String(port)} --strictPort` : `${vite} --port ${String(port)} --strictPort`,
        url: `http://127.0.0.1:${String(port)}`,
        // A server left over from another checkout would serve stale code.
        reuseExistingServer: false,
    },
});
