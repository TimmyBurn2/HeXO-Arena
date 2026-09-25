import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Literals live where a theme or the scale owns them, nowhere else: colors
// and effects only in the theme sheets, absolute sizes only in the scale.
// Percentages and viewport units are structural layout, @media preludes
// carry breakpoints no theme would change, and svg geometry (viewBox
// numbers, text baseline offsets) is shape, not theme.
const themeSheets = `apps/web/src/styles/themes/`;
const scaleSheet = `apps/web/src/styles/scale.css`;
const root = `apps/web/src`;

const colorFunction = /\b(?:hsl|rgb|hwb|oklch|oklab|lab|lch|color)\(/i;
const hexColor = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?(?![0-9a-zA-Z])/;
const absoluteSize = /\d(?:\.\d+)?(?:px|rem|em|pt)\b/;
// Effects are theme material: a component consumes them through a token.
const effect = /\b(?:linear|radial|conic)-gradient\(|\btext-shadow\s*:|\bbackdrop-filter\s*:|\bdrop-shadow\(/;
// Shadows and filters outside a theme take their offsets from tokens; a
// bare non-zero number is an effect literal. `-1 *` negates a token.
const shadowOrFilter = /^\s*(?:box-shadow|filter)\s*:/;
const bareNumber = /(?<![\w-])[1-9]/;
// Outside a theme a shadow only draws edges inside its element; a shadow
// cast outward is lift or glow, which a theme owns through a slot.
const shadowDeclaration = /box-shadow\s*:\s*([^;]+);/g;

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
        const inTheme = file.startsWith(themeSheets);
        if (!inTheme && (colorFunction.test(line) || hexColor.test(line))) {
            hits.push(`${where}: color literal: ${line.trim()}`);
            continue;
        }
        if (!isCss || inTheme || file === scaleSheet) continue;
        if (effect.test(line)) {
            hits.push(`${where}: effect outside a theme: ${line.trim()}`);
            continue;
        }
        if (shadowOrFilter.test(line) && bareNumber.test(line.replace(/-1 \*/g, ``).replace(/var\([^)]*\)/g, ``))) {
            hits.push(`${where}: shadow or filter literal: ${line.trim()}`);
            continue;
        }
        if (line.trimStart().startsWith(`@media`)) continue;
        if (absoluteSize.test(line)) {
            hits.push(`${where}: absolute size literal: ${line.trim()}`);
        }
    }
}

for (const file of files.filter((name) => name.endsWith(`.css`) && !name.startsWith(themeSheets))) {
    if (!existsSync(file)) continue;
    for (const match of readFileSync(file, `utf8`).matchAll(shadowDeclaration)) {
        const layers = (match[1] ?? ``).split(/,(?![^(]*\))/).map((layer) => layer.trim());
        if (layers.some((layer) => layer !== `none` && !layer.startsWith(`inset`))) {
            hits.push(`${file}: outward shadow outside a theme: ${(match[1] ?? ``).replace(/\s+/g, ` `).trim()}`);
        }
    }
}

if (hits.length > 0) {
    console.error(`literals outside the theme sheets and the scale:`);
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
