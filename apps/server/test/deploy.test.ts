import { readFileSync } from 'node:fs';
import { BlockList } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const compose = readFileSync(join(dirname(fileURLToPath(import.meta.url)), `../../../docker/prod/compose.yml`), `utf8`);

// A service's block in the compose file, up to the next top-level entry.
function service(name: string): string {
    return new RegExp(`\\n {4}${name}:\\n([\\s\\S]*?)(?=\\n {4}\\w|\\n\\w|$)`).exec(compose)?.[1] ?? ``;
}

describe('the production stack', () => {
    it('trusts forwarded addresses from Caddy alone, at its fixed address on the internal network', () => {
        const trusted = /TRUSTED_PROXY: (\S+)/u.exec(service(`app`))?.[1];
        const caddy = /ipv4_address: (\S+)/u.exec(service(`caddy`))?.[1];
        const subnet = /subnet: (\S+)\/(\d+)/u.exec(compose);
        expect(trusted).toBeDefined();
        expect(trusted).toBe(caddy);
        const internal = new BlockList();
        internal.addSubnet(subnet?.[1] ?? ``, Number(subnet?.[2]), `ipv4`);
        expect(internal.check(trusted ?? ``, `ipv4`)).toBe(true);
    });
});
