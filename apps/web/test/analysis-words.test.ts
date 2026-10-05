import { describe, expect, it } from 'vitest';
import { floorOf, gameLine, gameTree, playCells, standOn, toEnd, turnsOfGame } from '../src/analysis/state';
import { newTree, nodeAt } from '../src/analysis/tree';
import { turnWords } from '../src/analysis/words';
import { text } from '../src/text';
import { judgedCells } from './judged-game';

const turns = turnsOfGame(judgedCells);
const played = toEnd(standOn(gameTree(`g1`, 1, turns)));

describe('turnWords', () => {
    const opened = gameTree(`g2`, 3, turns);

    it('says setting up, a stored game\'s drawn opening, and a turn of the game out of its last', () => {
        expect(turnWords(played.tree, played.at, true, 1)).toBe(text.analysis.nav.setup);
        expect(turnWords(opened, floorOf(opened), false, 3)).toBe(text.replay.opening(3));
        expect(turnWords(played.tree, played.at, false, 1)).toBe(text.analysis.nav.turnOf(5, 5));
    });

    it('says a variation\'s turn, and a turn of a line no stored game holds', () => {
        const first = gameLine(played.tree, turns)[0]?.id ?? -1;
        const varied = playCells({ tree: played.tree, at: first, mark: null }, [{ x: -1, y: 1 }, { x: -1, y: 0 }]).state;
        expect(turnWords(varied.tree, varied.at, false, 1)).toBe(text.analysis.nav.variation(2));
        const origin = playCells(standOn(newTree({ kind: `origin` })), [{ x: 0, y: 0 }]).state;
        const line = playCells(origin, [{ x: 0, y: 1 }, { x: 1, y: 1 }]).state;
        expect(turnWords(line.tree, line.at, false, null)).toBe(text.analysis.nav.turn(nodeAt(line.tree, line.at)?.turn ?? -1));
    });
});
