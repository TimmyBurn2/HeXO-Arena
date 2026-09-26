import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { declarations, describePass, describePath, measure, measureStep, pairs, steps } from './contrast.mjs';

// WCAG 2.2 contrast for every theme, read from the theme sheets themselves,
// so a new theme is checked without touching this file.
const themeDir = `apps/web/src/styles/themes`;

const shared = [`brand.css`, `slots.css`];
const read = (file) => declarations(readFileSync(join(themeDir, file), `utf8`));
const base = new Map([...read(`brand.css`), ...read(`slots.css`)]);
const themes = readdirSync(themeDir).filter((file) => file.endsWith(`.css`) && !shared.includes(file));
const misses = [];
for (const file of themes) {
    const tokens = new Map([...base, ...read(file)]);
    const results = [...pairs.map((pair) => measure(tokens, pair)), ...steps.map((step) => measureStep(tokens, step))];
    const failed = results.filter((result) => result.passedBy === null);
    for (const result of failed) {
        const measured = result.paths.map(describePath).join(`, `);
        misses.push(`${file}: ${result.label} is ${measured}, needs ${String(result.minimum)}`);
    }
    // Every passing ratio prints, a failing theme's too, so a thin margin
    // shows before a new color breaks it; a pair with more than one way to
    // pass names the path that carried it, so a theme leaning on a rim, a
    // mark, or the casing shows.
    console.log(`${file}: ${String(results.length - failed.length)} of ${String(results.length)} pairs pass`);
    const width = Math.max(...results.map((result) => result.label.length));
    for (const result of results.filter((entry) => entry.passedBy !== null)) console.log(`    ${describePass(result, width)}`);
}

if (misses.length > 0) {
    console.error(`contrast below WCAG AA, or a surface step too shallow:`);
    for (const miss of misses) console.error(miss);
    process.exit(1);
}
