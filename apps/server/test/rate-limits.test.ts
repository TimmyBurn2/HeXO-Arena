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
        const direct = table.keyOf(`198.51.100.1`, `203.0.113.9`);
        expect(direct).toBe(table.keyOf(`198.51.100.1`, undefined));
        expect(table.keyOf(proxy, `203.0.113.9`)).toBe(table.keyOf(`203.0.113.9`, undefined));
        expect(table.keyOf(proxy, `1.1.1.1, 203.0.113.9`)).toBe(table.keyOf(proxy, `203.0.113.9`));
        expect(table.keyOf(proxy, `203.0.113.9`)).not.toBe(table.keyOf(proxy, `203.0.113.10`));
        expect(table.keyOf(proxy, `203.0.113.9, 203.0.113.10`)).toBe(table.keyOf(proxy, `203.0.113.10`));
    });

    it('trust the proxy when it reaches a server listening on IPv6 as an IPv4-mapped address', () => {
        const table = keys();
        expect(table.keyOf(`::ffff:${proxy}`, `203.0.113.9`)).toBe(table.keyOf(`203.0.113.9`, undefined));
    });

    it('key IPv6 by its first 64 bits, and an IPv4-mapped address as IPv4', () => {
        const table = keys();
        expect(table.keyOf(`2001:db8:1:2::1`, undefined)).toBe(table.keyOf(`2001:db8:1:2:ffff:0:0:9`, undefined));
        expect(table.keyOf(`2001:db8:1:2::1`, undefined)).not.toBe(table.keyOf(`2001:db8:1:3::1`, undefined));
        expect(table.keyOf(`::ffff:198.51.100.7`, undefined)).toBe(table.keyOf(`198.51.100.7`, undefined));
    });

    it('make no key of an address that is not public, and count such requests', () => {
        const table = keys();
        for (const address of [`127.0.0.1`, `10.1.2.3`, `172.20.0.4`, `192.168.1.1`, `100.64.0.9`, `169.254.1.1`, `::1`, `fd00::1`, `fe80::1`, undefined]) {
            expect(table.keyOf(address, undefined), String(address)).toBe(null);
        }
        expect(table.keyOf(proxy, `10.0.0.3`)).toBe(null);
        expect(table.keyless).toBe(11);
    });

    it('draw a new secret when the UTC day turns, telling its listeners', () => {
        let now = 86_400_000 - 1;
        const table = keys(() => now);
        let turned = 0;
        table.onRekey(() => {
            turned += 1;
        });
        const before = table.keyOf(`198.51.100.1`, undefined);
        expect(table.keyOf(`198.51.100.1`, undefined)).toBe(before);
        now = 86_400_000;
        expect(table.keyOf(`198.51.100.1`, undefined)).not.toBe(before);
        expect(turned).toBe(1);
    });
});
