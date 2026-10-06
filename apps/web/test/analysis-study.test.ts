import { describe, expect, it } from 'vitest';
import { analysisTreeNodeCap, readHtttx, writeHtttx, type HtttxV2Document } from '@hexo-arena/contract';
import { positionKey, type Coord } from '@hexo-arena/rules';
import { readImport } from '../src/analysis/import-text';
import { markCell, readStoredBoard, restoreBoard, rootOfStored, standOn, storeBoard, back, deleteFrom } from '../src/analysis/state';
import { importedKinds, notationEvaluation, shownNotes, studyDocument, studyOf, studyText, type Study } from '../src/analysis/study';
import { lineTo, mainLine, newTree, nodeAt, play, playLone, positionAt, rootId, wholeAt, type MoveTree, type NodeId, type TreePlay } from '../src/analysis/tree';
import { clockText, importedWords } from '../src/analysis/words';

// A wire cell, [q,r], in the engine's coordinates.
const at = (q: number, r: number): Coord => ({ x: q + r, y: -r + 0 });

function document(text: string): HtttxV2Document {
    const read = readHtttx(text);
    if (!read.ok || read.document.version !== 2) throw new Error(`not v2: ${JSON.stringify(read)}`);
    return read.document;
}

function study(text: string): Study {
    const read = studyOf(document(text));
    if (!read.ok) throw new Error(`refused: ${JSON.stringify(read.error)}`);
    return read.value;
}

function accepted(result: TreePlay): { readonly tree: MoveTree; readonly node: NodeId } {
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.refusal)}`);
    return result;
}

// The v2 notation's example of nested variations, two of them ending on the final move short of a six, and the main line on a six.
const nested = `version[2];
1. [-1,0] [0,-1]              ;
2. [1,0]  [2,0]
  ( 2. [1,-2]  [2,-2]     ;
    3. [-1,-1] [-1,-2]    ;
    4. [-1,1]  [1,-1]
      ( 4. [-1,-3] [/]; ) ; )

  ( 2. [-2,1]  [2,-3]     ;
    3. [-1,-1] [/]        ; ) ;

