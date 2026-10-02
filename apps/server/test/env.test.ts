import { readFileSync } from 'node:fs';
import { parseEnv as parseEnvFile } from 'node:util';
import { describe, expect, it } from 'vitest';
import { envKeys, parseEnv } from '../src/env';

const example = parseEnvFile(readFileSync(new URL(`../../../.env.example`, import.meta.url), `utf8`));

describe('the committed env example', () => {
    it('lists exactly the keys of the env schema', () => {
        expect(Object.keys(example).sort()).toEqual([...envKeys].sort());
    });

    it('is the schema defaults with the dev login and the fast stop on', () => {
        expect(parseEnv(example)).toEqual(parseEnv({ DEV_LOGIN: `1`, DEV_FAST_STOP: `1` }));
    });
});

describe('TRUSTED_PROXY', () => {
    const production = { NODE_ENV: `production`, PUBLIC_ORIGIN: `https://arena.example` };

    it('may stay unset outside production, trusting no forwarded address', () => {
        expect(parseEnv({}).TRUSTED_PROXY).toBe(null);
    });

    it('takes an IP address only', () => {
        expect(parseEnv({ TRUSTED_PROXY: `172.29.64.10` }).TRUSTED_PROXY).toBe(`172.29.64.10`);
        expect(() => parseEnv({ TRUSTED_PROXY: `caddy` })).toThrow(/TRUSTED_PROXY/);
    });

    it('unset in production refuses to parse', () => {
        expect(() => parseEnv(production)).toThrow(/TRUSTED_PROXY/);
        expect(parseEnv({ ...production, TRUSTED_PROXY: `172.29.64.10` }).TRUSTED_PROXY).toBe(`172.29.64.10`);
    });
});

describe('PUBLIC_ORIGIN', () => {
    const production = { NODE_ENV: `production`, TRUSTED_PROXY: `172.29.64.10` };

    it('in production must be https with no path, or env parsing fails', () => {
        for (const origin of [`http://arena.example`, `https://arena.example/app`, `https://arena.example?x=1`, `https://user@arena.example`, `arena.example`]) {
            expect(() => parseEnv({ ...production, PUBLIC_ORIGIN: origin }), origin).toThrow(/PUBLIC_ORIGIN/);
        }
        expect(() => parseEnv(production)).toThrow(/PUBLIC_ORIGIN/);
    });

    it('in production takes an https origin, a trailing slash dropped', () => {
        expect(parseEnv({ ...production, PUBLIC_ORIGIN: `https://arena.example` }).PUBLIC_ORIGIN).toBe(`https://arena.example`);
        expect(parseEnv({ ...production, PUBLIC_ORIGIN: `https://arena.example:8443/` }).PUBLIC_ORIGIN).toBe(`https://arena.example:8443`);
    });

    it('may stay plain http outside production', () => {
        expect(parseEnv({}).PUBLIC_ORIGIN).toBe(`http://localhost:3000`);
    });
});
