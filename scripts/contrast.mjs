// WCAG 2.2 contrast over theme tokens, kept free of file access so the
// gate and its tests share one implementation.

/** Every custom property a sheet declares, by name. */
export function declarations(css) {
    const found = new Map();
    for (const match of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
        found.set(match[1], match[2].trim());
    }
    return found;
}

function hslToRgb(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const k = (n) => (n + h / 30) % 12;
    const channel = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [channel(0), channel(8), channel(4)];
}

function parseAlpha(text) {
    if (text === undefined) return 1;
    return text.endsWith(`%`) ? Number(text.slice(0, -1)) / 100 : Number(text);
}

/**
 * A color as sRGB channels and alpha in 0..1, or null for transparent,
 * which paints nothing and so is no color to measure.
 */
export function parseColor(value) {
    if (value === `transparent`) return null;
    const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
    if (hex !== null) {
        const digits = hex[1];
        const short = digits.length <= 4;
        const pairs = short ? [...digits].map((d) => d + d) : digits.match(/../g);
        const [r, g, b, alpha = 1] = pairs.map((pair) => parseInt(pair, 16) / 255);
        return { rgb: [r, g, b], alpha };
    }
    const hsl = /^hsl\(([\d.]+) ([\d.]+)% ([\d.]+)%(?: \/ ([\d.]+%?))?\)$/.exec(value);
    if (hsl !== null) {
        const [h, s, l] = hsl.slice(1, 4).map(Number);
        return { rgb: hslToRgb(h, s / 100, l / 100), alpha: parseAlpha(hsl[4]) };
    }
    throw new Error(`${value} is not a hex, hsl(), or transparent color`);
}

/** The color a token names after following var() aliases; null if transparent. */
export function resolve(tokens, name, seen = new Set()) {
    const value = tokens.get(name);
    if (value === undefined) throw new Error(`${name} is not defined`);
    const alias = /^var\((--[a-z0-9-]+)\)$/.exec(value);
    if (alias !== null) {
        if (seen.has(name)) throw new Error(`${name} aliases itself`);
        seen.add(name);
        return resolve(tokens, alias[1], seen);
    }
    try {
        return parseColor(value);
    } catch (error) {
        throw new Error(`${name}: ${error.message}`, { cause: error });
    }
}

