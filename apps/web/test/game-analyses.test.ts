import { describe, expect, it } from 'vitest';
import { analysisTurnCap, undeclaredValues, type AnalysisList, type GameCell, type GamePlayers } from '@hexo-arena/contract';
import { gameLineOf } from '../src/analysis/game-readings';
import { analysesStep, headOf, initialAnalyses, involvedNote, ownChoiceId, refusalOf, underWay, type AnalysesState } from '../src/game/game-analyses';
import { community, judgedCells, ownViews } from './judged-game';

const line = gameLineOf(judgedCells, 1);
const list = (analyses: AnalysisList[`analyses`], optedOut = false, independentOnline = false): AnalysisList => ({ analyses, optedOut, independentOnline });
const queued = community({ analysisId: `a_2`, analyzer: null, status: `queued`, finishedAt: null, queuePosition: 3, progress: { done: 0, of: 5 }, turns: [] });
const running = community({ analysisId: `a_2`, status: `running`, finishedAt: null, progress: { done: 2, of: 5 } });
const failed = community({ analysisId: `a_3`, status: `failed`, failure: `timeout`, failedTurn: 4, progress: { done: 3, of: 5 }, turns: [] });

// A game of `turns` turns from the origin, its stones in a row with gaps, which no six closes.
function longLine(turns: number) {
    const cells: GameCell[] = [{ x: 0, y: 0, side: `x` }];
    for (let ply = 1; ply <= 2 * turns; ply += 1) cells.push({ x: 3 * ply, y: ply % 7, side: Math.floor((ply - 1) / 2) % 2 === 0 ? `o` : `x` });
    return gameLineOf(cells, 1);
}

describe('the head a game\'s readings make', () => {
    it('with no community reading, offer the own view and the request', () => {
        expect(headOf(list(ownViews), line)).toEqual({ choices: [{ kind: `own`, id: ownChoiceId, views: ownViews }], card: { kind: `none` } });
        expect(headOf(list([]), line)).toEqual({ choices: [], card: { kind: `none` } });
    });

    it('while one waits, say how many games are ahead of it', () => {
        expect(headOf(list([queued, ...ownViews]), line).card).toEqual({ kind: `queued`, ahead: 2 });
        expect(headOf(list([{ ...queued, queuePosition: 1 }]), line).card).toEqual({ kind: `queued`, ahead: 0 });
    });

    it('while one runs, offer it first and say which turn it reads of the last', () => {
        const head = headOf(list([running, ...ownViews]), line);
        expect(head.choices.map((choice) => choice.id)).toEqual([`a_2`, ownChoiceId]);
        expect(head.card).toEqual({ kind: `running`, analyzer: running.analyzer, turn: 3, last: 5, share: 0.4 });
        // The final board is read after the last turn, and still belongs to it.
        expect(headOf(list([{ ...running, progress: { done: 5, of: 6 } }]), line).card).toMatchObject({ turn: 5 });
    });

    it('with none done, name the latest failure and the turn it failed on', () => {
        expect(headOf(list([failed, ...ownViews]), line).card).toEqual({ kind: `failed`, analyzer: failed.analyzer, cause: `timeout`, turn: 4 });
        const { failedTurn: _turn, ...unturned } = failed;
        const expired = { ...unturned, analyzer: null, failure: `expired` as const };
        expect(headOf(list([expired]), line).card).toEqual({ kind: `failed`, analyzer: null, cause: `expired`, turn: null });
    });

    it('once one is done, offer the done ones in order and say nothing more, a failure included', () => {
        const second = community({ analysisId: `a_4`, analyzer: { name: `driftwood`, version: null, ownerName: `mika`, values: undeclaredValues } });
        const head = headOf(list([community(), second, failed, ...ownViews]), line);
        expect(head.choices.map((choice) => (choice.kind === `community` ? choice.name : choice.id))).toEqual([`kestrel`, `driftwood`, ownChoiceId]);
        expect(head.card).toBe(null);
    });

    it('with one reading done by an analyzer whose owner played, offer one by an independent analyzer while one is online', () => {
        const involved = community({ involved: true });
        expect(headOf(list([involved, ...ownViews], false, true), line)).toMatchObject({ card: { kind: `independent` } });
        expect(headOf(list([involved, failed], false, true), line).card).toEqual({ kind: `independent` });
        expect(headOf(list([involved], false, false), line).card).toBe(null);
        expect(headOf(list([community()], false, true), line).card).toBe(null);
        const second = community({ analysisId: `a_4`, analyzer: { name: `driftwood`, version: null, ownerName: `mika`, values: undeclaredValues } });
        expect(headOf(list([involved, second], false, true), line).card).toBe(null);
        expect(headOf(list([involved, running], false, true), line).card).toMatchObject({ kind: `running` });
    });

    it('keep a reading under way beside the done ones', () => {
        expect(headOf(list([community(), { ...running, analyzer: { name: `driftwood`, version: null, ownerName: null, values: undeclaredValues } }]), line).card).toMatchObject({ kind: `running` });
    });

    it('with an opt-out, offer nothing and say so', () => {
        expect(headOf(list([], true), line)).toEqual({ choices: [], card: { kind: `opted-out` } });
    });

    it('say a game past the turn cap, or with no turn played, cannot be read whole', () => {
        expect(headOf(list([]), longLine(analysisTurnCap + 1)).card).toEqual({ kind: `unreadable`, why: `too-long` });
        expect(headOf(list([]), longLine(analysisTurnCap)).card).toEqual({ kind: `none` });
        expect(headOf(list([]), gameLineOf(judgedCells.slice(0, 5), 5)).card).toEqual({ kind: `unreadable`, why: `unplayed` });
    });
});

