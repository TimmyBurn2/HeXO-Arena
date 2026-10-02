import { describe, expect, it } from 'vitest';
import type { AxialCoord, Judgment } from '@hexo-arena/contract';
import { explain, explanationSentence, explanationText, verdictInLine, verdictTitle, type ExplainedReading, type ExplainedTurn } from '../src/analysis/explain';
import type { ShownLine } from '../src/analysis/reading-view';

// A value's side and number are held together by a no-break space.
const nb = (words: string) => words.replace(/^([xo]) /u, `$1\u00a0`);

// Turn 14 of a game, hextide's, as x: [-2,-2] [-5,1]; kestrel's line A before it read x 0.30 and played x: [-3,4] [-3,3].
const played: AxialCoord[] = [
    { x: 0, y: 2 },
    { x: -4, y: -1 },
];
const preferred: AxialCoord[] = [
    { x: 1, y: -4 },
    { x: 0, y: -3 },
];
const lineA: ShownLine = { letter: `A`, cells: [preferred[0] ?? { x: 0, y: 0 }, preferred[1] ?? { x: 0, y: 0 }], evaluation: { heuristic: 0.3 }, completesSix: false, value: `x 0.30`, cellsText: `[-3,4] [-3,3]` };
const gameTurn: ExplainedTurn = { kind: `turn`, turn: 14, side: `x`, cells: played, completesSix: false, place: `game`, player: `hextide` };

function judged(judgment: Judgment | null, after = `x 0.06`): ExplainedReading {
    return { kind: `analyzer`, name: `kestrel`, best: lineA, after, judgment, whole: true };
}

