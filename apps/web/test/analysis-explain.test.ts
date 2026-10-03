import { describe, expect, it } from 'vitest';
import type { AxialCoord, ForcedWinsAround, Judgment, ValueText } from '@hexo-arena/contract';
import { explain, explainRun, explanationSentence, explanationText, verdictInLine, verdictTitle, type ExplainedReading, type ExplainedTurn } from '../src/analysis/explain';
import type { ShownLine } from '../src/analysis/reading-view';

// A value's side and number are held together by a no-break space.
const nb = (words: string) => words.replace(/^([xo]) /u, `$1\u00a0`);

// A raw value or a forced win, spoken as it shows.
const plainValue = (words: string): ValueText => ({ shown: words, spoken: words });

// Turn 14 of a game, hextide's, as x: [-2,-2] [-5,1]; kestrel's line A before it read x 0.30 and played x: [-3,4] [-3,3].
const played: AxialCoord[] = [
    { x: 0, y: 2 },
    { x: -4, y: -1 },
];
const preferred: AxialCoord[] = [
    { x: 1, y: -4 },
    { x: 0, y: -3 },
];
const lineA: ShownLine = {
    letter: `A`,
    cells: [preferred[0] ?? { x: 0, y: 0 }, preferred[1] ?? { x: 0, y: 0 }],
    evaluation: { heuristic: 0.3 },
    completesSix: false,
    value: plainValue(`x 0.30`),
    drawn: 0.3,
    cellsText: `[-3,4] [-3,3]`,
};
const gameTurn: ExplainedTurn = { kind: `turn`, turn: 14, side: `x`, cells: played, completesSix: false, place: `game`, player: `hextide` };
const noForced: ForcedWinsAround = { before: null, after: null };

function read(judgment: Judgment | null, after = `x 0.06`, forced: ForcedWinsAround = noForced, drop: string | null = null): Extract<ExplainedReading, { kind: `analyzer` }> {
    return { kind: `analyzer`, name: `kestrel`, best: lineA, after: plainValue(after), judgment, whole: true, forced, drop };
}