describe('what a reading says of an analyzer whose owner played', () => {
    const players: GamePlayers = {
        x: { name: `hextide`, rating: 1690, provisional: false, kind: `bot` },
        o: { name: `mika`, rating: 1500, provisional: false, kind: `user` },
    };
    const by = (name: string) => ({ name, version: null, ownerName: `ana`, values: undeclaredValues });

    it('name the analyzer when it played itself, and a player\'s analyzer otherwise', () => {
        expect(involvedNote(community({ involved: true, analyzer: by(`hextide`) }), players)).toBe(`hextide played in this game`);
        expect(involvedNote(community({ involved: true, analyzer: by(`pebble`) }), players)).toBe(`Read by an analyzer of a player in this game`);
    });

    it('say nothing of an independent reading', () => {
        expect(involvedNote(community({ analyzer: by(`hextide`) }), players)).toBe(null);
    });
});

describe('where a game\'s readings and a request stand', () => {
    const ready: AnalysesState = analysesStep(initialAnalyses, { kind: `loaded`, list: list(ownViews) });

    it('read a list in, and keep it through a later read that fails', () => {
        expect(ready.load).toEqual({ kind: `ready`, list: list(ownViews) });
        expect(analysesStep(initialAnalyses, { kind: `load-failed` }).load).toEqual({ kind: `failed` });
        expect(analysesStep(ready, { kind: `load-failed` })).toBe(ready);
    });

    it('hold a request while it is out, then add it to the list at once when queued', () => {
        const sending = analysesStep(ready, { kind: `sending` });
        expect(sending.request).toEqual({ kind: `sending` });
        const done = analysesStep(sending, { kind: `queued`, analysis: queued });
        expect(done.request).toEqual({ kind: `idle` });
        expect(done.load).toEqual({ kind: `ready`, list: list([...ownViews, queued]) });
        // A list read meanwhile that already holds it keeps one copy.
        const again = analysesStep(analysesStep(done, { kind: `loaded`, list: list([queued]) }), { kind: `queued`, analysis: queued });
        expect(again.load).toEqual({ kind: `ready`, list: list([queued]) });
    });

    it('keep a refusal with its wait until the next request', () => {
        const refused = analysesStep(ready, { kind: `refused`, code: `analysis_limit`, retryAfter: 600 });
        expect(refused.request).toEqual({ kind: `refused`, code: `analysis_limit`, retryAfter: 600 });
        expect(analysesStep(refused, { kind: `sending` }).request).toEqual({ kind: `sending` });
    });

    it('poll only while a community reading is queued or running', () => {
        expect(underWay(initialAnalyses)).toBe(false);
        expect(underWay(ready)).toBe(false);
        expect(underWay(analysesStep(ready, { kind: `queued`, analysis: queued }))).toBe(true);
        expect(underWay(analysesStep(initialAnalyses, { kind: `loaded`, list: list([running]) }))).toBe(true);
        expect(underWay(analysesStep(initialAnalyses, { kind: `loaded`, list: list([community(), failed]) }))).toBe(false);
    });

    it('word a refusal by its code, signed out and paused by their status, and anything else as the generic one', () => {
        expect(refusalOf(401, `unauthorized`)).toBe(`signed_out`);
        expect(refusalOf(503, `paused`)).toBe(`paused`);
        expect(refusalOf(409, `analysis_pending`)).toBe(`analysis_pending`);
        expect(refusalOf(429, `analysis_queue_full`)).toBe(`analysis_queue_full`);
        expect(refusalOf(409, `game_live`)).toBe(`unavailable`);
        expect(refusalOf(0, null)).toBe(`unavailable`);
    });
});
