import { createHmac, randomBytes } from 'node:crypto';
import { BlockList, isIPv4, isIPv6 } from 'node:net';

// Addresses that name no one client on the internet:
// loopback, private, shared carrier-grade NAT, link-local, unique-local, multicast, reserved.
// A request from one of them meets only the global limits.
const notPublic = new BlockList();
for (const [network, prefix] of [
    [`0.0.0.0`, 8],
    [`10.0.0.0`, 8],
    [`100.64.0.0`, 10],
    [`127.0.0.0`, 8],
    [`169.254.0.0`, 16],
    [`172.16.0.0`, 12],
    [`192.168.0.0`, 16],
    [`224.0.0.0`, 3],
] as const) {
    notPublic.addSubnet(network, prefix, `ipv4`);
}
for (const [network, prefix] of [
    [`::`, 127],
    [`fc00::`, 7],
    [`fe80::`, 10],
    [`ff00::`, 8],
] as const) {
    notPublic.addSubnet(network, prefix, `ipv6`);
}

const dayMs = 86_400_000;

// The eight groups of an IPv6 address, any `::` expanded.
function ipv6Groups(address: string): string[] {
    const [head = ``, tail] = address.split(`::`);
    const left = head === `` ? [] : head.split(`:`);
    const right = tail === undefined || tail === `` ? [] : tail.split(`:`);
    return [...left, ...Array<string>(8 - left.length - right.length).fill(`0`), ...right].map((group) => group.padStart(4, `0`));
}

// One client as the limits count it:
// an IPv4 address whole, an IPv6 address by the /64 one subscriber holds,
// with the /48 a subscriber may hold as well;
// null where no public address is known.
function clientOf(address: string | undefined): { client: string; prefix: string | null } | null {
    if (address === undefined) return null;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu.exec(address)?.[1];
    const plain = mapped ?? address;
    if (isIPv4(plain)) return notPublic.check(plain, `ipv4`) ? null : { client: plain, prefix: null };
    if (!isIPv6(plain)) return null;
    if (notPublic.check(plain, `ipv6`)) return null;
    const groups = ipv6Groups(plain);
    return { client: `${groups.slice(0, 4).join(`:`)}::/64`, prefix: `${groups.slice(0, 3).join(`:`)}::/48` };
}

// The keys one request is limited under: its client's, and its IPv6 /48's, null for IPv4.
interface RequestKeys {
    readonly client: string | null;
    readonly prefix: string | null;
}

/**
 * The key a request is limited under: a keyed hash of the client address,
 * under a secret drawn at start and replaced when the UTC day turns,
 * so no key outlives its day and none can be reversed by trying every address.
 * The address is the peer's, unless the peer is the trusted proxy,
 * whose last forwarded address is the one it saw;
 * the address never leaves here.
 */
export class ClientKeys {
    readonly #trustedProxy: string | null;
    readonly #now: () => number;
    readonly #rekeyed = new Set<() => void>();
    #secret = randomBytes(32);
    #day: number;
    #keyless = 0;

    constructor(deps: { trustedProxy: string | null; now: () => number }) {
        this.#trustedProxy = deps.trustedProxy;
        this.#now = deps.now;
        this.#day = Math.floor(this.#now() / dayMs);
    }

    /** Requests since start that carried no public address. */
    get keyless(): number {
        return this.#keyless;
    }

    onRekey(listener: () => void): void {
        this.#rekeyed.add(listener);
    }

    keysOf(peer: string | undefined, forwardedFor: string | string[] | undefined): RequestKeys {
        const day = Math.floor(this.#now() / dayMs);
        if (day !== this.#day) {
            this.#day = day;
            this.#secret = randomBytes(32);
            for (const listener of this.#rekeyed) listener();
        }
        const forwarded = Array.isArray(forwardedFor) ? forwardedFor.join(`,`) : forwardedFor;
        // A server listening on IPv6 sees an IPv4 proxy as an IPv4-mapped address.
        const fromProxy = peer !== undefined && peer.replace(/^::ffff:/iu, ``) === this.#trustedProxy;
        const address = fromProxy ? forwarded?.split(`,`).at(-1)?.trim() : peer;
        const client = clientOf(address);
        if (client === null) {
            this.#keyless += 1;
            return { client: null, prefix: null };
        }
        return { client: this.#hash(client.client), prefix: client.prefix === null ? null : this.#hash(client.prefix) };
    }

    #hash(network: string): string {
        return createHmac(`sha256`, this.#secret).update(network).digest(`base64url`).slice(0, 22);
    }
}
