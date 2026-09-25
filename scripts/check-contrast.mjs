import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// WCAG 2.2 contrast for every theme, read from the theme sheets themselves,
// so a new theme is checked without touching this file. Pairs name the
// vocabulary, never a theme; thresholds are never rounded: 4.5 for text,
// 3 for graphics, large text, and bold stone numbers.
const themeDir = `apps/web/src/styles/themes`;

const pairs = [
    [`text on base`, `--c-text`, `--c-bg`, 4.5],
    [`text on raised`, `--c-text`, `--c-bg-raised`, 4.5],
    [`text on overlay`, `--c-text`, `--c-bg-overlay`, 4.5],
    [`text on hover`, `--c-text`, `--c-bg-hover`, 4.5],
    [`text on input`, `--c-text`, `--c-bg-input`, 4.5],
    [`text on accent tint`, `--c-text`, `--c-accent-bg`, 4.5],
    [`dim on base`, `--c-text-dim`, `--c-bg`, 4.5],
    [`dim on raised`, `--c-text-dim`, `--c-bg-raised`, 4.5],
    [`dim on overlay`, `--c-text-dim`, `--c-bg-overlay`, 4.5],
    [`dim on hover`, `--c-text-dim`, `--c-bg-hover`, 4.5],
    [`accent on base`, `--c-accent`, `--c-bg`, 4.5],
    [`accent on raised`, `--c-accent`, `--c-bg-raised`, 4.5],
    [`accent on overlay`, `--c-accent`, `--c-bg-overlay`, 4.5],
    [`accent on accent tint`, `--c-accent`, `--c-accent-bg`, 4.5],
    [`text on accent`, `--c-text-on-accent`, `--c-accent-solid`, 4.5],
    [`text on accent hover`, `--c-text-on-accent`, `--c-accent-solid-hover`, 4.5],
    [`bot badge`, `--c-bot`, `--c-bot-bg`, 4.5],
    [`good on base`, `--c-good`, `--c-bg`, 4.5],
    [`good on raised`, `--c-good`, `--c-bg-raised`, 4.5],
    [`bad on base`, `--c-bad`, `--c-bg`, 4.5],
    [`bad on raised`, `--c-bad`, `--c-bg-raised`, 4.5],
    [`bad on overlay`, `--c-bad`, `--c-bg-overlay`, 4.5],
    [`bad on hover`, `--c-bad`, `--c-bg-hover`, 4.5],
    [`text on active`, `--c-text`, `--c-bg-active`, 4.5],
    [`bad on active`, `--c-bad`, `--c-bg-active`, 4.5],
    [`good on input`, `--c-good`, `--c-bg-input`, 4.5],
    [`dim on input`, `--c-text-dim`, `--c-bg-input`, 4.5],
    [`accent on hover`, `--c-accent`, `--c-bg-hover`, 4.5],
    [`warn on base`, `--c-warn`, `--c-bg`, 4.5],
    [`warn on raised`, `--c-warn`, `--c-bg-raised`, 4.5],
    [`text on bad solid`, `--c-text-on-accent`, `--c-bad-solid`, 4.5],
    [`focus on base`, `--c-focus`, `--c-bg`, 3],
    [`focus on overlay`, `--c-focus`, `--c-bg-overlay`, 3],
    [`accent solid on base`, `--c-accent-solid`, `--c-bg`, 3],
    [`good solid on base`, `--c-good-solid`, `--c-bg`, 3],
    [`bad solid on base`, `--c-bad-solid`, `--c-bg`, 3],
    [`online on base`, `--c-online`, `--c-bg`, 3],
    [`offline on raised`, `--c-offline`, `--c-bg-raised`, 3],
    [`offline on hover`, `--c-offline`, `--c-bg-hover`, 3],
    [`frontier on cell`, `--board-frontier`, `--board-cell`, 3],
    [`frontier on board`, `--board-frontier`, `--board-bg`, 3],
    [`stone x on cell`, `--board-stone-x`, `--board-cell`, 3],
    [`stone o on cell`, `--board-stone-o`, `--board-cell`, 3],
    [`stone x against o`, `--board-stone-x`, `--board-stone-o`, 3],
    [`pending on cell`, `--board-pending`, `--board-cell`, 3],
    [`last move on cell`, `--board-last`, `--board-cell`, 3],
    [`win line on cell`, `--board-win`, `--board-cell`, 3],
    [`focus on cell`, `--board-focus`, `--board-cell`, 3],
    [`number on x`, `--board-number-x`, `--board-stone-x`, 3],
    [`number on o`, `--board-number-o`, `--board-stone-o`, 3],
    [`coordinate on board`, `--board-coord`, `--board-bg`, 4.5],
];

function declarations(file) {
    const found = new Map();
    const css = readFileSync(join(themeDir, file), `utf8`);
    for (const match of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
        found.set(match[1], match[2].trim());
    }
    return found;
}

function resolve(tokens, name, seen = new Set()) {
    const value = tokens.get(name);
    if (value === undefined) throw new Error(`${name} is not defined`);
    const alias = /^var\((--[a-z0-9-]+)\)$/.exec(value);
    if (alias !== null) {
        if (seen.has(name)) throw new Error(`${name} aliases itself`);
        seen.add(name);
        return resolve(tokens, alias[1], seen);
    }
    const hsl = /^hsl\(([\d.]+) ([\d.]+)% ([\d.]+)%\)$/.exec(value);
    if (hsl === null) throw new Error(`${name}: ${value} is not an opaque hsl() color`);
    return hsl.slice(1).map(Number);
}

function luminance([h, s, l]) {
    const sat = s / 100;
    const light = l / 100;
    const k = (n) => (n + h / 30) % 12;
    const a = sat * Math.min(light, 1 - light);
    const channel = (n) => light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear(channel(0)) + 0.7152 * linear(channel(8)) + 0.0722 * linear(channel(4));
}

function ratio(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

const shared = [`brand.css`, `slots.css`];
const brand = declarations(`brand.css`);
const themes = readdirSync(themeDir).filter((file) => file.endsWith(`.css`) && !shared.includes(file));
const misses = [];
for (const file of themes) {
    const tokens = new Map([...brand, ...declarations(file)]);
    for (const [label, fg, bg, minimum] of pairs) {
        const value = ratio(resolve(tokens, fg), resolve(tokens, bg));
        if (value < minimum) {
            misses.push(`${file}: ${label} is ${value.toFixed(2)}, needs ${String(minimum)}`);
        }
    }
}

if (misses.length > 0) {
    console.error(`contrast below WCAG AA:`);
    for (const miss of misses) console.error(miss);
    process.exit(1);
}
