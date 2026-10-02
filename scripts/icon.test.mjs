import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { inflateSync } from 'node:zlib';
import { declarations, parseColor, ratio, resolve } from './contrast.mjs';

// The static icons are a frozen copy of the mark in the default look:
// Ink's board ground and cell, its x and o stones, and the brand's solid
// accent. A change to any of them fails here until the svgs are drawn
// again, and to the rasters' colors until the rasters are too.
const themeDir = `apps/web/src/styles/themes`;
const read = (file) => declarations(readFileSync(join(themeDir, file), `utf8`));
const tokens = new Map([...read(`brand.css`), ...read(`slots.css`), ...read(`ink.css`)]);
const favicon = `apps/web/public/favicon.svg`;
const touch = `apps/web/brand/touch.svg`;

// Whole 8-bit channels, the precision a hex color in a file holds.
const bytes = (color) => color.rgb.map((channel) => Math.round(channel * 255));
const token = (name) => bytes(resolve(tokens, name));

// Every fill in drawing order, the strokes, and how many paints the file holds.
function paintOf(svg) {
    const fills = [...svg.matchAll(/fill="(#[0-9a-f]{6})"/gi)].map((match) => bytes(parseColor(match[1])));
    const strokes = [...svg.matchAll(/stroke="(#[0-9a-f]{6})"/gi)].map((match) => bytes(parseColor(match[1])));
    const paints = [...svg.matchAll(/(?:fill|stroke|style)="/g)].length;
    return { fills, strokes, paints };
}

// The path data of every path, in drawing order.
const pathsOf = (source) => [...source.matchAll(/ d="([^"]+)"/g)].map((match) => match[1]);

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
    it(`the favicon paints Ink's cell, its x and o stones, and the brand accent on the frame, and nothing else`, () => {
        const paint = paintOf(readFileSync(favicon, `utf8`));
        assert.deepEqual(paint.fills, [token(`--board-cell`), token(`--board-stone-x`), token(`--board-stone-o`)]);
        assert.deepEqual(paint.strokes, [token(`--c-accent-solid`)]);
        assert.equal(paint.paints, 4);
    });

    // A touch icon cannot be clear, so the favicon stands on Ink's board ground.
    it(`the touch icon is the favicon on a square of Ink's board ground`, () => {
        const paint = paintOf(readFileSync(touch, `utf8`));
        assert.deepEqual(paint.fills, [token(`--board-bg`), token(`--board-cell`), token(`--board-stone-x`), token(`--board-stone-o`)]);
        assert.deepEqual(paint.strokes, [token(`--c-accent-solid`)]);
        assert.deepEqual(pathsOf(readFileSync(touch, `utf8`)), pathsOf(readFileSync(favicon, `utf8`)));
    });

    it(`holds its stones and its frame at 3:1 or better on the cell`, () => {
        const cell = resolve(tokens, `--board-cell`);
        for (const name of [`--board-stone-x`, `--board-stone-o`, `--c-accent-solid`]) assert.ok(ratio(resolve(tokens, name), cell) >= 3, name);
    });

    // The favicon draws the mark's stones, so the tab and the bar show one drawing;
    // its frame is heavier, to read at 16 px.
    it(`draws the same stones as the mark in the bar`, () => {
        const mark = pathsOf(readFileSync(`apps/web/src/components/Mark.tsx`, `utf8`));
        assert.deepEqual(pathsOf(readFileSync(favicon, `utf8`)).slice(1), mark.slice(1));
    });

    // The x stone stands at (16, 11) of 32 units, an o stone at (12, 18),
    // and the cell is bare at (16, 27), so every raster shows the three there.
    it(`every raster shows Ink's x and o stones and its cell where the svgs put them`, () => {
        const rasters = [
            pngPixels(`apps/web/public/icon-512.png`),
            pngPixels(`apps/web/public/apple-touch-icon.png`),
            ...icoFrames(`apps/web/public/favicon.ico`),
        ];
        for (const raster of rasters) {
            const unit = raster.size / 32;
            const at = (x, y) => raster.at(Math.floor(x * unit), Math.floor(y * unit));
            assert.deepEqual(at(16, 11), token(`--board-stone-x`), `x stone at ${String(raster.size)} px`);
            assert.deepEqual(at(12, 18), token(`--board-stone-o`), `o stone at ${String(raster.size)} px`);
            assert.deepEqual(at(16, 27), token(`--board-cell`), `cell at ${String(raster.size)} px`);
        }
    });

    it(`the touch icon fills its corners with Ink's board ground, where the favicon is clear`, () => {
        assert.deepEqual(pngPixels(`apps/web/public/apple-touch-icon.png`).at(2, 2), token(`--board-bg`));
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