3. [1,-2] [2,-3]              ;
4. [3,0]  [4,0]               ;
5. [1,-1] [2,-2]              ;
6. [5,0]  [/]                 ;
`;

const annotated = `version[2];
1. [-1,0] {@4505} [0,-1] { @4500 : %-1 } ;
2. [1,0]  {@4055} [2,0]  { @4050 : %2  } ;
3. [1,-2] {@4205} [2,-3] { @4200 : %-5 } ;
4. [3,0]  {@3555} [4,0]  { @3550 : #-1 } ;
5. [1,-1] {@3105} [2,-2] { @3100 : #1  } ;
6. [5,0]  {@1050}
     <-1,0:$1 > <0,-1:$1> <1,0:$1> <2,0:$1>
     <1,-2:$2 > <2,-3:$2> <3,0:$2> <4,0:$2>
     <1,-1:$3 > <2,-2:$3> <5,0:$3>
   [/];
`;

function children(tree: MoveTree, id: NodeId): NodeId[] {
    return [...(nodeAt(tree, id)?.children ?? [])];
}

describe('a half-turn in the tree', () => {
    const tree = accepted(play(newTree({ kind: `origin` }), rootId, [at(1, 0), at(0, 1)])).tree;
    const first = mainLine(tree)[1] ?? rootId;

    it('holds a lone stone that completes no six, its mover a stone short, its line the whole turns before it', () => {
        const half = accepted(playLone(tree, first, at(-1, 0)));
        const node = nodeAt(half.tree, half.node);
        expect(node).toMatchObject({ kind: `half`, parent: first, turn: 2, side: `x`, cell: at(-1, 0), children: [] });
        expect(positionAt(half.tree, half.node).stones).toHaveLength(4);
        expect(positionAt(half.tree, half.node).toMove).toBe(0);
        expect(wholeAt(half.tree, half.node)).toBe(first);
        expect(lineTo(half.tree, half.node)).toEqual(lineTo(tree, first));
        expect(accepted(playLone(half.tree, first, at(-1, 0))).node).toBe(half.node);
    });

    it('holds a lone stone that completes six as a turn of its own, as play does', () => {
        let won = newTree({ kind: `origin` });
        let from = rootId;
        for (const cells of [
            [at(1, 3), at(1, 4)],
            [at(1, 0), at(2, 0)],
            [at(-1, 3), at(-1, 4)],
            [at(3, 0), at(4, 0)],
            [at(-2, 3), at(-2, 4)],
        ] as const) {
            const played = accepted(play(won, from, cells));
            won = played.tree;
            from = played.node;
        }
        const six = accepted(playLone(won, from, at(5, 0)));
        expect(nodeAt(six.tree, six.node)).toMatchObject({ kind: `turn`, cells: [at(5, 0)], win: { player: 0 } });
    });

    it('takes its second stone as the whole turn from its parent, beside it, and plays any turn from there', () => {
        const half = accepted(playLone(tree, first, at(-1, 0)));
        const board = standOn(half.tree, half.node);
        const completed = markCell(board, at(0, -1));
        expect(completed.refusal).toBeNull();
        const node = nodeAt(completed.state.tree, completed.state.at);
        expect(node).toMatchObject({ kind: `turn`, parent: first, cells: [at(-1, 0), at(0, -1)] });
        expect(children(completed.state.tree, first)).toEqual([half.node, completed.state.at]);
        expect(markCell(board, at(-1, 0)).refusal).toMatchObject({ kind: `rules`, turn: 2, rejection: { kind: `cell-occupied` } });
        expect(accepted(play(half.tree, half.node, [at(2, 0), at(3, 0)])).node).toBe(accepted(play(half.tree, first, [at(2, 0), at(3, 0)])).node);
    });

    it('steps back to its parent and goes when deleted, the board with it', () => {
        const half = accepted(playLone(tree, first, at(-1, 0)));
        const board = standOn(half.tree, half.node);
        expect(back(board).at).toBe(first);
        const deleted = deleteFrom(board, [], half.node);
        expect(deleted.at).toBe(first);
        expect(nodeAt(deleted.tree, half.node)).toBeUndefined();
    });

    it('comes back from the browser\'s storage with the notes an imported text gave its stones', () => {
        const read = study(nested);
        const stored = readStoredBoard(JSON.stringify(storeBoard(standOn(read.tree, read.end), [])));
        if (stored === null) throw new Error(`the stored board does not read`);
        const restored = restoreBoard(stored, rootOfStored(stored.root, 1));
        expect(studyText(restored.tree, [], 2)).toBe(studyText(read.tree, [], 2));
        const notes = study(annotated);
        const kept = readStoredBoard(JSON.stringify(storeBoard(standOn(notes.tree, notes.end), [])));
        if (kept === null) throw new Error(`the stored board does not read`);
        expect(studyText(restoreBoard(kept, rootOfStored(kept.root, 1)).tree, [], 2)).toBe(studyText(notes.tree, [], 2));
    });
});

describe('importing v2 text', () => {
    it('plays the main line and every variation into the tree, nested ones under theirs, in the text\'s order', () => {
        const read = study(nested);
        const { tree } = read;
        const main = mainLine(tree);
        expect(main).toHaveLength(7);
        expect(read).toMatchObject({ turns: 6, variations: 3, half: false, win: { player: 0 } });
        const [, one, two] = main;
        const atTurn2 = children(tree, one ?? rootId);
        expect(atTurn2).toHaveLength(3);
        expect(atTurn2[0]).toBe(two);
        const [, deep, short] = atTurn2.map((id) => nodeAt(tree, id));
        expect(deep).toMatchObject({ kind: `turn`, cells: [at(1, -2), at(2, -2)] });
        expect(short).toMatchObject({ kind: `turn`, cells: [at(-2, 1), at(2, -3)] });
        const deepThree = children(tree, deep?.id ?? rootId)[0] ?? rootId;
        const [deepFour, deepHalf] = children(tree, deepThree).map((id) => nodeAt(tree, id));
        expect(deepFour).toMatchObject({ kind: `turn`, turn: 4, cells: [at(-1, 1), at(1, -1)] });
        expect(deepHalf).toMatchObject({ kind: `half`, turn: 4, side: `x`, cell: at(-1, -3) });
        expect(children(tree, short?.id ?? rootId).map((id) => nodeAt(tree, id))).toMatchObject([{ kind: `half`, turn: 3, side: `o`, cell: at(-1, -1) }]);
        expect(nodeAt(tree, main.at(-1) ?? rootId)).toMatchObject({ kind: `turn`, cells: [at(5, 0)] });
    });

    it('opens on the main line\'s end, stepping forward along the main line everywhere', () => {
        const read = study(nested);
        expect(read.end).toBe(mainLine(read.tree).at(-1));
        expect(read.tree.lastVisited.size).toBe(0);
    });

    it('opens a main line ending on the final move short of a six as a half-turn', () => {
        const read = study(`version[2];\n1. [1,-1] [/];`);
        expect(read).toMatchObject({ turns: 1, variations: 0, half: true, win: null });
        expect(nodeAt(read.tree, read.end)).toMatchObject({ kind: `half`, side: `o` });
    });

    it('keeps each stone\'s notes, the final move\'s joined to its turn\'s first stone', () => {
        const { tree } = study(annotated);
        const [, one, , , four, , six] = mainLine(tree).map((id) => nodeAt(tree, id));
        expect(one?.kind !== `root` && one?.notes).toEqual({
            first: { info: { clockMs: 4505, evaluation: null }, visuals: [] },
            second: { info: { clockMs: 4500, evaluation: { kind: `open`, value: -1 } }, visuals: [] },
        });
        expect(four?.kind !== `root` && four !== undefined && shownNotes(four)?.info).toEqual({ clockMs: 3550, evaluation: { kind: `closed`, turns: -1 } });
        if (six === undefined || six.kind === `root`) throw new Error(`no sixth turn`);
        expect(six.notes?.second).toBeNull();
        expect(shownNotes(six)?.visuals).toHaveLength(11);
        const joined = study(`version[2];\n1. [1,1] {@2000:%3} <2,0> [/] { @1000 } <1,1> <1,0> ;`);
        const half = nodeAt(joined.tree, joined.end);
        if (half === undefined || half.kind === `root`) throw new Error(`no half-turn`);
        expect(shownNotes(half)).toEqual({ info: { clockMs: 1000, evaluation: { kind: `open`, value: 3 } }, visuals: [{ cell: at(2, 0), highlight: null, label: null }, { cell: at(1, 1), highlight: null, label: null }, { cell: at(1, 0), highlight: null, label: null }] });
    });

    it('refuses a variation\'s turn the rules refuse, naming the turn and the cell', () => {
        const read = studyOf(document(`version[2];\n1. [1,0][0,1] (1. [1,0][9,9];);`));
        expect(read.ok ? `accepted` : read.error).toEqual({ kind: `illegal`, turn: 1, cell: at(9, 9), rejection: { kind: `outside-placement-radius` } });
    });

    it('refuses a tree past the board\'s node cap', () => {
        const ring: Coord[] = [];
        for (let q = -5; q <= 5; q += 1) for (let r = -5; r <= 5; r += 1) if ((q !== 0 || r !== 0) && Math.abs(q + r) <= 5) ring.push({ x: q, y: r });
        const pairs: string[] = [];
        for (const [index, a] of ring.entries()) for (const b of ring.slice(index + 1)) pairs.push(`(1.[${String(a.x)},${String(a.y)}][${String(b.x)},${String(b.y)}];)`);
        const text = `version[2];1.[1,0][0,1]${pairs.slice(1, analysisTreeNodeCap + 1).join(``)};`;
        const read = studyOf(document(text));
        expect(read.ok ? `accepted` : read.error).toEqual({ kind: `tree-cap`, limit: analysisTreeNodeCap });
    });

    it('reads v2 text pasted into Import as the tree, and v1 text with threat marks as refused by name', () => {
        const imported = readImport(nested, `https://arena.example`);
        expect(imported.ok && imported.value.kind).toBe(`study`);
        expect(readImport(`version[1];\n1. [1,0][0,1]!;`, `https://arena.example`)).toEqual({ ok: false, error: { kind: `threat-mark`, line: 2, column: 14, turn: 1 } });
    });
});

