import { describe, expect, it } from 'vitest';
import {
    botTokenPattern,
    isReservedName,
    nameKeyOf,
    nameSyntaxSchema,
    reservedNames,
} from '../src';

describe('name syntax', () => {
    it.each([
        [`ab`, true],
        [`a-b`, true],
        [`a_b`, true],
        [`Ab`, true],
        [`aB9`, true],
        [`a${`b_`.repeat(14)}c`, true],
        [`a`, false],
        [`1ab`, false],
        [`ab_`, false],
        [`ab-`, false],
        [`_ab`, false],
        [`-ab`, false],
        [`a b`, false],
        [`a.b`, false],
        [`ab$`, false],
        [``, false],
        [`ab`.repeat(16), false],
        [`\u00e4b`, false],
    ])(`%j is %j under the name rules`, (name, valid) => {
        expect(nameSyntaxSchema.safeParse(name).success).toBe(valid);
    });
});

describe('reserved names', () => {
    it.each(reservedNames)(`%s is reserved in any case fold`, (name) => {
        expect(isReservedName(name.toUpperCase())).toBe(true);
        expect(isReservedName(nameKeyOf(name))).toBe(true);
    });

    it.each([
        `admins`,
        `administrator-1`,
        `hexarena-bot`,
        `roots`,
        `hexoo`,
        `deleted-player`,
    ])('%s is not reserved', (name) => {
        expect(isReservedName(name)).toBe(false);
    });
});

describe('name fold', () => {
    it('folds case so Ada and ada share one name key', () => {
        expect(nameKeyOf(`Ada`)).toBe(nameKeyOf(`ada`));
    });
});

describe('bot token pattern', () => {
    it.each([
        [`hxo_` + `a`.repeat(43), true],
        [`hxo_` + `a`.repeat(42), false],
        [`xho_` + `a`.repeat(43), false],
        [`hxo_` + `a`.repeat(43) + `!`, false],
    ])('%j is %j as a token', (token, valid) => {
        expect(botTokenPattern.test(token)).toBe(valid);
    });
});
