import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const web = fileURLToPath(new URL(`..`, import.meta.url));
const config = fileURLToPath(new URL(`../public/zod-config.js`, import.meta.url));

// Calls to Function while zod loads and builds and parses an object schema,
// in a fresh process, with the page's script run first or not.
function functionCalls(withConfig: boolean): number {
    const probe = `
        let calls = 0;
        const Real = Function;
        globalThis.Function = new Proxy(Real, {
            apply: (target, self, args) => ((calls += 1), Reflect.apply(target, self, args)),
            construct: (target, args) => ((calls += 1), Reflect.construct(target, args)),
        });
        const { z } = await import('zod');
        z.object({ name: z.string() }).parse({ name: 'x' });
        console.log(calls);
    `;
    const output = execFileSync(process.execPath, [...(withConfig ? [`--import`, config] : []), `--input-type=module`, `-e`, probe], { cwd: web, encoding: `utf8` });
    return Number(output.trim());
}

describe('the page\'s zod setup', () => {
    it('keeps zod from building code at run time, so the site runs under a CSP without eval', () => {
        expect(functionCalls(false)).toBeGreaterThan(0);
        expect(functionCalls(true)).toBe(0);
    });

    it('runs as a classic script ahead of the app\'s modules', () => {
        const page = readFileSync(new URL(`../index.html`, import.meta.url), `utf8`);
        expect([...page.matchAll(/<script ([^>]*)><\/script>/gu)].map((match) => match[1])).toEqual([`src="/zod-config.js"`, `type="module" src="/src/main.tsx"`]);
    });
});
