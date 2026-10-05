import { readFileSync } from 'node:fs';
import { BlockList } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv as parseEnvFile } from 'node:util';
import { describe, expect, it } from 'vitest';
import { adminUsage } from '../src/admin-client';
import { envKeys } from '../src/env';

const root = join(dirname(fileURLToPath(import.meta.url)), `../../..`);
const prod = join(root, `docker/prod`);
const compose = readFileSync(join(prod, `compose.yml`), `utf8`);

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

describe('the production env examples', () => {
    const placeholder = /<[^>]+>/u;

    it('give compose exactly the variables its file requires, each a placeholder to replace', () => {
        const example = parseEnvFile(readFileSync(join(prod, `env.example`), `utf8`));
        const required = new Set([...compose.matchAll(/\$\{(\w+):\?/gu)].map((match) => match[1]));
        expect(Object.keys(example).sort()).toEqual([...required].sort());
        for (const value of Object.values(example)) expect(value).toMatch(placeholder);
    });

    it('give the app only variables it reads, none the image or the compose file sets, and the required ones as placeholders', () => {
        const example = parseEnvFile(readFileSync(join(prod, `hexo-arena.env.example`), `utf8`));
        const image = /\nENV ([\s\S]*?)\n\n/u.exec(readFileSync(join(prod, `Dockerfile`), `utf8`))?.[1] ?? ``;
        const composed = /\n {8}environment:\n((?: {12}.*\n)+)/u.exec(service(`app`))?.[1] ?? ``;
        const setElsewhere = [...image.matchAll(/(\w+)=/gu), ...composed.matchAll(/^ {12}(\w+):/gmu)].map((match) => match[1]);
        expect(setElsewhere).toEqual(expect.arrayContaining([`NODE_ENV`, `DATABASE_PATH`, `TRUSTED_PROXY`, `WEB_INDEX_PATH`]));
        const keys = Object.keys(example);
        expect(keys.filter((key) => !(envKeys as readonly string[]).includes(key))).toEqual([]);
        expect(keys.filter((key) => setElsewhere.includes(key) || key.startsWith(`DEV_`))).toEqual([]);
        for (const key of [`PUBLIC_ORIGIN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`]) expect(example[key]).toMatch(placeholder);
    });
});

// An admin op's name: its leading words, before any target, flag, or option.
function opName(usage: string): string {
    const words = usage.trim().split(/\s+/u);
    const end = words.findIndex((word) => !/^[a-z][a-z-]*$/u.test(word));
    return words.slice(0, end === -1 ? words.length : end).join(` `);
}

describe('the deploy guide', () => {
    it('lists in its admin table every op the admin client takes, and no other', () => {
        const guide = readFileSync(join(root, `DEPLOY.md`), `utf8`);
        const administration = /\n## Administration\n([\s\S]*?)(?=\n##)/u.exec(guide)?.[1] ?? ``;
        const firstCells = [...administration.matchAll(/^\| (.+?) \| /gmu)].map((row) => row[1] ?? ``);
        const listed = firstCells.flatMap((cell) => [...cell.matchAll(/`([^`]+)`/gu)].map((code) => opName(code[1] ?? ``)));
        const taken = adminUsage
            .split(`\n`)
            .slice(1)
            .filter((line) => line.trim() !== ``)
            .map(opName);
        expect(new Set(listed)).toEqual(new Set(taken));
    });
});