describe('exporting the tree', () => {
    it('writes every variation and half-turn back as the text wrote them', () => {
        const read = study(nested);
        expect(studyText(read.tree, [], 2)).toBe(writeHtttx(document(nested)));
    });

    it('writes imported notes back, the final move\'s on the stone before it, which reads back to the same tree', () => {
        const read = study(annotated);
        const text = studyText(read.tree, [{ key: `name`, value: `Study` }], 2) ?? ``;
        expect(text.split(`\n`)[0]).toBe(`version[2]name[Study];`);
        expect(text).toContain(`6. [5,0]{@1050}<-1,0:$1>`);
        expect(text).toContain(`[/];`);
        expect(studyText(study(text).tree, [{ key: `name`, value: `Study` }], 2)).toBe(text);
    });

    it('writes the main line alone as v1, a closing half-turn left out', () => {
        expect(studyText(study(nested).tree, [], 1)).toBe(`version[1];\n1. [-1,0][0,-1];\n2. [1,0][2,0];\n3. [1,-2][2,-3];\n4. [3,0][4,0];\n5. [1,-1][2,-2];\n6. [5,0];\n`);
        expect(studyText(study(`version[2];\n1. [1,0][0,1];\n2. [2,0][/];`).tree, [], 1)).toBe(`version[1];\n1. [1,0][0,1];\n`);
    });

    it('adds an evaluation and a clock to each whole turn\'s last stone where the imported text gives none, and none to a half-turn', () => {
        const read = study(`version[2];\n1. [1,0][0,1]{@9:%7};\n2. [2,0][3,0]{@8};\n3. [4,0][/];`);
        const text = studyText(read.tree, [], 2, {
            evaluation: (node) => (node.turn === 1 ? { kind: `open`, value: 40 } : node.turn === 2 ? { kind: `closed`, turns: -3 } : null),
            clock: (node) => (node.turn === 3 ? null : node.turn * 1_000),
        });
        expect(text).toBe(`version[2];\n1. [1,0][0,1]{@9:%7};\n2. [2,0][3,0]{@8:#-3};\n3. [4,0][/];\n`);
        expect(studyText(study(`version[2];\n1. [1,0][0,1];`).tree, [], 2, { evaluation: () => ({ kind: `open`, value: 40 }), clock: () => 1_000 })).toBe(`version[2];\n1. [1,0][0,1]{@1000:%40};\n`);
    });

    it('writes nothing for a tree of no turns, which v2 cannot hold', () => {
        expect(studyDocument(newTree({ kind: `origin` }), [])).toBeNull();
        expect(studyText(newTree({ kind: `origin` }), [], 1)).toBe(`version[1];\n`);
    });
});