describe('a judged turn explained as a named analyzer\'s opinion', () => {
    it('says a turn that gave away the win held one for its mover and handed one over, and the line preferred', () => {
        const said = explain(gameTurn, read({ severity: `blunder`, reason: `gave-away-win`, turns: 1 }, `o wins in 1`, { before: { winner: `x`, turns: 2 }, after: { winner: `o`, turns: 1 } }));
        expect(said).toMatchObject({ severity: `blunder`, title: `Blunder: gave away the win`, verdict: { severity: `Blunder`, reason: `: gave away the win` }, head: `Turn 14, hextide`, joiner: `; ` });
        expect(explanationSentence(said)).toBe(`Blunder: gave away the win; kestrel found a win in 2 for x here, and after this turn finds one in 1 for o; it preferred x: [-3,4] [-3,3].`);
        expect(said.line).toEqual({ side: `x`, cells: preferred, words: `x: [-3,4] [-3,3]` });
    });

    it('calls a missed win in 1 a missed six, and a longer one a missed win of its length', () => {
        const six = explain(gameTurn, read({ severity: `blunder`, reason: `missed-win`, turns: 1 }, `x 0.40`, { before: { winner: `x`, turns: 1 }, after: null }));
        expect(explanationSentence(six)).toBe(`Blunder: missed a six; x could complete six here; kestrel preferred x: [-3,4] [-3,3].`);
        const two = explain(gameTurn, read({ severity: `mistake`, reason: `missed-win`, turns: 2 }, `x 0.40`, { before: { winner: `x`, turns: 2 }, after: null }));
        expect(explanationSentence(two)).toBe(`Mistake: missed a win; kestrel found a win in 2 for x here and none after this turn; it preferred x: [-3,4] [-3,3].`);
        expect(explain(gameTurn, read({ severity: `inaccuracy`, reason: `missed-win`, turns: 3 })).title).toBe(`Inaccuracy: missed a win`);
    });

    it('calls an allowed win in 1 a six left, and a longer one an allowed win of its length, starting with a capital only where it stands alone', () => {
        const six = explain(gameTurn, read({ severity: `blunder`, reason: `allowed-win`, turns: 1 }, `o wins in 1`));
        expect(explanationText(six)).toBe(`This turn leaves o a six to complete; kestrel preferred x: [-3,4] [-3,3].`);
        expect(explanationSentence(six)).toBe(`Blunder: left a six; this turn leaves o a six to complete; kestrel preferred x: [-3,4] [-3,3].`);
        const three = explain(gameTurn, read({ severity: `mistake`, reason: `allowed-win`, turns: 3 }, `o wins in 3`));
        expect(three.title).toBe(`Mistake: allowed a win`);
        expect(explanationText(three)).toBe(`After this turn kestrel finds a win in 3 for o; it preferred x: [-3,4] [-3,3].`);
        expect(explain(gameTurn, read({ severity: `blunder`, reason: `allowed-win`, turns: 2 }, `o wins in 2`)).title).toBe(`Blunder: allowed a win`);
    });

    it('gives a value drop its bare severity, joined by a colon, how far the value fell, and the values before and after', () => {
        for (const [severity, title] of [
            [`inaccuracy`, `Inaccuracy`],
            [`mistake`, `Mistake`],
            [`blunder`, `Blunder`],
        ] as const) {
            const judged = explain(gameTurn, read({ severity, reason: `value-drop`, turns: null }, `x 0.06`, noForced, `0.24`));
            expect(judged).toMatchObject({ severity, title, verdict: { severity: title, reason: `` }, joiner: `: ` });
            expect(explanationSentence(judged)).toBe(`${title}: kestrel rates this turn 0.24 below its choice, ${nb(`x 0.30`)} before and ${nb(`x 0.06`)} after; it preferred x: [-3,4] [-3,3].`);
        }
    });

    it('gives an expected analyzer\'s values before and after as win chances, and its drop in points of the mover\'s', () => {
        const chance = (side: `x` | `o`, percent: number): ValueText => ({ shown: `${side} ${String(percent)}%`, spoken: `${side}'s win chance ${String(percent)} percent` });
        const reading = { ...read({ severity: `mistake`, reason: `value-drop`, turns: null }, `x 0.06`, noForced, `12 points`), best: { ...lineA, value: chance(`x`, 65) }, after: chance(`o`, 53) };
        expect(explanationSentence(explain(gameTurn, reading))).toBe(`Mistake: kestrel rates this turn 12 points below its choice, ${nb(`x 65%`)} before and ${nb(`o 53%`)} after; it preferred x: [-3,4] [-3,3].`);
        expect(explanationText(explain(gameTurn, { ...reading, judgment: null }))).toBe(`${nb(`x 65%`)} before, ${nb(`o 53%`)} after; kestrel preferred x: [-3,4] [-3,3].`);
    });

    it('keeps a verdict whose reading names no line before the turn, saying the value after it', () => {
        const said = explain(gameTurn, { ...read({ severity: `mistake`, reason: `value-drop`, turns: null }), best: null });
        expect(explanationSentence(said)).toBe(`Mistake: ${nb(`x 0.06`)} after.`);
    });

    it('folds a run under one note naming its turns and that the analyzer marks every one of them', () => {
        expect(explainRun({ from: 5, to: 20 }, `Pistol1`)).toEqual({ title: `Turns 5 to 20: wins let go`, text: `Each turn here let a win go or handed one over; Pistol1 marks all 16.` });
    });

    it('words a verdict as a row heads it and as a line runs on', () => {
        expect(verdictTitle({ severity: `blunder`, reason: `allowed-win`, turns: 1 })).toBe(`Blunder: left a six`);
        expect(verdictTitle({ severity: `inaccuracy`, reason: `value-drop`, turns: null })).toBe(`Inaccuracy`);
        expect(verdictInLine({ severity: `mistake`, reason: `value-drop`, turns: null })).toBe(`mistake`);
        expect(verdictInLine({ severity: `mistake`, reason: `missed-win`, turns: 2 })).toBe(`missed a win`);
        expect(verdictInLine({ severity: `blunder`, reason: `gave-away-win`, turns: 1 })).toBe(`gave away the win`);
    });
});

