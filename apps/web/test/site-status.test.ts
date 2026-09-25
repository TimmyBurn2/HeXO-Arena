// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { siteStatusStore } from '../src/site-status';

function stubHealth(status: number): void {
    vi.stubGlobal(`fetch`, vi.fn(() => Promise.resolve(new Response(null, { status }))));
}

describe('siteStatusStore', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('reads up while health answers ok', async () => {
        stubHealth(200);
        siteStatusStore.start();
        await vi.waitFor(() => {
            expect(siteStatusStore.read()).toBe(`up`);
        });
    });

    it('reads paused when health refuses new starts', async () => {
        stubHealth(503);
        siteStatusStore.start();
        await vi.waitFor(() => {
            expect(siteStatusStore.read()).toBe(`paused`);
        });
    });

    it('keep the last status when the probe cannot run', async () => {
        stubHealth(503);
        siteStatusStore.start();
        await vi.waitFor(() => {
            expect(siteStatusStore.read()).toBe(`paused`);
        });
        vi.stubGlobal(`fetch`, vi.fn(() => Promise.reject(new Error(`network is gone`))));
        siteStatusStore.start();
        await new Promise((resolve) => {
            setTimeout(resolve, 10);
        });
        expect(siteStatusStore.read()).toBe(`paused`);
    });

    it('ignore proxy errors that are not the pause signal', async () => {
        stubHealth(503);
        siteStatusStore.start();
        await vi.waitFor(() => {
            expect(siteStatusStore.read()).toBe(`paused`);
        });
        stubHealth(502);
        siteStatusStore.start();
        await new Promise((resolve) => {
            setTimeout(resolve, 10);
        });
        expect(siteStatusStore.read()).toBe(`paused`);
    });

    it('notify subscribers when the status flips', async () => {
        stubHealth(200);
        siteStatusStore.start();
        await vi.waitFor(() => {
            expect(siteStatusStore.read()).toBe(`up`);
        });
        let notified = 0;
        const unsubscribe = siteStatusStore.subscribe(() => {
            notified += 1;
        });
        stubHealth(503);
        siteStatusStore.start();
        await vi.waitFor(() => {
            expect(siteStatusStore.read()).toBe(`paused`);
        });
        unsubscribe();
        expect(notified).toBe(1);
    });
});
