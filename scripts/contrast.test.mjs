import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { declarations, describePass, glared, measure, measureStep, pairs, parseColor, ratio, resolve, steps } from './contrast.mjs';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.01, `${actual} is not ${expected}`);

describe(`parseColor`, () => {
    it(`reads long and short hex as the same color`, () => {
        assert.deepEqual(parseColor(`#ffcc00`), parseColor(`#fc0`));
        assert.deepEqual(parseColor(`#FFCC00`), { rgb: [1, 0.8, 0], alpha: 1 });
    });

    it(`reads the alpha digit pair of eight and four digit hex`, () => {
        close(parseColor(`#00000080`).alpha, 0.5);
        close(parseColor(`#0008`).alpha, 0.53);
    });

    it(`reads hsl with and without alpha`, () => {
        assert.deepEqual(parseColor(`hsl(0 0% 100%)`), { rgb: [1, 1, 1], alpha: 1 });
        close(parseColor(`hsl(0 0% 0% / 40%)`).alpha, 0.4);
        close(parseColor(`hsl(0 0% 0% / 0.4)`).alpha, 0.4);
    });

    it(`gives hex and hsl of one color the same channels`, () => {
        const [hex, hsl] = [parseColor(`#ff0000`).rgb, parseColor(`hsl(0 100% 50%)`).rgb];
        hex.forEach((channel, i) => close(channel, hsl[i]));
    });

    it(`treats transparent as no color at all`, () => {
        assert.equal(parseColor(`transparent`), null);
    });

    it(`refuses anything else`, () => {
        assert.throws(() => parseColor(`#12345`));
        assert.throws(() => parseColor(`rgb(0 0 0)`));
        assert.throws(() => parseColor(`red`));
    });
});

describe(`ratio`, () => {
    it(`measures black on white at 21`, () => {
        close(ratio(parseColor(`#000`), parseColor(`#fff`)), 21);
    });

    it(`matches the known ratio of mid gray on white`, () => {
        close(ratio(parseColor(`#777777`), parseColor(`#ffffff`)), 4.48);
    });

    it(`composites a translucent foreground onto its background`, () => {
        close(ratio(parseColor(`#00000000`), parseColor(`#fff`)), 1);
        close(ratio(parseColor(`#00000080`), parseColor(`#fff`)), ratio(parseColor(`#7f7f7f`), parseColor(`#fff`)));
    });

    it(`refuses a translucent background`, () => {
        assert.throws(() => ratio(parseColor(`#000`), parseColor(`#ffffff80`)));
    });
});

describe(`resolve`, () => {
    it(`follows var aliases to a color`, () => {
        const tokens = declarations(`--a: var(--b); --b: #fff;`);
        assert.deepEqual(resolve(tokens, `--a`), { rgb: [1, 1, 1], alpha: 1 });
    });

    it(`returns null for a transparent token`, () => {
        assert.equal(resolve(declarations(`--mark: transparent;`), `--mark`), null);
    });

    it(`names the token whose value it cannot read`, () => {
        assert.throws(() => resolve(declarations(`--c-bg: nope;`), `--c-bg`), /--c-bg/);
    });
});

// Fixture themes: an orange and a sky stone of near equal lightness, and a
// white stone on a pale wood cell; neither separates by fill alone.
const slots = `--stone-rim: transparent; --stone-rim-w: 0; --stone-mark-x: transparent; --stone-mark-o: transparent; --stone-shine-x: transparent; --stone-shine-o: transparent; --stone-shine-opacity: 0;`;
const huePair = `--board-cell: #101211; --board-stone-x: #f08a3c; --board-stone-o: #3fb6d9;`;
const paleWood = `--board-cell: #cda577; --board-stone-x: #f3f3f3; --board-stone-o: #141414;`;

function check(label, ...sheets) {
    const pair = pairs.find((entry) => entry[0] === label);
    return measure(new Map(sheets.flatMap((sheet) => [...declarations(sheet)])), pair);
}