describe('an evaluation as the notation writes it', () => {
    const expected = { scale: 2, cuts: null, meaning: `expected` } as const;
    const raw = { scale: 1, cuts: null, meaning: `raw` } as const;

    it('writes a forced win from the played turn\'s own line as its win_in, one to one, and from the next mover\'s best line counting that line', () => {
        expect(notationEvaluation({ kind: `played`, evaluation: { win_in: 3 } }, raw)).toEqual({ kind: `closed`, turns: 3 });
        expect(notationEvaluation({ kind: `played`, evaluation: { win_in: -2, heuristic: 0.9 } }, expected)).toEqual({ kind: `closed`, turns: -2 });
        expect(notationEvaluation({ kind: `next`, evaluation: { win_in: -1 }, mover: `o` }, raw)).toEqual({ kind: `closed`, turns: -1 });
        expect(notationEvaluation({ kind: `next`, evaluation: { win_in: 2 }, mover: `o` }, raw)).toEqual({ kind: `closed`, turns: 3 });
        expect(notationEvaluation({ kind: `next`, evaluation: { win_in: -1 }, mover: `x` }, raw)).toEqual({ kind: `closed`, turns: -2 });
    });

    it('writes an expected value as its scaled hundredths, held to -100 to 100, and nothing for a raw one', () => {
        expect(notationEvaluation({ kind: `played`, evaluation: { heuristic: 1 } }, expected)).toEqual({ kind: `open`, value: 50 });
        expect(notationEvaluation({ kind: `next`, evaluation: { heuristic: -7 }, mover: `x` }, expected)).toEqual({ kind: `open`, value: -100 });
        expect(notationEvaluation({ kind: `played`, evaluation: { heuristic: -0.008 } }, expected)).toEqual({ kind: `open`, value: 0 });
        expect(Object.is((notationEvaluation({ kind: `played`, evaluation: { heuristic: -0.008 } }, expected) as { value: number }).value, -0)).toBe(false);
        expect(notationEvaluation({ kind: `played`, evaluation: { heuristic: 0.5 } }, raw)).toBeNull();
        expect(notationEvaluation({ kind: `played`, evaluation: {} }, expected)).toBeNull();
    });
});

