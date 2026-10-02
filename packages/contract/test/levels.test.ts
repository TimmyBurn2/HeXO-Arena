import { describe, expect, it } from 'vitest';
import {
    accountDeclarationSchema,
    budgetFacts,
    createGameRequestSchema,
    gamePlayerSchema,
    levelFacts,
    levelsSchema,
    nameAtLevel,
    seatLevelOf,
} from '../src';

// The two declarations the Bot API readme shows.
const alphaBeta = {
    default: `standard`,
    list: [
        { id: `quick`, label: `quick`, budget: { timeMs: 200 } },
        { id: `standard`, label: `standard`, budget: { nodes: 1_000_000 } },
        { id: `deep`, label: `deep`, budget: { depthTurns: 8 } },
    ],
};
const neuralMcts = {
    default: `800`,
    list: [
        { id: `100`, label: `100 sims`, budget: { playouts: 100 } },
        { id: `800`, label: `800 sims`, budget: { playouts: 800 } },
        { id: `6400`, label: `6400 sims`, budget: { playouts: 6400, timeMs: 5000 } },
    ],
};

const level = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: id, ...extra });
const two = (first: Record<string, unknown>) => ({ default: `b`, list: [first, level(`b`)] });

describe('levelsSchema', () => {
    it('accepts the alpha-beta and the neural declarations as written', () => {
        expect(levelsSchema.parse(alphaBeta)).toEqual(alphaBeta);
        expect(levelsSchema.parse(neuralMcts)).toEqual(neuralMcts);
    });

    it('takes 2 to 8 levels, each id unique, the default among them', () => {
        const ids = [`a`, `b`, `c`, `d`, `e`, `f`, `g`, `h`, `i`];
        const of = (count: number) => ({ default: `a`, list: ids.slice(0, count).map((id) => level(id)) });
        expect(levelsSchema.safeParse(of(1)).success).toBe(false);
        expect(levelsSchema.safeParse(of(2)).success).toBe(true);
        expect(levelsSchema.safeParse(of(8)).success).toBe(true);
        expect(levelsSchema.safeParse(of(9)).success).toBe(false);
        expect(levelsSchema.safeParse({ default: `a`, list: [level(`a`), level(`a`)] }).success).toBe(false);
        expect(levelsSchema.safeParse({ default: `z`, list: [level(`a`), level(`b`)] }).success).toBe(false);
    });

    it('holds ids to lowercase letters, digits, and hyphens, 16 at most', () => {
        for (const id of [`a`, `quick-2`, `6400`, `a`.repeat(16)]) expect(levelsSchema.safeParse(two(level(id))).success, id).toBe(true);
        for (const id of [``, `Quick`, `a_b`, `a b`, `a`.repeat(17)]) expect(levelsSchema.safeParse(two(level(id))).success, id).toBe(false);
    });

    it('holds labels to 24 printable ASCII characters that start and end visible', () => {
        const labeled = (label: string) => two({ id: `a`, label });
        for (const label of [`q`, `100 sims`, `a`.repeat(24), `x @ y!`]) expect(levelsSchema.safeParse(labeled(label)).success, label).toBe(true);
        for (const label of [``, ` quick`, `quick `, `a`.repeat(25), `qu\u0007ick`, `\u202equick`, `sch\u00e4rfer`, `tab\there`]) {
            expect(levelsSchema.safeParse(labeled(label)).success, JSON.stringify(label)).toBe(false);
        }
    });

    it('cleans about and note as a declaration\'s about, bounding them at 120 and 80 once cleaned', () => {
        const first = (levels: unknown) => levelsSchema.parse(levels).list[0];
        expect(levelsSchema.safeParse(two(level(`a`, { about: `a`.repeat(120), note: `n`.repeat(80) }))).success).toBe(true);
        expect(levelsSchema.safeParse(two(level(`a`, { about: `a`.repeat(121) }))).success).toBe(false);
        expect(levelsSchema.safeParse(two(level(`a`, { note: `n`.repeat(81) }))).success).toBe(false);
        expect(first(two(level(`a`, { note: `policy\u202e net\u200b` })))?.note).toBe(`policy net`);
        expect(first(two(level(`a`, { about: `line\nbreak`, note: `n`.repeat(80) + `\u00ad` })))).toEqual({ id: `a`, label: `a`, about: `line break`, note: `n`.repeat(80) });
        expect(first(two(level(`a`, { note: `Politik-Netz, \u00e9l\u00e8ve` })))?.note).toBe(`Politik-Netz, \u00e9l\u00e8ve`);
        expect(first(two(level(`a`, { about: ` \n\u200f`, note: `` })))).toEqual({ id: `a`, label: `a` });
    });

    it('takes the four budget keys within their bounds, at least one when a budget is present', () => {
        const budgeted = (budget: unknown) => two(level(`a`, { budget }));
        expect(levelsSchema.safeParse(budgeted({ timeMs: 600_000, nodes: 1e12, depthTurns: 64, playouts: 1e9 })).success).toBe(true);
        expect(levelsSchema.safeParse(budgeted({ timeMs: 1, nodes: 1, depthTurns: 1, playouts: 1 })).success).toBe(true);
        for (const budget of [{}, { timeMs: 0 }, { timeMs: 600_001 }, { nodes: 1e12 + 1 }, { depthTurns: 65 }, { playouts: 1e9 + 1 }, { timeMs: 1.5 }, { movetimeMs: 200 }]) {
            expect(levelsSchema.safeParse(budgeted(budget)).success, JSON.stringify(budget)).toBe(false);
        }
    });

    it('refuses an unknown key on a level or on the declaration of levels', () => {
        expect(levelsSchema.safeParse(two(level(`a`, { rated: true }))).success).toBe(false);
        expect(levelsSchema.safeParse({ ...two(level(`a`)), ranked: [`a`] }).success).toBe(false);
    });
});

