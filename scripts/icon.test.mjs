import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { inflateSync } from 'node:zlib';
import { declarations, parseColor, ratio, resolve } from './contrast.mjs';

// The static icons are a frozen copy of three tokens: Ink's board ground
// and x stone, and the brand's solid accent. A change to any of them fails
// here until the svgs are drawn again, and a change to the ground or the
// stone until the rasters are too.
const themeDir = `apps/web/src/styles/themes`;
const read = (file) => declarations(readFileSync(join(themeDir, file), `utf8`));
const tokens = new Map([...read(`brand.css`), ...read(`slots.css`), ...read(`ink.css`)]);
const icons = [`apps/web/public/favicon.svg`, `apps/web/brand/touch.svg`];

// Whole 8-bit channels, the precision a hex color in a file holds.
const bytes = (color) => color.rgb.map((channel) => Math.round(channel * 255));

// The plate is the first fill, the stones the last, the win line the stroke.
function paintOf(svg) {
    const fills = [...svg.matchAll(/fill="(#[0-9a-f]{6})"/gi)].map((match) => match[1]);
    const strokes = [...svg.matchAll(/stroke="(#[0-9a-f]{6})"/gi)].map((match) => match[1]);
    const paints = [...svg.matchAll(/(?:fill|stroke|style)="/g)].length;
    return { plate: fills[0], stone: fills.at(-1), line: strokes[0], count: fills.length + strokes.length, paints };
}

// A PNG states its size in the header chunk that follows its signature.
function pngSize(file) {
    const data = readFileSync(file);
    assert.equal(data.subarray(1, 4).toString(`latin1`), `PNG`);
    return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

// The pixels of an 8-bit, non-interlaced RGB or RGBA PNG, unfiltered row
// by row.
function pngPixels(file) {
    const data = readFileSync(file);
    const [width, height] = pngSize(file);
    assert.equal(data[24], 8);
    assert.equal(data[28], 0);
    const channels = { 2: 3, 6: 4 }[data[25]];
    assert.ok(channels !== undefined);
    const chunks = [];
    for (let at = 8; at < data.length; at += 12 + data.readUInt32BE(at)) {
        if (data.toString(`latin1`, at + 4, at + 8) === `IDAT`) chunks.push(data.subarray(at + 8, at + 8 + data.readUInt32BE(at)));
    }
    const raw = inflateSync(Buffer.concat(chunks));
    const stride = width * channels;
    const out = Buffer.alloc(height * stride);
    for (let y = 0; y < height; y += 1) {
        const filter = raw[y * (stride + 1)];
        for (let i = 0; i < stride; i += 1) {
            const value = raw[y * (stride + 1) + 1 + i];
            const left = i >= channels ? out[y * stride + i - channels] : 0;
            const up = y > 0 ? out[(y - 1) * stride + i] : 0;
            const corner = i >= channels && y > 0 ? out[(y - 1) * stride + i - channels] : 0;
            const guess = left + up - corner;
            const paeth = [left, up, corner].sort((a, b) => Math.abs(guess - a) - Math.abs(guess - b))[0];
            const predictor = [0, left, up, Math.floor((left + up) / 2), paeth][filter];
            out[y * stride + i] = (value + predictor) & 0xff;
        }
    }
    return { size: width, at: (x, y) => [...out.subarray((y * width + x) * channels, (y * width + x) * channels + 3)] };
}

// The ico's frames are 32-bit bitmaps, stored bottom row first.
function icoFrames(file) {
    const data = readFileSync(file);
    return Array.from({ length: data.readUInt16LE(4) }, (_, index) => {
        const size = data[6 + index * 16];
        const start = data.readUInt32LE(6 + index * 16 + 12) + 40;
        return {
            size,
            at: (x, y) => {
                const pixel = start + ((size - 1 - y) * size + x) * 4;
                return [data[pixel + 2], data[pixel + 1], data[pixel]];
            },
        };
    });
}

describe(`the static icons`, () => {
    for (const file of icons) {
        const paint = paintOf(readFileSync(file, `utf8`));

        it(`${file} paints Ink's board ground, Ink's x stone, and the brand accent, and nothing else`, () => {
            assert.equal(paint.count, 3);
            assert.equal(paint.paints, 3);
            assert.deepEqual(bytes(parseColor(paint.plate)), bytes(resolve(tokens, `--board-bg`)));
            assert.deepEqual(bytes(parseColor(paint.stone)), bytes(resolve(tokens, `--board-stone-x`)));
            assert.deepEqual(bytes(parseColor(paint.line)), bytes(resolve(tokens, `--c-accent-solid`)));
        });

        it(`${file} holds its stones and its line at 3:1 or better on the plate`, () => {
            const plate = parseColor(paint.plate);
            assert.ok(ratio(parseColor(paint.stone), plate) >= 3);
            assert.ok(ratio(parseColor(paint.line), plate) >= 3);
        });
    }

    // Both svgs put the middle stone's center at (16, 16) of 32 units and
    // leave the plate bare at (12, 3), so every raster shows the two there.
    it(`every raster shows Ink's board ground on its plate and Ink's x stone in its middle`, () => {
        const rasters = [
            pngPixels(`apps/web/public/icon-512.png`),
            pngPixels(`apps/web/public/apple-touch-icon.png`),
            ...icoFrames(`apps/web/public/favicon.ico`),
        ];
        for (const raster of rasters) {
            const unit = raster.size / 32;
            assert.deepEqual(raster.at(Math.floor(12 * unit), Math.floor(3 * unit)), bytes(resolve(tokens, `--board-bg`)));
            assert.deepEqual(raster.at(Math.floor(16 * unit), Math.floor(16 * unit)), bytes(resolve(tokens, `--board-stone-x`)));
        }
    });

    it(`the ico carries a 16 and a 32 px frame, for browsers without svg icons`, () => {
        const data = readFileSync(`apps/web/public/favicon.ico`);
        assert.deepEqual([data.readUInt16LE(0), data.readUInt16LE(2)], [0, 1]);
        const frames = Array.from({ length: data.readUInt16LE(4) }, (_, index) => data[6 + index * 16]);
        assert.deepEqual(frames.sort((a, b) => a - b), [16, 32]);
    });

    it(`the touch icon is 180 px square and the link preview's 512`, () => {
        assert.deepEqual(pngSize(`apps/web/public/apple-touch-icon.png`), [180, 180]);
        assert.deepEqual(pngSize(`apps/web/public/icon-512.png`), [512, 512]);
    });
});