describe('an unjudged turn explained', () => {
    it('says a turn that keeps its mover\'s forced win is still winning, however slower', () => {
        const said = explain(gameTurn, read(null, `x wins in 3`, { before: { winner: `x`, turns: 1 }, after: { winner: `x`, turns: 3 } }));
        expect(said).toMatchObject({ severity: null, title: null, line: null });
        expect(explanationText(said)).toBe(`kestrel still finds a win in 3 for x after this turn.`);
    });

    it('says a side already lost is not blamed', () => {
        expect(explanationText(explain(gameTurn, read(null, `o wins in 1`, { before: { winner: `o`, turns: 1 }, after: { winner: `o`, turns: 1 } })))).toBe(`kestrel found a win for o before this turn.`);
    });

    it('says a turn found a win where neither side held one', () => {
        const said = explain(gameTurn, read(null, `x wins in 2`, { before: null, after: { winner: `x`, turns: 2 } }));
        expect(explanationText(said)).toBe(`After this turn kestrel finds a win in 2 for x.`);
        expect(explanationSentence(said)).toBe(`Turn 14, hextide: after this turn kestrel finds a win in 2 for x.`);
    });

    it('calls a turn that played line A the analyzer\'s first choice', () => {
        const said = explain({ ...gameTurn, cells: [preferred[1] ?? { x: 0, y: 0 }, preferred[0] ?? { x: 0, y: 0 }] }, read(null, `x 0.30`));
        expect(explanationText(said)).toBe(`${nb(`x 0.30`)} after; kestrel's first choice.`);
    });

    it('gives any other turn the values before and after and the line preferred', () => {
        const said = explain(gameTurn, read(null, `x 0.22`));
        expect(explanationSentence(said)).toBe(`Turn 14, hextide: ${nb(`x 0.30`)} before, ${nb(`x 0.22`)} after; kestrel preferred x: [-3,4] [-3,3].`);
    });

    it('marks a game turn not judged until the game is read whole, after the line preferred', () => {
        const said = explain(gameTurn, { ...read(null), whole: false });
        expect(explanationText(said)).toBe(`${nb(`x 0.30`)} before, ${nb(`x 0.06`)} after; kestrel preferred x: [-3,4] [-3,3]; not judged until the game is read whole.`);
        expect(explanationText(explain(gameTurn, { kind: `none` }))).toBe(`Not read yet; not judged until the game is read whole.`);
    });

    it('says a turn that completes six wins, the opening was placed, and a variation is never judged', () => {
        expect(explain({ ...gameTurn, turn: 25, side: `o`, player: `quietlake`, completesSix: true }, read(null, `o wins`))).toMatchObject({ head: `Turn 25, quietlake`, text: `o wins with six in a row` });
        const opening = explain({ kind: `opening` }, { kind: `none` });
        expect(explanationSentence(opening)).toBe(`The opening: placed by the opening; not judged.`);
        expect(explanationText(opening)).toBe(`Placed by the opening; not judged.`);
        const variation: ExplainedTurn = { ...gameTurn, turn: 7, place: `variation`, player: null };
        expect(explanationText(explain(variation, read(null, `x 0.16`)))).toBe(`${nb(`x 0.16`)} after; variations are not judged.`);
        expect(explanationText(explain(variation, { kind: `none` }))).toBe(`Variations are not judged.`);
    });

    it('gives a bot\'s own view of its turn as its own, the turn named by its number since the text names the bot', () => {
        const own = explain(gameTurn, { kind: `own`, name: `hextide`, after: plainValue(`x 0.10`) });
        expect(own).toMatchObject({ head: `Turn 14`, line: null });
        expect(explanationSentence(own)).toBe(`Turn 14: hextide's own view: ${nb(`x 0.10`)} after this turn.`);
    });

    it('leaves out the wait for a whole reading on a game no such reading can judge, still naming who played', () => {
        const unjudgeable: ExplainedTurn = { ...gameTurn, place: `board` };
        expect(explain(unjudgeable, { kind: `none` })).toMatchObject({ head: `Turn 14, hextide`, text: `` });
        expect(explanationText(explain(unjudgeable, { ...read(null, `x 0.22`), whole: false }))).toBe(`${nb(`x 0.30`)} before, ${nb(`x 0.22`)} after; kestrel preferred x: [-3,4] [-3,3].`);
    });
});