describe('imported notes in words', () => {
    it('says an open evaluation as the leading side\'s win chance by the notation\'s formula in whole percents, as an analyzer\'s, held to -100 to 100', () => {
        expect(importedWords({ kind: `open`, value: 2 })).toEqual({ shown: `x 51%`, spoken: `x's win chance 51 percent` });
        expect(importedWords({ kind: `open`, value: -5 })).toEqual({ shown: `o 53%`, spoken: `o's win chance 53 percent` });
        expect(importedWords({ kind: `open`, value: 0 }).shown).toBe(`even`);
        expect(importedWords({ kind: `open`, value: 250 }).shown).toBe(`x 99%`);
    });

    it('says a closed evaluation as its winner\'s win, and #0 as decided with no winner named', () => {
        expect(importedWords({ kind: `closed`, turns: 3 }).shown).toBe(`x wins in 3`);
        expect(importedWords({ kind: `closed`, turns: -2 }).shown).toBe(`o wins in 2`);
        expect(importedWords({ kind: `closed`, turns: 0 }).shown).toBe(`decided, naming no winner`);
    });

    it('says a clock in tenths of a second under a minute, then minutes and seconds, then hours', () => {
        expect(clockText(4_505)).toBe(`4.5 s`);
        expect(clockText(59_999)).toBe(`59.9 s`);
        expect(clockText(0)).toBe(`0.0 s`);
        expect(clockText(60_000)).toBe(`1:00`);
        expect(clockText(3_661_000)).toBe(`1:01:01`);
    });
});

describe('a half-turn\'s position key', () => {
    it('names the board with its lone stone, which no reading of a whole turn holds', () => {
        const read = study(`version[2];\n1. [1,0][0,1];\n2. [2,0][/];`);
        const half = nodeAt(read.tree, read.end);
        if (half === undefined || half.kind === `root`) throw new Error(`no half-turn`);
        expect(half.key).toBe(positionKey(positionAt(read.tree, half.id)));
        expect(half.key).not.toBe(nodeAt(read.tree, half.parent)?.key);
    });
});

describe('the tags of an imported text', () => {
    it('stay with the tree, are written back on export, and come back from the browser\'s storage', () => {
        const read = study(`version[2]name[Study]playercross[A]playercircle[B];\n1. [1,0][0,1];`);
        expect(read.tree.tags).toEqual([
            { key: `name`, value: `Study` },
            { key: `playercross`, value: `A` },
            { key: `playercircle`, value: `B` },
        ]);
        expect(studyText(read.tree, read.tree.tags, 2)).toBe(`version[2]name[Study]playercross[A]playercircle[B];\n1. [1,0][0,1];\n`);
        const stored = readStoredBoard(JSON.stringify(storeBoard(standOn(read.tree, read.end), [])));
        if (stored === null) throw new Error(`the stored board does not read`);
        expect(restoreBoard(stored, rootOfStored(stored.root, 1)).tree.tags).toEqual(read.tree.tags);
        const broken = readStoredBoard(JSON.stringify({ ...stored, tags: [{ key: `1bad`, value: `x` }] }));
        expect(broken?.tags).toBeUndefined();
        expect(broken?.nodes).toHaveLength(1);
    });

    it('list the kinds of note the text carries, and only those', () => {
        expect(importedKinds(study(`version[2];\n1. [1,0][0,1]{@5};`).tree)).toEqual([`clocks`]);
        expect(importedKinds(study(`version[2];\n1. [1,0][0,1]{%5}<2,0:$A>;`).tree)).toEqual([`evaluations`, `labels`]);
        expect(importedKinds(study(`version[2];\n1. [1,0][0,1]<2,0>;`).tree)).toEqual([`highlights`]);
        expect(importedKinds(study(`version[2];\n1. [1,0][0,1];`).tree)).toEqual([]);
    });
});