describe(`measure`, () => {
    it(`fails stone x against o when the fills are close and no mark is set`, () => {
        assert.equal(check(`stone x against o`, slots, huePair).passedBy, null);
    });

    it(`passes stone x against o by a mark that stands out from its stone`, () => {
        const result = check(`stone x against o`, slots, huePair, `--stone-mark-x: #0d0f0e;`);
        assert.equal(result.passedBy, `x mark`);
    });

    it(`still fails when the mark is as faint as the fills`, () => {
        assert.equal(check(`stone x against o`, slots, huePair, `--stone-mark-o: #3fb0d0;`).passedBy, null);
    });

    it(`passes stone x against o by fill before looking at marks`, () => {
        assert.equal(check(`stone x against o`, slots, paleWood, `--stone-mark-x: #0d0f0e;`).passedBy, `fill`);
    });

    it(`fails a stone that sits close to its cell without a rim`, () => {
        assert.equal(check(`stone x on cell`, slots, paleWood).passedBy, null);
    });

    it(`passes that stone by a rim that stands out from the cell`, () => {
        const rimmed = `--stone-rim: #141414; --stone-rim-w: 1px;`;
        assert.equal(check(`stone x on cell`, slots, paleWood, rimmed).passedBy, `rim`);
    });

    it(`ignores a rim color drawn at zero width`, () => {
        assert.equal(check(`stone x on cell`, slots, paleWood, `--stone-rim: #141414;`).passedBy, null);
    });

    it(`passes the win line across a stone by the casing when the line alone is faint on it`, () => {
        const result = check(`win line across x`, `--board-win: #f7c23b; --board-win-casing: #0d121b; --board-stone-x: #efeae1;`);
        assert.equal(result.passedBy, `casing`);
        close(result.paths[0].value, 1.38);
    });

    it(`passes the win line across a stone by fill when it stands out on its own`, () => {
        const result = check(`win line across x`, `--board-win: #8b1e1e; --board-win-casing: #f3f3f3; --board-stone-x: #f3f3f3;`);
        assert.equal(result.passedBy, `fill`);
    });

    it(`fails the win line across a stone when neither the line nor the casing stands out from it`, () => {
        const result = check(`win line across o`, `--board-win: #ec6fb1; --board-win-casing: #3fb6d9; --board-stone-o: #38bdf8;`);
        assert.equal(result.passedBy, null);
    });

    it(`reports a transparent fill as a miss rather than a ratio`, () => {
        const result = check(`win line on cell`, `--board-win: transparent; --board-cell: #000;`);
        assert.equal(result.passedBy, null);
        assert.equal(result.paths[0].value, null);
    });
});

describe(`text on the active and board grounds`, () => {
    it(`fails dim text a shade short of the text minimum on the active ground`, () => {
        const result = check(`dim on active`, `--c-text-dim: #8b8f88; --c-bg-active: #272d2b;`);
        close(result.paths[0].value, 4.26);
        assert.equal(result.passedBy, null);
    });

    it(`fails a brass link on a pale wood board ground`, () => {
        const result = check(`link on board`, `--board-link: hsl(43 92% 60%); --board-bg: #b58c5e;`);
        assert.equal(result.minimum, 4.5);
        assert.equal(result.passedBy, null);
    });

    it(`passes a link in the black stone's ink on that wood`, () => {
        assert.equal(check(`link on board`, `--board-link: #141414; --board-bg: #b58c5e;`).passedBy, `fill`);
    });
});

