import { describe, expect, it } from 'vitest';
import { analysisStoneCap, type AnalysisList, type BotListing, type GamePlayers } from '@hexo-arena/contract';
import { explain, explainRun, turnReading } from '../src/analysis/explain';
import { communityReading, gameLineOf, ownReading, ownSourceId, turnCells } from '../src/analysis/game-readings';
import type { ReadingEntry } from '../src/analysis/readings';
import type { AnalyzerList } from '../src/analysis/ReadingPanel';
import {
    analyzerShownOf,
    explainShown,
    involvedNotes,
    judgedMark,
    listFacts,
    listFolds,
    ownPill,
    readingPills,
    rowSource,
    unreadableOf,
    type ReadingLookup,
} from '../src/analysis/panel-reading';
import { botSourceId, type Reading, type ReadingAuthor } from '../src/analysis/sources';
import { floorOf, gameLine, gameTree, playCells, standOn, turnsOfGame } from '../src/analysis/state';
import { nodeAt } from '../src/analysis/tree';
import { headOf, type ReadingChoice } from '../src/game/game-analyses';
import { text } from '../src/text';
import { community, judgedCells, judgedTurns, kestrel, ownViews } from './judged-game';

const line = gameLineOf(judgedCells, 1);
const turns = turnsOfGame(judgedCells);
const tree = gameTree(`g1`, 1, turns);
const nodes = gameLine(tree, turns);
const onGame = new Map(nodes.map((node) => [node.id, node.turn]));
const list = (analyses: AnalysisList[`analyses`]): AnalysisList => ({ analyses, optedOut: false, independentOnline: false });
const head = headOf(list([community(), ...ownViews]), line);
const kestrelChoice = head.choices.find((choice) => choice.kind === `community`) ?? null;
const ownChoice = head.choices.find((choice) => choice.kind === `own`) ?? null;
const judged = communityReading(line, judgedTurns, true, kestrel.values);
const views = ownReading(line, ownViews);
const players: GamePlayers = {
    x: { name: `hextide`, rating: 1600, provisional: false, kind: `bot` },
    o: { name: `quinn`, rating: 1500, provisional: false, kind: `user` },
};
const nobody: ReadingLookup = () => null;
const nodeOf = (turn: number) => nodes[turn - 1]?.id ?? -1;

function reading(by: ReadingAuthor): Reading {
    return { by, values: kestrel.values, lines: [], seconds: 2, final: true, elapsedMs: 900 };
}

function held(by: ReadingAuthor): ReadingEntry {
    return { read: { reading: reading(by), ask: { lines: 3, seconds: 2 } }, state: { kind: `idle` } };
}

const zephyr: ReadingAuthor = { kind: `bot`, name: `zephyr`, version: `1.2`, ownerName: `ana` };

describe('readingPills', () => {
    it('lists each analyzer that read the position and the stored game\'s readers by name, the own views last', () => {
        const entries = new Map([
            [botSourceId(`zephyr`), held(zephyr)],
            [botSourceId(null), held(zephyr)],
        ]);
        const { pills } = readingPills({ entries, analyzerId: botSourceId(null), analyzer: null, stored: [`kestrel`], ownViews: true, ownView: false });
        expect(pills).toEqual([
            { id: botSourceId(`kestrel`), name: `kestrel` },
            { id: botSourceId(`zephyr`), name: `zephyr` },
            { id: ownPill, name: text.analysis.reading.ownView },
        ]);
    });

    it('keeps the analyzer the settings name as a pill before it answers, once', () => {
        const { pills, active } = readingPills({ entries: new Map(), analyzerId: botSourceId(`kestrel`), analyzer: `kestrel`, stored: [`kestrel`], ownViews: false, ownView: false });
        expect(pills).toEqual([{ id: botSourceId(`kestrel`), name: `kestrel` }]);
        expect(active).toBe(botSourceId(`kestrel`));
    });

    it('lights the analyzer that answered when asking any, nothing before, and the own views while they show', () => {
        const answered = new Map([[botSourceId(null), held(zephyr)]]);
        expect(readingPills({ entries: answered, analyzerId: botSourceId(null), analyzer: null, stored: [], ownViews: false, ownView: false }).active).toBe(botSourceId(`zephyr`));
        expect(readingPills({ entries: new Map(), analyzerId: botSourceId(null), analyzer: null, stored: [], ownViews: false, ownView: false }).active).toBeNull();
        expect(readingPills({ entries: answered, analyzerId: botSourceId(null), analyzer: null, stored: [], ownViews: true, ownView: true }).active).toBe(ownPill);
    });
});

