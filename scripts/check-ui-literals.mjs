import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Colors and absolute sizes live only in apps/web/src/styles/tokens.css;
// every other file references a token. Percentages and viewport units are
// structural layout, @media preludes carry breakpoints no theme would
// change, and svg geometry (viewBox numbers, text baseline offsets) is
// shape, not theme.
const tokenSheet = `apps/web/src/styles/tokens.css`;
const root = `apps/web/src`;

const colorFunction = /\b(?:hsl|rgb|hwb|oklch|oklab|lab|lch|color)\(/i;
const hexColor = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?(?![0-9a-zA-Z])/;
const absoluteSize = /\d(?:\.\d+)?(?:px|rem|em|pt)\b/;

const files = execFileSync(`git`, [`ls-files`, root], { encoding: `utf8` })
    .split(`\n`)
    .filter((file) => file !== ``);
for (const found of walk(root)) {
    if (!files.includes(found)) files.push(found);
}

const hits = [];
for (const file of files.sort()) {
    if (!existsSync(file)) continue;
    const isCss = file.endsWith(`.css`);
    const isCode = /\.(?:ts|tsx|js|jsx)$/.test(file);
    if (!isCss && !isCode) continue;
    const lines = readFileSync(file, `utf8`).split(`\n`);
    for (const [index, line] of lines.entries()) {
        const where = `${file}:${String(index + 1)}`;
        if (file === tokenSheet) continue;
        if (colorFunction.test(line) || hexColor.test(line)) {
            hits.push(`${where}: color literal: ${line.trim()}`);
            continue;
        }
        if (!isCss) continue;
        if (line.trimStart().startsWith(`@media`)) continue;
        if (absoluteSize.test(line)) {
            hits.push(`${where}: absolute size literal: ${line.trim()}`);
        }
    }
}

if (hits.length > 0) {
    console.error(`color or size literals outside the token sheet:`);
    for (const hit of hits) console.error(hit);
    process.exit(1);
}

function* walk(dir) {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
            yield* walk(path);
        } else {
            yield path;
        }
    }
}
