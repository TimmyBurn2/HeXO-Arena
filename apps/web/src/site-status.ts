import { pausedRetryAfterSeconds, healthzPath } from '@hexarena/contract';

// The health probe is one bit: up, or refusing new starts.
// The pause retry-after doubles as the poll cadence, so a lifted pause
// shows within a minute without anyone refreshing.
export type SiteStatus = `up` | `paused`;

let current: SiteStatus = `up`;
let probing = false;
const listeners = new Set<() => void>();

function probe(): Promise<void> {
    if (probing) return Promise.resolve();
    probing = true;
    return probeHealth()
        .catch(() => {
            // A network miss keeps the last known status; blanking the site
            // to an error state on a flaky link is worse than a stale bit.
        })
        .then(() => {
            probing = false;
        });
}

async function probeHealth(): Promise<void> {
    const response = await fetch(healthzPath, { cache: `no-store` });
    // Only the contract 503 is the pause signal; anything else (a proxy
    // 502 while the backend restarts) keeps the last known status.
    if (response.status !== 503 && !response.ok) return;
    const next: SiteStatus = response.status === 503 ? `paused` : `up`;
    if (next !== current) {
        current = next;
        for (const listener of listeners) listener();
    }
}

function read(): SiteStatus {
    return current;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function start(): void {
    void probe();
    if (timer === null) {
        timer = setInterval(() => {
            void probe();
        }, pausedRetryAfterSeconds * 1000);
    }
}

/**
 * The site-wide pause state the shell banners; games already running keep
 * running, so the banner never blocks navigation.
 */
export const siteStatusStore = {
    read,
    subscribe,
    start,
};

let timer: ReturnType<typeof setInterval> | null = null;
