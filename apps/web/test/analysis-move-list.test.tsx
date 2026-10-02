// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TurnCells } from '@hexo-arena/rules';
import { bandOf, lineTokens } from '../src/analysis/move-list';
import { MoveList } from '../src/analysis/MoveList';
import { newTree, play, rootId, type MoveTree, type NodeId } from '../src/analysis/tree';

afterEach(cleanup);

function pair(ax: number, ay: number, bx: number, by: number): TurnCells {
    return [
        { x: ax, y: ay },
        { x: bx, y: by },
    ];
}

// The main line m1 to m4; at turn 2 two variations, a2 to a4 and d2 alone.
// Inside a2's line, turn 3 has an alternative b3 to b4, which holds one of its own at turn 4, c4.
function branched() {
    let tree: MoveTree = newTree({ kind: `origin` });
    const ids: Record<string, NodeId> = {};
    const add = (name: string, from: NodeId, cells: TurnCells) => {
        const played = play(tree, from, cells);
        if (!played.ok) throw new Error(`refused ${name}: ${JSON.stringify(played.refusal)}`);
        tree = played.tree;
        ids[name] = played.node;
        return played.node;
    };
    const m1 = add(`m1`, rootId, pair(1, 0, 0, 1));
    const m2 = add(`m2`, m1, pair(-1, 0, 0, -1));
    const m3 = add(`m3`, m2, pair(2, 0, 3, 0));
    add(`m4`, m3, pair(-2, 0, -3, 0));
    const a2 = add(`a2`, m1, pair(1, 1, 2, 1));
    const a3 = add(`a3`, a2, pair(-1, 1, -2, 2));
    const b3 = add(`b3`, a2, pair(1, -1, 2, -2));
    add(`b4`, b3, pair(3, -3, 4, -4));
    add(`c4`, b3, pair(0, 2, 0, 3));
    add(`a4`, a3, pair(-1, -1, -2, -2));
    add(`d2`, m1, pair(0, -2, 1, -2));
    return { tree, ids };
}

function name(ids: Record<string, NodeId>, id: NodeId): string {
    return Object.entries(ids).find(([, each]) => each === id)?.[0] ?? `?`;
}

describe('the variations a move list shows under a main-line turn', () => {
    it('make one paragraph per alternative, each alternative inside one in parentheses right after the turn it replaces', () => {
        const { tree, ids } = branched();
        const band = bandOf(tree, ids.m2 ?? rootId);
        expect(band.map((tokens) => tokens.map((token) => `${`(`.repeat(token.open)}${name(ids, token.id)}${`)`.repeat(token.close)}`).join(` `))).toEqual([
            `a2 a3 (b3 b4 (c4)) a4`,
            `d2`,
        ]);
        expect(lineTokens(tree, ids.a2 ?? rootId, false).map((token) => token.nested)).toEqual([false, false, true, true, true, false]);
    });

    it('show no band under a turn played alone, nor under a variation\'s own first turn', () => {
        const { tree, ids } = branched();
        expect(bandOf(tree, ids.m1 ?? rootId)).toEqual([]);
        expect(bandOf(tree, ids.m3 ?? rootId)).toEqual([]);
        expect(bandOf(tree, ids.a2 ?? rootId)).toEqual([]);
    });

    it('render the main line as rows and the band as tokens with their numbers and cells, the parentheses held to them', () => {
        const { tree, ids } = branched();
        const { container } = render(
            <MoveList tree={tree} gameTurns={[]} at={ids.c4 ?? rootId} onGo={() => undefined} actions={{ promote: () => undefined, remove: () => undefined, copy: () => undefined }} facts={new Map()} />,
        );
        expect([...container.querySelectorAll(`.an-row .an-row-n`)].map((each) => each.textContent)).toEqual([`1`, `2`, `3`, `4`]);
        const paragraphs = [...container.querySelectorAll(`.an-band .an-band-line`)].map((line) =>
            [...line.querySelectorAll(`.an-tok`)].map((token) => {
                const parens = [...token.querySelectorAll(`.an-paren`)].map((each) => each.textContent);
                const open = parens.find((each) => each.startsWith(`(`)) ?? ``;
                const close = parens.find((each) => each.startsWith(`)`)) ?? ``;
                return `${open}${token.querySelector(`.an-tok-n`)?.textContent ?? ``} ${token.querySelector(`.an-turn-cells`)?.textContent ?? ``}${close}`;
            }),
        );
        expect(paragraphs).toEqual([
            [`2 [2,-1] [3,-1]`, `3 [0,-1] [0,-2]`, `(3 [0,1] [0,2]`, `4 [0,3] [0,4]`, `(4 [2,-2] [3,-3]))`, `4 [-2,1] [-4,2]`],
            [`2 [-2,2] [-1,2]`],
        ]);
        // The band sits right under the main-line turn it replaces.
        expect(container.querySelector(`.an-row:nth-child(2) + .an-band`)).not.toBe(null);
        const current = container.querySelector(`[aria-current="step"]`);
        expect(current?.classList.contains(`an-tok`)).toBe(true);
        expect(current?.textContent).toContain(`[2,-2] [3,-3]`);
    });
});