describe('analyzerShownOf', () => {
    const listing = (ready: boolean): BotListing => ({
        name: `kestrel`,
        ownerName: `tom`,
        online: ready,
        openForChallenges: false,
        rating: 1500,
        provisional: false,
        liveGames: 0,
        version: `0.9`,
        levels: null,
        analyzer: { ready, maxSeconds: 5, lines: 3, whilePlaying: false, values: kestrel.values },
    });
    const ready = (bots: BotListing[]): AnalyzerList => ({ kind: `ready`, bots });
    const shown = { ownView: false, ownBot: null, toMove: `x` as const, seconds: 2 };

    it('names whoever wrote the reading in hand, whatever the settings name', () => {
        expect(analyzerShownOf({ ...shown, read: reading(zephyr), analyzer: `kestrel`, analyzers: ready([]) })).toEqual({ kind: `named`, name: `zephyr`, version: `1.2`, ownerName: `ana`, seconds: 2 });
        expect(analyzerShownOf({ ...shown, read: reading({ kind: `own`, name: `hextide`, side: `x` }), analyzer: null, analyzers: ready([]) })).toEqual({ kind: `own`, name: `hextide`, side: `x` });
    });

    it('names the bot in the seat to move while its own view shows, and none for a person', () => {
        expect(analyzerShownOf({ ...shown, read: null, ownView: true, ownBot: `hextide`, analyzer: `kestrel`, analyzers: ready([]) })).toEqual({ kind: `own`, name: `hextide`, side: `x` });
        expect(analyzerShownOf({ ...shown, read: null, ownView: true, analyzer: null, analyzers: ready([]) })).toEqual({ kind: `own`, name: null, side: `x` });
    });

    it('names any analyzer, or the one the settings name, offline once the list says it is not ready', () => {
        expect(analyzerShownOf({ ...shown, read: null, analyzer: null, analyzers: ready([]) })).toEqual({ kind: `any`, seconds: 2 });
        expect(analyzerShownOf({ ...shown, read: null, analyzer: `kestrel`, analyzers: ready([listing(true)]) })).toEqual({ kind: `named`, name: `kestrel`, version: `0.9`, ownerName: `tom`, seconds: 2 });
        expect(analyzerShownOf({ ...shown, read: null, analyzer: `kestrel`, analyzers: ready([listing(false)]) })).toEqual({ kind: `offline`, name: `kestrel` });
        expect(analyzerShownOf({ ...shown, read: null, analyzer: `kestrel`, analyzers: { kind: `loading` } })).toEqual({ kind: `named`, name: `kestrel`, version: null, ownerName: null, seconds: 2 });
    });
});

describe('unreadableOf', () => {
    it('refuses a won position, one with too many stones, and one reaching too far, in that order', () => {
        const near = { stones: [{ x: 0, y: 0, player: 0 as const }], toMove: 1 as const };
        expect(unreadableOf(near, true)).toEqual({ kind: `won` });
        expect(unreadableOf(near, false)).toBeNull();
        const many = { stones: Array.from({ length: analysisStoneCap + 1 }, (_, index) => ({ x: index, y: 0, player: 0 as const })), toMove: 1 as const };
        expect(unreadableOf(many, false)).toEqual({ kind: `too-many`, stones: analysisStoneCap + 1 });
        expect(unreadableOf({ stones: [{ x: 0, y: 10_000, player: 0 }], toMove: 1 }, false)).toEqual({ kind: `too-far` });
    });
});