describe('a turn explained as a named analyzer\'s opinion', () => {
    it('gives a value drop its bare severity, joined by a colon, the values before and after, and the line preferred', () => {
        for (const [severity, title] of [
            [`inaccuracy`, `Inaccuracy`],
            [`mistake`, `Mistake`],
            [`blunder`, `Blunder`],
        ] as const) {
            const said = explain(gameTurn, judged({ severity, reason: `value-drop`, turns: null }));
            expect(said).toEqual({
                severity,
                verdict: { severity: title, reason: `` },
                title,
                head: `Turn 14, hextide`,
                joiner: `: `,
                text: `${nb(`x 0.30`)} before, ${nb(`x 0.06`)} after; kestrel preferred`,
                line: { side: `x`, cells: preferred, words: `x: [-3,4] [-3,3]` },
                tail: ``,
            });
        }
        expect(explanationSentence(explain(gameTurn, judged({ severity: `mistake`, reason: `value-drop`, turns: null })))).toBe(
            `Mistake: ${nb(`x 0.30`)} before, ${nb(`x 0.06`)} after; kestrel preferred x: [-3,4] [-3,3]`,
        );
    });

    it('names a missed forced win after its severity, whatever it is, and takes a semicolon before the text', () => {
        const said = explain(gameTurn, judged({ severity: `inaccuracy`, reason: `missed-win`, turns: 3 }));
        expect(said.title).toBe(`Inaccuracy: missed a forced win`);
        expect(said.verdict).toEqual({ severity: `Inaccuracy`, reason: `: missed a forced win` });
        expect(explanationSentence(said)).toBe(`Inaccuracy: missed a forced win; ${nb(`x 0.30`)} before, ${nb(`x 0.06`)} after; kestrel preferred x: [-3,4] [-3,3]`);
        expect(explain(gameTurn, judged({ severity: `mistake`, reason: `missed-win`, turns: 3 })).title).toBe(`Mistake: missed a forced win`);
    });

    it('names an allowed forced win the same way', () => {
        const said = explain(gameTurn, judged({ severity: `blunder`, reason: `allowed-win`, turns: 2 }, `o wins in 2`));
        expect(said.severity).toBe(`blunder`);
        expect(explanationSentence(said)).toBe(`Blunder: allowed a forced win; ${nb(`x 0.30`)} before, o wins in 2 after; kestrel preferred x: [-3,4] [-3,3]`);
    });

    it('keeps a verdict whose reading names no line before the turn, saying the value after it', () => {
        const said = explain(gameTurn, { kind: `analyzer`, name: `kestrel`, best: null, after: `x 0.06`, judgment: { severity: `mistake`, reason: `value-drop`, turns: null }, whole: true });
        expect(explanationSentence(said)).toBe(`Mistake: ${nb(`x 0.06`)} after`);
    });

    it('calls an unjudged turn that played line A the analyzer\'s first choice', () => {
        const said = explain({ ...gameTurn, cells: [preferred[1] ?? { x: 0, y: 0 }, preferred[0] ?? { x: 0, y: 0 }] }, judged(null, `x 0.30`));
        expect(said).toMatchObject({ severity: null, title: null, text: `${nb(`x 0.30`)} after; kestrel's first choice`, line: null, tail: `` });
    });

    it('gives any other unjudged turn the values before and after and the line preferred', () => {
        const said = explain(gameTurn, judged(null, `x 0.22`));
        expect(said.title).toBe(null);
        expect(explanationText(said)).toBe(`${nb(`x 0.30`)} before, ${nb(`x 0.22`)} after; kestrel preferred x: [-3,4] [-3,3]`);
        expect(explanationSentence(said)).toBe(`Turn 14, hextide: ${nb(`x 0.30`)} before, ${nb(`x 0.22`)} after; kestrel preferred x: [-3,4] [-3,3]`);
    });

    it('says a turn that completes six wins, judged or not', () => {
        const six = explain({ ...gameTurn, turn: 25, side: `o`, player: `quietlake`, completesSix: true }, judged(null, `o wins`));
        expect(six).toMatchObject({ title: null, head: `Turn 25, quietlake`, text: `o wins with six in a row`, line: null });
    });

    it('says the opening was placed and is not judged', () => {
        expect(explain({ kind: `opening` }, { kind: `none` })).toMatchObject({ title: null, head: `The opening`, text: `Placed by the opening; not judged` });
    });

    it('says a variation is never judged, with its value after where one is read', () => {
        const variation: ExplainedTurn = { ...gameTurn, turn: 7, place: `variation`, player: null };
        expect(explain(variation, judged(null, `x 0.16`))).toMatchObject({ head: `Turn 7, a variation`, text: `${nb(`x 0.16`)} after; variations are not judged`, line: null });
        expect(explain(variation, { kind: `none` }).text).toBe(`Variations are not judged`);
    });

    it('marks a game turn not judged until the game is read whole, after the line preferred', () => {
        const said = explain(gameTurn, { kind: `analyzer`, name: `kestrel`, best: lineA, after: `x 0.06`, judgment: null, whole: false });
        expect(said).toMatchObject({ head: `Turn 14, hextide`, tail: `; not judged until the game is read whole` });
        expect(explanationText(said)).toBe(`${nb(`x 0.30`)} before, ${nb(`x 0.06`)} after; kestrel preferred x: [-3,4] [-3,3]; not judged until the game is read whole`);
        expect(explain(gameTurn, { kind: `none` }).text).toBe(`Not read yet; not judged until the game is read whole`);
    });

    it('gives a bot\'s own view of its turn as its own, judging nothing, the turn named by its number since the text names the bot', () => {
        const said = explain(gameTurn, { kind: `own`, name: `hextide`, after: `x 0.10` });
        expect(said).toMatchObject({ severity: null, title: null, head: `Turn 14`, text: `hextide's own view: ${nb(`x 0.10`)} after this turn`, line: null });
        expect(explanationSentence(said)).toBe(`Turn 14: hextide's own view: ${nb(`x 0.10`)} after this turn`);
    });

    it('leaves out the wait for a whole reading on a game no such reading can judge, still naming who played', () => {
        const unjudgeable: ExplainedTurn = { ...gameTurn, place: `board` };
        expect(explain(unjudgeable, { kind: `none` })).toMatchObject({ head: `Turn 14, hextide`, text: `` });
        expect(explanationText(explain(unjudgeable, judged(null, `x 0.22`)))).toBe(`${nb(`x 0.30`)} before, ${nb(`x 0.22`)} after; kestrel preferred x: [-3,4] [-3,3]`);
    });

    it('says nothing of a turn on a board with no game until a reading does, and names it by its number', () => {
        const board: ExplainedTurn = { ...gameTurn, turn: 3, place: `board`, player: null };
        expect(explain(board, { kind: `none` })).toMatchObject({ head: `Turn 3`, text: ``, line: null });
        expect(explanationText(explain(board, judged(null, `x 0.22`)))).toBe(`${nb(`x 0.30`)} before, ${nb(`x 0.22`)} after; kestrel preferred x: [-3,4] [-3,3]`);
    });

    it('words a verdict as a row heads it and as a line runs on', () => {
        expect(verdictTitle({ severity: `blunder`, reason: `allowed-win`, turns: 2 })).toBe(`Blunder: allowed a forced win`);
        expect(verdictTitle({ severity: `inaccuracy`, reason: `value-drop`, turns: null })).toBe(`Inaccuracy`);
        expect(verdictInLine({ severity: `mistake`, reason: `value-drop`, turns: null })).toBe(`mistake`);
        expect(verdictInLine({ severity: `mistake`, reason: `missed-win`, turns: 3 })).toBe(`missed a forced win`);
        expect(verdictTitle({ severity: `blunder`, reason: `gave-away-win`, turns: 1 })).toBe(`Blunder: gave away the win`);
    });
});
