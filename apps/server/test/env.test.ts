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