describe('rowSource', () => {
    it('reads a row from the community reading\'s analyzer, a seat\'s own view, or the analyzer the panel asks', () => {
        expect(rowSource(kestrelChoice, `g1`, botSourceId(null))(`o`)).toBe(botSourceId(`kestrel`));
        expect(rowSource(ownChoice, `g1`, botSourceId(null))(`o`)).toBe(ownSourceId(`g1`, `o`));
        expect(rowSource(null, `g1`, botSourceId(`zephyr`))(`x`)).toBe(botSourceId(`zephyr`));
        expect(rowSource(kestrelChoice, null, botSourceId(`zephyr`))(`x`)).toBe(botSourceId(`zephyr`));
    });
});

describe('listFacts', () => {
    it('takes a game\'s own turns from the reading picked and drops those it says nothing of', () => {
        const facts = listFacts({ tree, read: nobody, sourceFor: () => botSourceId(`kestrel`), view: judged, gameNodes: nodes });
        const turn3 = judged.turns.get(3);
        expect(facts.get(nodeOf(3))).toEqual({ judgment: turn3?.judgment, value: turn3?.value });
        const silent = listFacts({ tree, read: nobody, sourceFor: () => botSourceId(`kestrel`), view: { ...judged, turns: new Map() }, gameNodes: nodes });
        expect(silent.size).toBe(0);
    });

    it('reads every other turn from what its source read around it', () => {
        const varied = playCells({ tree, at: nodeOf(1), mark: null }, [{ x: -1, y: 1 }, { x: -1, y: 0 }]);
        const at = varied.state.at;
        const parent = nodeAt(varied.state.tree, nodeOf(1));
        const read: ReadingLookup = (key, id) =>
            key === parent?.key && id === botSourceId(`kestrel`) ? { ...reading(zephyr), lines: [{ cells: [{ x: -1, y: 1 }, { x: -1, y: 0 }], evaluation: { heuristic: 0.4 } }] } : null;
        const facts = listFacts({ tree: varied.state.tree, read, sourceFor: () => botSourceId(`kestrel`), view: judged, gameNodes: nodes });
        expect(facts.get(at)?.value?.shown).toBe(`x 70%`);
    });
});

describe('listFolds', () => {
    it('folds a community reading\'s run of marked turns after its first, and nothing for the own views', () => {
        const run = { from: 2, to: 4 };
        const folds = listFolds({ ...judged, runs: [run] }, kestrelChoice, nodes);
        expect(folds).toEqual([{ first: nodeOf(2), hidden: [nodeOf(3), nodeOf(4)], ...explainRun(run, `kestrel`) }]);
        expect(listFolds({ ...views, runs: [run] }, ownChoice, nodes)).toEqual([]);
        expect(listFolds(null, kestrelChoice, nodes)).toEqual([]);
    });
});