describe('accountDeclarationSchema', () => {
    it('declares levels, or clears them with null', () => {
        expect(accountDeclarationSchema.parse({ levels: alphaBeta }).levels).toEqual(alphaBeta);
        expect(accountDeclarationSchema.parse({ levels: null }).levels).toBeNull();
        expect(accountDeclarationSchema.parse({}).levels).toBeUndefined();
    });
});

describe('createGameRequestSchema', () => {
    it('names a level by its id, or none for the default', () => {
        const request = { bot: `hextide`, timeControl: { mode: `unlimited` } };
        expect(createGameRequestSchema.parse({ ...request, level: `quick` }).level).toBe(`quick`);
        expect(createGameRequestSchema.parse(request).level).toBeUndefined();
        expect(createGameRequestSchema.safeParse({ ...request, level: `Quick!` }).success).toBe(false);
    });
});

describe('gamePlayerSchema', () => {
    it('carries a bot seat level without its about', () => {
        const seat = seatLevelOf({ id: `quick`, label: `quick`, about: `fast and loose`, budget: { timeMs: 200 }, note: `no book` });
        expect(seat).toEqual({ id: `quick`, label: `quick`, budget: { timeMs: 200 }, note: `no book` });
        expect(gamePlayerSchema.parse({ name: `hextide`, rating: null, provisional: false, kind: `bot`, level: seat }).level).toEqual(seat);
    });
});

describe('budgetFacts', () => {
    it('words each budget key with its unit, search limits before time', () => {
        expect(budgetFacts({ timeMs: 500 })).toEqual([`0.5 s a turn`]);
        expect(budgetFacts({ nodes: 1_000_000 })).toEqual([`1M nodes`]);
        expect(budgetFacts({ depthTurns: 8 })).toEqual([`depth 8 turns`]);
        expect(budgetFacts({ playouts: 800 })).toEqual([`800 playouts`]);
        expect(budgetFacts({ timeMs: 500, depthTurns: 6 })).toEqual([`depth 6 turns`, `0.5 s a turn`]);
        expect(budgetFacts(undefined)).toEqual([]);
    });

    it('writes counts in figures below ten thousand and compact past it', () => {
        const nodes = (count: number) => budgetFacts({ nodes: count })[0];
        expect(nodes(1)).toBe(`1 node`);
        expect(nodes(6400)).toBe(`6400 nodes`);
        expect(nodes(250_000)).toBe(`250k nodes`);
        expect(nodes(999_999)).toBe(`1M nodes`);
        expect(nodes(1_234_567)).toBe(`1.23M nodes`);
        expect(nodes(2_500_000_000)).toBe(`2.5B nodes`);
        expect(nodes(1e12)).toBe(`1T nodes`);
        expect(budgetFacts({ playouts: 1 })).toEqual([`1 playout`]);
        expect(budgetFacts({ depthTurns: 1 })).toEqual([`depth 1 turn`]);
    });

    it('writes think time in seconds, whole minutes past one', () => {
        const time = (ms: number) => budgetFacts({ timeMs: ms })[0];
        expect(time(200)).toBe(`0.2 s a turn`);
        expect(time(1)).toBe(`0.001 s a turn`);
        expect(time(5000)).toBe(`5 s a turn`);
        expect(time(1500)).toBe(`1.5 s a turn`);
        expect(time(90_000)).toBe(`1 min 30 s a turn`);
        expect(time(600_000)).toBe(`10 min a turn`);
    });
});

describe('levelFacts', () => {
    it('joins the budget facts and the note on one line', () => {
        expect(levelFacts({ budget: { playouts: 6400, timeMs: 5000 } })).toBe(`6400 playouts, 5 s a turn`);
        expect(levelFacts({ note: `policy net only` })).toBe(`policy net only`);
        expect(levelFacts({ budget: { playouts: 1 }, note: `policy net only` })).toBe(`1 playout; policy net only`);
        expect(levelFacts({})).toBe(``);
    });
});

describe('nameAtLevel', () => {
    it('reads the plain name at the default level and name @ label at any other', () => {
        expect(nameAtLevel(`hextide`, undefined)).toBe(`hextide`);
        expect(nameAtLevel(`hextide`, null)).toBe(`hextide`);
        expect(nameAtLevel(`hextide`, { label: `quick` })).toBe(`hextide @ quick`);
    });
});
