import { describe, expect, it } from 'vitest';
import { ClientKeys } from '../src/client-key';
import { RateBuckets } from '../src/rate-limits';

describe('RateBuckets', () => {
    it('admit a burst, refuse the next with the exact wait, and admit one more per refill', () => {
        let now = 0;
        const buckets = new RateBuckets({ burst: 3, refillMs: 2_500 }, () => now);
        expect([buckets.take(`a`), buckets.take(`a`), buckets.take(`a`)]).toEqual([null, null, null]);
        expect(buckets.take(`a`)).toBe(3);
        expect(buckets.take(`b`)).toBe(null);
        now = 2_499;
        expect(buckets.take(`a`)).toBe(1);
        now = 2_500;
        expect(buckets.take(`a`)).toBe(null);
        expect(buckets.take(`a`)).toBe(3);
    });

    it('drop a bucket once it is full again, and the oldest key past the cap', () => {
        let now = 0;
        const buckets = new RateBuckets({ burst: 2, refillMs: 1_000 }, () => now, 2);
        buckets.take(`a`);
        buckets.take(`b`);
        buckets.take(`c`);
        expect(buckets.size).toBe(2);
        expect(buckets.take(`a`)).toBe(null);
        now = 1_000;
        buckets.sweep();
        expect(buckets.size).toBe(0);
    });
});

describe('ClientKeys', () => {
    const proxy = `172.29.64.10`;
    const keys = (now = () => 0) => new ClientKeys({ trustedProxy: proxy, now });

    it('key a request by its peer unless the peer is the trusted proxy, whose last forwarded address counts', () => {
        const table = keys();
        const direct = table.keysOf(`198.51.100.1`, `203.0.113.9`).client;
        expect(direct).toBe(table.keysOf(`198.51.100.1`, undefined).client);
        expect(table.keysOf(proxy, `203.0.113.9`).client).toBe(table.keysOf(`203.0.113.9`, undefined).client);
        expect(table.keysOf(proxy, `1.1.1.1, 203.0.113.9`).client).toBe(table.keysOf(proxy, `203.0.113.9`).client);
        expect(table.keysOf(proxy, `203.0.113.9`).client).not.toBe(table.keysOf(proxy, `203.0.113.10`).client);
        expect(table.keysOf(proxy, `203.0.113.9, 203.0.113.10`).client).toBe(table.keysOf(proxy, `203.0.113.10`).client);
    });

    it('trust the proxy when it reaches a server listening on IPv6 as an IPv4-mapped address', () => {
        const table = keys();
        expect(table.keysOf(`::ffff:${proxy}`, `203.0.113.9`).client).toBe(table.keysOf(`203.0.113.9`, undefined).client);
    });

    it('key IPv6 by its first 64 bits, and an IPv4-mapped address as IPv4', () => {
        const table = keys();
        expect(table.keysOf(`2001:db8:1:2::1`, undefined).client).toBe(table.keysOf(`2001:db8:1:2:ffff:0:0:9`, undefined).client);
        expect(table.keysOf(`2001:db8:1:2::1`, undefined).client).not.toBe(table.keysOf(`2001:db8:1:3::1`, undefined).client);
        expect(table.keysOf(`::ffff:198.51.100.7`, undefined).client).toBe(table.keysOf(`198.51.100.7`, undefined).client);
    });

    it('key IPv6 by its first 48 bits as well, and IPv4 by no prefix', () => {
        const table = keys();
        expect(table.keysOf(`2001:db8:1:2::1`, undefined).prefix).toBe(table.keysOf(`2001:db8:1:ffff::9`, undefined).prefix);
        expect(table.keysOf(`2001:db8:1:2::1`, undefined).prefix).not.toBe(table.keysOf(`2001:db8:2:2::1`, undefined).prefix);
        expect(table.keysOf(`2001:db8:1:2::1`, undefined).prefix).not.toBe(table.keysOf(`2001:db8:1:2::1`, undefined).client);
        expect(table.keysOf(`198.51.100.7`, undefined).prefix).toBe(null);
        expect(table.keysOf(`::ffff:198.51.100.7`, undefined).prefix).toBe(null);
        expect(table.keysOf(`fd00::1`, undefined)).toEqual({ client: null, prefix: null });
    });

    it('make no key of an address that is not public, and count such requests', () => {
        const table = keys();
        for (const address of [`127.0.0.1`, `10.1.2.3`, `172.20.0.4`, `192.168.1.1`, `100.64.0.9`, `169.254.1.1`, `::1`, `fd00::1`, `fe80::1`, undefined]) {
            expect(table.keysOf(address, undefined).client, String(address)).toBe(null);
        }
        expect(table.keysOf(proxy, `10.0.0.3`).client).toBe(null);
        expect(table.keyless).toBe(11);
    });

    it('draw a new secret when the UTC day turns, telling its listeners', () => {
        let now = 86_400_000 - 1;
        const table = keys(() => now);
        let turned = 0;
        table.onRekey(() => {
            turned += 1;
        });
        const before = table.keysOf(`198.51.100.1`, undefined).client;
        expect(table.keysOf(`198.51.100.1`, undefined).client).toBe(before);
        now = 86_400_000;
        expect(table.keysOf(`198.51.100.1`, undefined).client).not.toBe(before);
        expect(turned).toBe(1);
    });
});
