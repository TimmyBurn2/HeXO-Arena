import { describe, expect, it } from 'vitest';
import type { AnalysisList } from '@hexo-arena/contract';
import { positionKey } from '@hexo-arena/rules';
import { gameLineOf, ownSourceId, setupBefore, storedReadings } from '../src/analysis/game-readings';
import { rowFacts } from '../src/analysis/row-facts';
import { botSourceId, type Reading } from '../src/analysis/sources';
import { gameLine, gameTree, turnsOfGame } from '../src/analysis/state';
import { nodeAt, playLineFrom } from '../src/analysis/tree';
import { community, judgedCells, nextWinTurns, ownViews } from './judged-game';

const line = gameLineOf(judgedCells, 1);
const list = (analyses: AnalysisList[`analyses`]): AnalysisList => ({ analyses, optedOut: false });
const turns = turnsOfGame(judgedCells);
const tree = gameTree(`g1`, 1, turns);
const played = gameLine(tree, turns);

function reader(stored: AnalysisList): (key: string, id: string) => Reading | null {
    const kept = storedReadings(stored, `g1`, line);
    return (key, id) => kept.find((each) => each.key === key && each.ids.includes(id))?.reading ?? null;
}

describe('storedReadings', () => {
    it('files each turn\'s reading by the key of the position it was played from, under its analyzer and under any analyzer', () => {
        const kept = storedReadings(list([community()]), `g1`, line);
        expect(kept.map((each) => each.key)).toEqual([1, 2, 3, 4, 5].map((turn) => positionKey(setupBefore(line, turn))));
        expect(kept[1]).toMatchObject({
            ids: [botSourceId(`kestrel`), botSourceId(null)],
            reading: { by: { kind: `bot`, name: `kestrel`, version: `0.9`, ownerName: `tom` }, seconds: 2, final: true, elapsedMs: null },
            ask: { lines: 3, seconds: 2 },
        });
        expect(kept[1]?.reading.lines).toHaveLength(3);
    });

    it('files a bot\'s own view under its seat, and leaves out what no position of the line answers', () => {
        const stray = { ...community(), analysisId: `a_2`, turns: [{ turn: 6, toMove: `x` as const, lines: [{ cells: [{ x: 9, y: 9 }, { x: 9, y: 8 }], heuristic: 0 }] }, { turn: 2, toMove: `o` as const, lines: [{ cells: [{ x: 9, y: 9 }, { x: 9, y: 8 }], heuristic: 0 }] }] };
        const unread = { ...community(), analysisId: `a_3`, analyzer: null };
        const kept = storedReadings(list([stray, unread, ...ownViews]), `g1`, line);
        expect(kept.map((each) => each.ids)).toEqual([...[2, 4].map(() => [ownSourceId(`g1`, `x`)]), ...[1, 3, 5].map(() => [ownSourceId(`g1`, `o`)])]);
        expect(kept[0]?.reading.by).toEqual({ kind: `own`, name: `hextide`, side: `x` });
    });
});

describe('rowFacts', () => {
    const facts = rowFacts(tree, reader(list([community()])), () => botSourceId(`kestrel`));
    const of = (turn: number) => facts.get(played[turn - 1]?.id ?? -1);

    it('reads a turn\'s value from its own line where the reading before it lists it, else from the best line after it', () => {
        expect(of(2)).toEqual({ judgment: null, value: `x 0.05` });
        expect(of(3)).toEqual({ judgment: null, value: `x 0.45` });
    });

    it('counts a win the next mover\'s best line finds from the board after a turn, that line\'s own turn included', () => {
        const next = rowFacts(tree, reader(list([community({ turns: nextWinTurns })])), () => botSourceId(`kestrel`));
        expect(next.get(played[2]?.id ?? -1)?.value).toBe(`x wins in 2`);
    });

    it('reads a six as won only where the source read the position it was played from', () => {
        expect(of(5)?.value).toBe(`o wins`);
        expect(rowFacts(tree, () => null, () => botSourceId(`kestrel`)).size).toBe(0);
    });

    it('finds a stored reading from a variation that reaches a position of the game by other turns', () => {
        const first = played[0]?.id ?? -1;
        const branched = playLineFrom(tree, first, [
            [{ x: 1, y: 0 }, { x: 3, y: -1 }],
            [{ x: 2, y: 1 }, { x: 3, y: 1 }],
            [{ x: 2, y: 0 }, { x: 4, y: -1 }],
        ]);
        if (!branched.ok) throw new Error(`the variation did not play`);
        expect(nodeAt(branched.tree, branched.node)?.key).toBe(played[3]?.key);
        const variation = rowFacts(branched.tree, reader(list([community()])), () => botSourceId(`kestrel`));
        expect(variation.get(branched.node)).toEqual({ judgment: null, value: `o wins in 1` });
        // The variation's first turn leaves the game for a position no reading holds.
        expect(variation.get(tree.nextId)).toBeUndefined();
    });

    it('reads the own views by the seat that moves', () => {
        const own = rowFacts(tree, reader(list(ownViews)), (side) => ownSourceId(`g1`, side));
        expect(own.get(played[1]?.id ?? -1)?.value).toBe(`x 0.30`);
        expect(own.get(played[0]?.id ?? -1)?.value).toBe(`o 0.05`);
    });
});
