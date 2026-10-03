import { readFileSync } from 'node:fs';
import { analysisTurnSchema, gameCellSchema, judgmentRuns, sideSchema, undeclaredValues, winChanceCuts, type AnalyzerValues } from '@hexo-arena/contract';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { communityReading, gameLineOf } from '../src/analysis/game-readings';

// Finished games between dev bots, each read whole by one alpha-beta analyzer at 1 line and under 2 s a position:
// two games the site stored readings of, eight more between bots that play at random, and eight with a greedy bot.
// The analyzer's heuristic is a squashed threat count, no winning chance, and its win_in counts from the board after each line.
const sampleSchema = z.object({
    games: z.array(
        z.object({
            id: z.string(),
            kind: z.enum([`analyzed`, `random`, `greedy`]),
            x: z.string(),
            o: z.string(),
            winner: sideSchema.nullable(),
            openingPlies: z.number().int(),
            cells: z.array(gameCellSchema),
            turns: z.array(analysisTurnSchema),
        }),
    ),
});
const sample = sampleSchema.parse(JSON.parse(readFileSync(new URL(`judged-readings.json`, import.meta.url), `utf8`)));

const declared: AnalyzerValues = { scale: 1, cuts: winChanceCuts, meaning: `expected` };

// Each kind's judgeable turns, its marks by reason and severity, and its runs, as one tally.
function tally(kind: string, values: AnalyzerValues) {
    const marks: Record<string, number> = {};
    let judgeable = 0;
    const runs: number[] = [];
    for (const game of sample.games.filter((each) => each.kind === kind)) {
        const reading = communityReading(gameLineOf(game.cells, game.openingPlies), game.turns, true, values);
        for (const read of reading.turns.values()) {
            if (!read.completesSix && read.options.length > 0 && read.after !== null) judgeable += 1;
            if (read.judgment === null) continue;
            const key = `${read.judgment.reason}/${read.judgment.severity}`;
            marks[key] = (marks[key] ?? 0) + 1;
        }
        runs.push(...judgmentRuns(reading.turns.values()).map((run) => run.to - run.from + 1));
    }
    return { judgeable, marks, runs: { count: runs.length, turns: runs.reduce((sum, run) => sum + run, 0), longest: Math.max(0, ...runs) } };
}

describe('judging a sample of real readings', () => {
    it('marks the two stored games by their forced wins alone, most turns giving the win away in a scramble', () => {
        expect(tally(`analyzed`, undeclaredValues)).toEqual({
            judgeable: 89,
            marks: { 'allowed-win/blunder': 6, 'gave-away-win/blunder': 67, 'missed-win/blunder': 1, 'missed-win/mistake': 3 },
            runs: { count: 3, turns: 77, longest: 54 },
        });
    });

    it('adds the value drops to them only once the analyzer declares lichess\'s cuts', () => {
        expect(tally(`analyzed`, declared).marks).toEqual({
            'allowed-win/blunder': 6,
            'gave-away-win/blunder': 67,
            'missed-win/blunder': 1,
            'missed-win/mistake': 3,
            'value-drop/blunder': 7,
            'value-drop/mistake': 1,
        });
    });

    it('marks games between random bots as mostly given-away wins, graded by length', () => {
        const forced = { 'allowed-win/blunder': 20, 'allowed-win/mistake': 3, 'gave-away-win/blunder': 217, 'missed-win/blunder': 8, 'missed-win/inaccuracy': 2, 'missed-win/mistake': 6 };
        expect(tally(`random`, undeclaredValues)).toEqual({ judgeable: 312, marks: forced, runs: { count: 11, turns: 248, longest: 63 } });
        expect(tally(`random`, declared).marks).toEqual({ ...forced, 'value-drop/blunder': 24, 'value-drop/inaccuracy': 2, 'value-drop/mistake': 3 });
    });

    it('marks games with a greedy bot only where a six was left, with no runs', () => {
        expect(tally(`greedy`, undeclaredValues)).toEqual({ judgeable: 26, marks: { 'allowed-win/blunder': 8 }, runs: { count: 0, turns: 0, longest: 0 } });
        expect(tally(`greedy`, declared).marks).toEqual({ 'allowed-win/blunder': 8, 'value-drop/blunder': 14, 'value-drop/inaccuracy': 1 });
    });
});
