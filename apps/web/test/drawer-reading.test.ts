import { undeclaredValues, winChanceCuts } from '@hexo-arena/contract';
import { describe, expect, it } from 'vitest';
import { communityReading, gameLineOf, ownReading } from '../src/analysis/game-readings';
import { boardReading, feedFolds, feedNotes } from '../src/game/drawer-reading';
import { judgedCells, judgedTurns, ownViews } from './judged-game';

const line = gameLineOf(judgedCells, 1);
const reading = communityReading(line, judgedTurns, true, { scale: 1, cuts: winChanceCuts, meaning: `expected` });
// The cells the board holds after a turn.
const after = (turn: number) => new Set(judgedCells.slice(0, 2 * turn + 1).map((cell) => `${String(cell.x)},${String(cell.y)}`));

describe('what a reading adds to the feed', () => {
    it('give each turn its mark and value, none the opening, and a judged turn its explanation on one line', () => {
        const notes = feedNotes(line, reading, 6, `kestrel`);
        expect(notes[0]).toBe(null);
        expect(notes.slice(1).map((note) => [note?.severity, note?.value])).toEqual([
            [null, `x 0.17`],
            [`inaccuracy`, `x 0.05`],
            [`blunder`, `x 0.45`],
            [`blunder`, `o wins in 1`],
            [null, `o wins`],
        ]);
        expect(notes[2]?.note).toBe(`Inaccuracy: kestrel rates this turn 0.12 below its choice, x\u00a00.17 before and x\u00a00.05 after; it preferred x: [-1,1] [0,1].`);
        expect(notes[4]?.note).toBe(`Blunder: left a six; this turn leaves o a six to complete; kestrel preferred x: [0,-1] [1,-2].`);
        expect(notes[1]?.note).toBe(null);
    });

    it('add no note to a bot\'s own view, which judges nothing', () => {
        const notes = feedNotes(line, ownReading(line, ownViews), 6, null);
        expect(notes.map((note) => note?.note ?? null)).toEqual([null, null, null, null, null, null]);
        expect(notes[2]?.more).toBe(true);
    });
});

describe('the runs a feed folds', () => {
    it('fold each run of marked turns after its first line, by the lines it spans, under a note naming its analyzer', () => {
        expect(feedFolds(line, { ...reading, runs: [{ from: 2, to: 4 }] }, `kestrel`)).toEqual([
            { first: 2, last: 4, title: `Turns 2 to 4: wins let go`, text: `Each turn here let a win go or handed one over; kestrel marks all 3.` },
        ]);
        expect(feedFolds(line, { ...reading, runs: [{ from: 2, to: 4 }] }, null)).toEqual([]);
    });
});

describe('what the board shows of a reading at a turn', () => {
    it('show line A on its empty cells and tag the turn\'s last stone with its mark', () => {
        const shown = boardReading(line, reading, 4, after(4), false, true);
        expect(shown.lines).toEqual({ side: `x`, lines: [{ letter: `A`, cells: [{ x: -1, y: 1 }, { x: -1, y: 2 }] }] });
        expect(shown.judgment).toEqual({ cell: { x: 4, y: -1 }, severity: `blunder` });
    });

    it('show every line while asked, keeping a line whose cells were played in its place', () => {
        const shown = boardReading(line, reading, 2, after(2), true, true);
        expect(shown.lines?.lines.map((each) => [each.letter, each.cells.length])).toEqual([
            [`A`, 2],
            [`B`, 2],
            [`C`, 0],
        ]);
    });

    it('keep the mark and drop the lines with the switch off, and show nothing at a turn not read', () => {
        expect(boardReading(line, reading, 2, after(2), true, false)).toEqual({ lines: undefined, judgment: { cell: { x: 2, y: 0 }, severity: `inaccuracy` } });
        expect(boardReading(line, communityReading(line, judgedTurns.slice(0, 1), false, undeclaredValues), 3, after(3), true, true)).toEqual({ lines: undefined, judgment: undefined });
    });
});
