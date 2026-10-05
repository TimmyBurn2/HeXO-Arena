import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// Literals live where a theme or the scale owns them, nowhere else: colors
// and effects only in the theme sheets, absolute sizes and durations only in
// the scale.
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
// Every motion takes its duration from the scale's tokens, which sit in one
// band, short enough to never delay play, and drop to zero for a reader who
// asks for reduced motion; a computed or literal duration would escape both.
const [bandFrom, bandTo] = [120, 180];
const motionDeclaration = /(?<![\w-])(?:transition|animation)(?:-duration|-delay)?\s*:\s*([^;{}]+);/g;
const timeLiteral = /(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g;
// In script, a duration rides an inline style, and an animation runs from
// the Web Animations API, which no sheet can hold to the band.
const scriptedDuration = /\b(?:transition|animation)\w*\s*[:=]\s*[`'"][^`'"]*?(?<![\w.-])\d*\.?\d+m?s\b/i;
const scriptedAnimation = /\.animate\(/;

// New files count before they are staged, so a local run sees what a commit would carry.
const files = execFileSync(`git`, [`ls-files`, `--cached`, `--others`, `--exclude-standard`, root], { encoding: `utf8` })
    .split(`\n`)
    .filter((file) => file !== ``);

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
        if (isCode && (scriptedDuration.test(line) || scriptedAnimation.test(line))) {
            hits.push(`${where}: motion set from script: ${line.trim()}`);
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

for (const file of files.filter((name) => name.endsWith(`.css`) && name !== scaleSheet)) {
    if (!existsSync(file)) continue;
    const sheet = readFileSync(file, `utf8`);
    for (const match of sheet.matchAll(motionDeclaration)) {
        const value = match[1] ?? ``;
        const literal = [...value.matchAll(timeLiteral)].some((time) => Number.parseFloat(time[1] ?? ``) !== 0);
        if (literal || value.includes(`calc(`)) {
            const line = sheet.slice(0, match.index).split(`\n`).length;
            hits.push(`${file}:${String(line)}: duration outside the scale: ${match[0].replace(/\s+/g, ` `).trim()}`);
        }
    }
}

const scale = existsSync(scaleSheet) ? readFileSync(scaleSheet, `utf8`) : ``;
const tokens = [...scale.matchAll(/(--dur-[\w-]+)\s*:\s*(\d*\.?\d+)(ms|s)\s*;/g)];
if (tokens.length === 0) hits.push(`${scaleSheet}: no duration tokens`);
for (const [declaration, name, amount, unit] of tokens) {
    const ms = Number.parseFloat(amount ?? ``) * (unit === `s` ? 1000 : 1);
    if (ms !== 0 && (ms < bandFrom || ms > bandTo)) {
        hits.push(`${scaleSheet}: ${String(name)} outside the motion band of ${String(bandFrom)} to ${String(bandTo)} ms: ${declaration}`);
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