describe('explainShown', () => {
    const shown = { tree, players, gameId: `g1`, onGame, card: head.card, line, read: nobody, sourceFor: () => botSourceId(`kestrel`), facts: new Map() };

    it('explains a game\'s own turn from its community reading, which says so, though a six speaks for itself', () => {
        const at3 = explainShown({ ...shown, at: nodeOf(3), view: judged, active: kestrelChoice });
        const read3 = judged.turns.get(3);
        expect(read3).toBeDefined();
        if (read3 === undefined) return;
        const turn3 = { kind: `turn` as const, turn: 3, side: `o` as const, cells: turnCells(line, 3), completesSix: false, place: `game` as const, player: `quinn` };
        expect(at3).toEqual({ explanation: explain(turn3, turnReading(line, read3, `kestrel`, true)), community: true });
        expect(explainShown({ ...shown, at: nodeOf(5), view: judged, active: kestrelChoice })?.community).toBe(false);
    });

    it('explains a game\'s own turn from the bots\' own views by the seat that played it', () => {
        const at4 = explainShown({ ...shown, at: nodeOf(4), view: views, active: ownChoice });
        const turn4 = { kind: `turn` as const, turn: 4, side: `x` as const, cells: turnCells(line, 4), completesSix: false, place: `game` as const, player: `hextide` };
        expect(at4).toEqual({ explanation: explain(turn4, { kind: `own`, name: `hextide`, after: views.turns.get(4)?.value ?? null }), community: false });
    });

    it('explains a variation from what its source read around it, and says nothing without a reading', () => {
        const varied = playCells({ tree, at: nodeOf(1), mark: null }, [{ x: -1, y: 1 }, { x: -1, y: 0 }]).state;
        const turn = { kind: `turn` as const, turn: 2, side: `x` as const, cells: [{ x: -1, y: 1 }, { x: -1, y: 0 }], completesSix: false, place: `variation` as const, player: null };
        expect(explainShown({ ...shown, tree: varied.tree, at: varied.at, view: judged, active: kestrelChoice })).toEqual({ explanation: explain(turn, { kind: `none` }), community: false });
        const parent = nodeAt(varied.tree, nodeOf(1));
        const read: ReadingLookup = (key) => (key === parent?.key ? reading(zephyr) : null);
        const facts = new Map([[varied.at, { judgment: null, value: { shown: `x 70%`, spoken: `x's win chance 70 percent` } }]]);
        const explained = explainShown({ ...shown, tree: varied.tree, at: varied.at, view: judged, active: kestrelChoice, read, facts });
        expect(explained).toEqual({
            explanation: explain(turn, { kind: `analyzer`, name: `zephyr`, best: null, after: facts.get(varied.at)?.value ?? null, judgment: null, whole: false, forced: null, drop: null }),
            community: false,
        });
    });

    it('explains a stored game\'s drawn opening as such, and nothing at a bare root', () => {
        const opened = gameTree(`g2`, 3, turns);
        const opening = explainShown({ ...shown, tree: opened, at: floorOf(opened), view: null, active: null, onGame: new Map() });
        expect(opening).toEqual({ explanation: explain({ kind: `opening` }, { kind: `none` }), community: false });
        const bare = standOn(gameTree(`g3`, 1, []));
        expect(explainShown({ ...shown, tree: bare.tree, at: bare.at, view: null, active: null })).toBeNull();
    });
});

describe('involvedNotes', () => {
    const involved = { ...community({ involved: true, analyzer: { ...kestrel, name: `hextide` } }) };
    const choice: ReadingChoice = { kind: `community`, id: `a_1`, name: `hextide`, analysis: involved };
    const named = { kind: `named` as const, name: `hextide`, version: null, ownerName: null, seconds: 2 };
    const said = text.drawer.reading.involvedSelf(`hextide`);

    it('says an involved reading in the head while the head names its analyzer, and under the explanation while it is the reading\'s', () => {
        expect(involvedNotes({ active: choice, players, analyzer: named, ownView: false, explained: null })).toEqual({ head: said, explanation: null });
        const explained = { explanation: explain({ kind: `opening` }, { kind: `none` }), community: true };
        expect(involvedNotes({ active: choice, players, analyzer: { kind: `any`, seconds: 2 }, ownView: false, explained })).toEqual({ head: null, explanation: said });
        expect(involvedNotes({ active: choice, players, analyzer: named, ownView: true, explained: null })).toEqual({ head: null, explanation: null });
    });

    it('says nothing of an independent reading', () => {
        expect(involvedNotes({ active: kestrelChoice, players, analyzer: { ...named, name: `kestrel` }, ownView: false, explained: null })).toEqual({ head: null, explanation: null });
    });
});

describe('judgedMark', () => {
    it('marks a judged turn of the game beside its last stone, and no other turn', () => {
        const at = (turn: number) => nodeAt(tree, nodeOf(turn));
        const severity = judged.turns.get(3)?.judgment?.severity;
        expect(judgedMark({ node: at(3), onGame, view: judged, line })).toEqual({ cell: turnCells(line, 3).at(-1), severity });
        expect(judgedMark({ node: at(5), onGame, view: judged, line })).toBeNull();
        expect(judgedMark({ node: at(3), onGame: new Map(), view: judged, line })).toBeNull();
        expect(judgedMark({ node: at(3), onGame, view: null, line })).toBeNull();
    });
});