describe(`glare`, () => {
    const dark = `--board-stone-o: #141414; --board-number-o: #f3f3f3; --stone-shine-o: #ffffff;`;

    it(`composites the shine onto the stone at the layer's strength and the shine's own alpha`, () => {
        const tokens = declarations(`${dark} --stone-shine-opacity: 0.5;`);
        close(glared(tokens, `--board-stone-o`, `--stone-shine-o`).rgb[0], (0x14 / 255) * 0.5 + 0.5);
        const faint = declarations(`--board-stone-o: #000000; --stone-shine-o: #ffffff80; --stone-shine-opacity: 0.5;`);
        close(glared(faint, `--board-stone-o`, `--stone-shine-o`).rgb[0], 0.25);
    });

    it(`leaves the stone as it is when the glare is off`, () => {
        const tokens = declarations(`${dark} --stone-shine-opacity: 0;`);
        assert.deepEqual(glared(tokens, `--board-stone-o`, `--stone-shine-o`), parseColor(`#141414`));
    });

    it(`fails a light number on a dark stone that a bright glare washes out`, () => {
        assert.equal(check(`number on o in glare`, `${dark} --stone-shine-opacity: 0.8;`).passedBy, null);
        assert.equal(check(`number on o in glare`, `${dark} --stone-shine-opacity: 0.3;`).passedBy, `fill`);
    });

    it(`counts a mark at the weaker of its flat stone and its stone in glare`, () => {
        const light = `--stone-mark-x: #fbfbfb; --stone-shine-x: #ffffff; --stone-shine-opacity: 0.9;`;
        const result = check(`stone x against o`, slots, huePair, light);
        const mark = result.paths.find((path) => path.by === `x mark`);
        assert.ok(mark.value < ratio(parseColor(`#fbfbfb`), parseColor(`#f08a3c`)));
        assert.equal(result.passedBy, null);
    });
});

describe(`describePass`, () => {
    it(`prints a plain pair's ratio against its minimum`, () => {
        const result = check(`win line on cell`, `--board-win: #ffffff; --board-cell: #000000;`);
        assert.equal(describePass(result, 20), `win line on cell      21.00 / 3`);
    });

    it(`names the fill when it carried a pair that has alternatives`, () => {
        assert.equal(describePass(check(`stone x against o`, slots, paleWood)), `stone x against o  16.60 / 3  by fill`);
    });

    it(`names the path that carried a pair and the fill it stood in for`, () => {
        const result = check(`stone x against o`, slots, huePair, `--stone-mark-x: #0d0f0e;`);
        assert.match(describePass(result), /^stone x against o {2}\d+\.\d{2} \/ 3 {2}by x mark, fill 1\.06$/);
    });
});

describe(`measureStep`, () => {
    const step = (label, css) => measureStep(declarations(css), steps.find((entry) => entry[0] === label));

    it(`passes a hover that sits lighter than the overlay it lands on`, () => {
        const result = step(`hover above overlay`, `--c-bg-hover: #202624; --c-bg-overlay: #1b201f;`);
        assert.equal(result.passedBy, `step`);
        assert.ok(result.paths[0].value > 1.05);
    });

    it(`fails a hover that sits darker than its overlay, reading under 1`, () => {
        const result = step(`hover above overlay`, `--c-bg-hover: #181d1b; --c-bg-overlay: #1b201f;`);
        assert.equal(result.passedBy, null);
        assert.ok(result.paths[0].value < 1);
    });

    // A field or a chip in a panel or a sheet sits on the overlay, so a
    // theme that draws input in the overlay's own color hides it there.
    it(`fails a field drawn in the overlay's own color`, () => {
        const result = step(`input above overlay`, `--c-bg-input: #1e293b; --c-bg-overlay: #1e293b;`);
        assert.equal(result.passedBy, null);
        close(result.paths[0].value, 1);
    });

    it(`holds a field a step above the overlay`, () => {
        assert.equal(steps.find((entry) => entry[0] === `input above overlay`)?.[3], 1.05);
        assert.equal(step(`input above overlay`, `--c-bg-input: #263349; --c-bg-overlay: #1e293b;`).passedBy, `step`);
    });
});

describe(`the mark`, () => {
    // The mark wears the default look's board in every theme, so only its
    // brass frame meets each theme's page, at rest and hovered.
    it(`is gated on the page at rest and hovered`, () => {
        const against = (fg) => pairs.find(([, pairFg, bg]) => pairFg === fg && bg === `--c-bg`);
        assert.equal(against(`--c-accent-solid`)?.[3], 3);
        assert.equal(against(`--c-accent-solid-hover`)?.[3], 3);
    });
});
