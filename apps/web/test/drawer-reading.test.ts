import { describe, expect, it } from 'vitest';
import { communityReading, gameLineOf, ownReading } from '../src/analysis/game-readings';
import { boardReading, feedNotes } from '../src/game/drawer-reading';
import { judgedCells, judgedTurns, ownViews } from './judged-game';

const line = gameLineOf(judgedCells, 1);
const reading = communityReading(line, judgedTurns, true);
// The cells the board holds after a turn.
const after = (turn: number) => new Set(judgedCells.slice(0, 2 * turn + 1).map((cell) => `${String(cell.x)},${String(cell.y)}`));

describe('what a reading adds to the feed', () => {
    it('give each turn its mark and value, none the opening, and a judged turn what the analyzer preferred', () => {
        const notes = feedNotes(line, reading, 6, `kestrel`);
        expect(notes[0]).toBe(null);
        expect(notes.slice(1).map((note) => [note?.severity, note?.value])).toEqual([
            [null, `x 0.17`],
            [`inaccuracy`, `x 0.05`],
            [`blunder`, `x 0.45`],
            [`blunder`, `o wins in 2`],
            [null, `o wins`],
        ]);
        expect(notes[2]?.note).toBe(`Inaccuracy; kestrel preferred x: [-1,1] [0,1], x 0.17`);
        expect(notes[4]?.note).toBe(`Allowed a forced win; kestrel preferred x: [0,-1] [1,-2], x 0.45`);
        expect(notes[1]?.note).toBe(null);
    });

    it('add no note to a bot\'s own view, which judges nothing', () => {
        const notes = feedNotes(line, ownReading(line, ownViews), 6, null);
        expect(notes.map((note) => note?.note ?? null)).toEqual([null, null, null, null, null, null]);
        expect(notes[2]?.more).toBe(true);
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
        expect(boardReading(line, communityReading(line, judgedTurns.slice(0, 1), false), 3, after(3), true, true)).toEqual({ lines: undefined, judgment: undefined });
    });
});