function luminance([r, g, b]) {
    const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/**
 * A stone under the brightest point of its glare: the shine color
 * composited onto the stone at the shine layer's strength.
 * A glare that paints nothing leaves the stone as it is.
 */
export function glared(tokens, stone, shine) {
    const body = resolve(tokens, stone);
    const light = resolve(tokens, shine);
    const strength = Number.parseFloat(tokens.get(`--stone-shine-opacity`) ?? `0`);
    if (body === null || light === null || !(strength > 0)) return body;
    const alpha = light.alpha * Math.min(strength, 1);
    return { rgb: light.rgb.map((c, i) => c * alpha + body.rgb[i] * (1 - alpha)), alpha: 1 };
}

/**
 * The contrast of a foreground over a background; a translucent
 * foreground is measured as it paints, composited onto the background.
 * A translucent background has no known backdrop, so it is refused.
 */
export function ratio(fg, bg) {
    if (bg.alpha < 1) throw new Error(`a background must be opaque`);
    const painted = fg.rgb.map((c, i) => c * fg.alpha + bg.rgb[i] * (1 - fg.alpha));
    const [hi, lo] = [luminance(painted), luminance(bg.rgb)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

// A background is a token, or a stone under its glare's brightest point.
const glaredX = { stone: `--board-stone-x`, shine: `--stone-shine-x` };
const glaredO = { stone: `--board-stone-o`, shine: `--stone-shine-o` };

// A stone that sits close to its cell can separate by an outline, and
// two stones close to each other by the inset mark on either side, so
// those pairs also pass when the effect itself reaches the threshold.
// A mark runs through the glare and past it, so it counts at the weaker
// of the two.
const rim = { by: `rim`, fg: `--stone-rim`, bg: `--board-cell`, width: `--stone-rim-w` };
const xMark = { by: `x mark`, fg: `--stone-mark-x`, bg: `--board-stone-x`, under: glaredX };
const oMark = { by: `o mark`, fg: `--stone-mark-o`, bg: `--board-stone-o`, under: glaredO };
// Where the win line crosses a stone, its casing runs between them: the
// line reads across that stone by its own contrast with it, or inside a
// casing that stands out from it, the line on the casing checked apart.
const xCasing = { by: `casing`, fg: `--board-win-casing`, bg: `--board-stone-x` };
const oCasing = { by: `casing`, fg: `--board-win-casing`, bg: `--board-stone-o` };

/**
 * Every pair every theme must meet, written against the vocabulary and
 * never a theme; thresholds are never rounded: 4.5 for text, 3 for
 * graphics, large text, and bold stone numbers.
 */
export const pairs = [
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
    [`text on discord`, `--c-on-discord`, `--c-discord`, 4.5],
    [`text on discord hover`, `--c-on-discord`, `--c-discord-hover`, 4.5],
    [`focus on base`, `--c-focus`, `--c-bg`, 3],
    [`focus on overlay`, `--c-focus`, `--c-bg-overlay`, 3],
    [`accent solid on base`, `--c-accent-solid`, `--c-bg`, 3],
    // The mark's brass frame meets the page and brightens under the pointer.
    [`accent solid hover on base`, `--c-accent-solid-hover`, `--c-bg`, 3],
    [`accent solid on raised`, `--c-accent-solid`, `--c-bg-raised`, 3],
    [`accent solid on overlay`, `--c-accent-solid`, `--c-bg-overlay`, 3],
    [`good solid on base`, `--c-good-solid`, `--c-bg`, 3],
    [`bad solid on base`, `--c-bad-solid`, `--c-bg`, 3],
    [`discord on base`, `--c-discord`, `--c-bg`, 3],
    [`discord on raised`, `--c-discord`, `--c-bg-raised`, 3],
    [`discord on overlay`, `--c-discord`, `--c-bg-overlay`, 3],
    [`youtube on raised`, `--c-youtube`, `--c-bg-raised`, 3],
    [`youtube play on red`, `--c-on-youtube`, `--c-youtube`, 3],
    [`github on base`, `--c-github`, `--c-bg`, 3],
    [`github on raised`, `--c-github`, `--c-bg-raised`, 3],
    [`online on base`, `--c-online`, `--c-bg`, 3],
    [`offline on raised`, `--c-offline`, `--c-bg-raised`, 3],
    [`offline on hover`, `--c-offline`, `--c-bg-hover`, 3],
    [`offline on overlay`, `--c-offline`, `--c-bg-overlay`, 3],
    [`frontier on cell`, `--board-frontier`, `--board-cell`, 3],
    [`frontier on board`, `--board-frontier`, `--board-bg`, 3],
    [`stone x on cell`, `--board-stone-x`, `--board-cell`, 3, rim],
    [`stone o on cell`, `--board-stone-o`, `--board-cell`, 3, rim],
    [`stone x against o`, `--board-stone-x`, `--board-stone-o`, 3, xMark, oMark],
    [`pending on cell`, `--board-pending`, `--board-cell`, 3],
    [`last move on cell`, `--board-last`, `--board-cell`, 3],
    [`win line on cell`, `--board-win`, `--board-cell`, 3],
    [`win line on casing`, `--board-win`, `--board-win-casing`, 3],
    [`win line across x`, `--board-win`, `--board-stone-x`, 3, xCasing],
    [`win line across o`, `--board-win`, `--board-stone-o`, 3, oCasing],
    [`focus on cell`, `--board-focus`, `--board-cell`, 3],
    [`number on x`, `--board-number-x`, `--board-stone-x`, 3],
    [`number on o`, `--board-number-o`, `--board-stone-o`, 3],
    [`number on x in glare`, `--board-number-x`, glaredX, 3],
    [`number on o in glare`, `--board-number-o`, glaredO, 3],
];

function effectWidth(tokens, name) {
    const value = tokens.get(name);
    if (value === undefined) throw new Error(`${name} is not defined`);
    const width = Number.parseFloat(value);
    if (Number.isNaN(width)) throw new Error(`${name}: ${value} is not a width`);
    return width;
}

function measureOne(tokens, fg, bg) {
    const fgColor = resolve(tokens, fg);
    const bgColor = typeof bg === `string` ? resolve(tokens, bg) : glared(tokens, bg.stone, bg.shine);
    return fgColor === null || bgColor === null ? null : ratio(fgColor, bgColor);
}

/**
 * One pair in one theme: the ratio by fill, then each alternative that
 * the theme turns on, and the first path that meets the threshold.
 * A transparent color, or an effect at zero width, is no path at all.
 */
export function measure(tokens, [label, fg, bg, minimum, ...alternatives]) {
    const paths = [{ by: `fill`, value: measureOne(tokens, fg, bg) }];
    for (const alternative of alternatives) {
        if (alternative.width !== undefined && effectWidth(tokens, alternative.width) === 0) continue;
        const flat = measureOne(tokens, alternative.fg, alternative.bg);
        const value = flat === null || alternative.under === undefined ? flat : Math.min(flat, measureOne(tokens, alternative.fg, alternative.under));
        if (value !== null) paths.push({ by: alternative.by, value });
    }
    const passed = paths.find((path) => path.value !== null && path.value >= minimum);
    return { label, minimum, paths, passedBy: passed?.by ?? null, alternatives: alternatives.length };
}

/** A measured path as the gate prints it. */
export function describePath({ by, value }) {
    return value === null ? `${by} transparent` : `${by} ${value.toFixed(2)}`;
}

/**
 * A passing pair as the gate prints it: the ratio that carried it against
 * its minimum, and for a pair with alternatives, the path that carried it
 * and the fill it stood in for.
 */
export function describePass(result, width = 0) {
    const carried = result.paths.find((path) => path.by === result.passedBy);
    const line = `${result.label.padEnd(width)}  ${carried.value.toFixed(2)} / ${String(result.minimum)}`;
    if (result.alternatives === 0) return line;
    if (result.passedBy === `fill`) return `${line}  by fill`;
    return `${line}  by ${result.passedBy}, ${describePath(result.paths[0])}`;
}

/**
 * Surfaces that must sit lighter than the ones beneath them, so a hover,
 * a pressed state, or a field shows on every surface it lands on.
 * No WCAG minimum applies: a state change needs the smallest step the
 * shipped themes read by, a field more, since it has no border.
 */
export const steps = [
    [`hover above raised`, `--c-bg-hover`, `--c-bg-raised`, 1.05],
    [`hover above overlay`, `--c-bg-hover`, `--c-bg-overlay`, 1.05],
    [`active above hover`, `--c-bg-active`, `--c-bg-hover`, 1.05],
    [`input above base`, `--c-bg-input`, `--c-bg`, 1.1],
    // Fields and chips also sit in panels and sheets, on the overlay.
    [`input above overlay`, `--c-bg-input`, `--c-bg-overlay`, 1.05],
];

/**
 * One step in one theme, as a result the gate prints like a pair: the
 * upper surface's luminance over the lower's, under 1 when it sits darker.
 */
export function measureStep(tokens, [label, upper, lower, minimum]) {
    const [top, bottom] = [resolve(tokens, upper), resolve(tokens, lower)];
    if (top === null || bottom === null) throw new Error(`${label}: a surface cannot be transparent`);
    const value = (luminance(top.rgb) + 0.05) / (luminance(bottom.rgb) + 0.05);
    return { label, minimum, paths: [{ by: `step`, value }], passedBy: value >= minimum ? `step` : null, alternatives: 0 };
}
