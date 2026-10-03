import { analysisTurnCap, type AnalyzerValues } from './analysis';
import type { AxialCoord } from './board';
import type { HtttxPositionEvaluation } from './htttx';
import type { Side } from './stream';

/** How bad a judged turn was, mildest first. */
export type JudgmentSeverity = `inaccuracy` | `mistake` | `blunder`;

/**
 * Why a turn was judged by a forced win: it let the mover's own go and handed the opponent one,
 * it let the mover's own go, or it handed the opponent one from a board where neither held one.
 */
export type ForcedJudgmentReason = `gave-away-win` | `missed-win` | `allowed-win`;

/** Why a turn was judged: a forced win, or a drop of value by the analyzer's own cuts. */
export type JudgmentReason = ForcedJudgmentReason | `value-drop`;

/**
 * One analyzer's verdict on one played turn.
 * `turns` is the length, in its winner's own turns, of the forced win that grades the turn:
 * the mover's, let go, on a missed win; the opponent's, after the turn, otherwise.
 */
export type Judgment =
    | { readonly severity: JudgmentSeverity; readonly reason: ForcedJudgmentReason; readonly turns: number }
    | { readonly severity: JudgmentSeverity; readonly reason: `value-drop`; readonly turns: null };

/** The mark printed beside a judged turn. */
export const judgmentGlyphs: Readonly<Record<JudgmentSeverity, string>> = {
    inaccuracy: `?!`,
    mistake: `?`,
    blunder: `??`,
};

/**
 * The longest forced win, in the mover's own turns, whose loss is still a blunder, and still a mistake;
 * a longer one lost is an inaccuracy.
 * A short win is plain to see, and a long one may be the analyzer's assumption.
 */
export const missedWinTurns = { blunder: 1, mistake: 2 } as const;

/** The longest forced win, in the opponent's own turns, whose allowing is still a blunder; a longer one allowed is a mistake. */
export const allowedWinBlunderTurns = 2;

/** The least drop of the mover's scaled value, on the -1 to 1 range, that earns each severity. */
export type JudgmentCuts = Readonly<Record<JudgmentSeverity, number>>;

/**
 * lichess's cuts, on its winning-chance scale:
 * they suit an analyzer whose values are `expected`, its estimate of x's expected result.
 * htttx promises its heuristic's sign and drawing range, not that scale.
 */
export const winChanceCuts: JudgmentCuts = { inaccuracy: 0.1, mistake: 0.2, blunder: 0.3 };

/** What an analyzer that declared nothing gets: scale 1, no value drop judged, and raw values. */
export const undeclaredValues: Readonly<AnalyzerValues> = { scale: 1, cuts: null, meaning: `raw` };

/** A candidate turn and the evaluation of the board after it, x-positive, as htttx defines it. */
export interface EvaluatedLine {
    readonly cells: readonly AxialCoord[];
    readonly evaluation: HtttxPositionEvaluation;
}

/** A played turn of a game's main line, as judging needs it. */
export interface PlayedTurn {
    readonly turn: number;
    readonly side: Side;
    readonly cells: readonly AxialCoord[];
    /** Placed by the server's opening, not chosen by the mover. */
    readonly opening: boolean;
    readonly completesSix: boolean;
}

/**
 * What the board itself says around a played turn, alike under every analyzer.
 * The caller reads it with the rules engine, which the contract does not depend on.
 */
export interface BoardFacts {
    /** The mover could complete six with this turn. */
    readonly sixOnBoard: boolean;
    /** The turn left the opponent a six to complete. */
    readonly sixLeft: boolean;
    /** Before the turn, the opponent held sixes that no two stones could all block. */
    readonly sixesUnblockable: boolean;
}

/** One analyzer's readings around a played turn, the board's facts, and how the analyzer's values read. */
export interface TurnReadings {
    /** Its lines at the position the turn was played from, best first; empty when it read none. */
    readonly before: readonly EvaluatedLine[];
    /** The evaluation of its best line at the position after the turn, if it read one. */
    readonly nextBest: HtttxPositionEvaluation | null;
    readonly board: BoardFacts;
    /** How the analyzer declared its heuristic reads: `scale` is divided out before a value is judged, and null `cuts` judge no drop. */
    readonly values: AnalyzerValues;
}

/** A forced win, and its length in the winner's own turns. */
export interface ForcedWin {
    readonly winner: Side;
    readonly turns: number;
}

/** The forced wins around a played turn: the one held at the position it was played from, and the one at the position after. */
export interface ForcedWinsAround {
    readonly before: ForcedWin | null;
    readonly after: ForcedWin | null;
}

/** The side a forced win in an evaluation belongs to, if it names one. */
export function forcedWinner(evaluation: HtttxPositionEvaluation): Side | null {
    const winIn = evaluation.win_in;
    if (winIn === undefined || winIn === 0) return null;
    return winIn > 0 ? `x` : `o`;
}

/**
 * How a view of the board reads: `board` for an evaluation of the position shown,
 * `line` for one of a turn `mover` would play from it.
 */
export type ValueView =
    | { readonly kind: `board` }
    | { readonly kind: `line`; readonly mover: Side; readonly completesSix: boolean };

/**
 * The forced win an evaluation names, in its winner's own turns from the position shown.
 * htttx counts win_in from the board the evaluation describes, its side to move first:
 * from a board the winner moves on alternate turns, so half the count, rounded up, is its own;
 * a line's evaluation describes the board after it, so the winner's own line adds that line,
 * and a line that completes six, or carries win_in 1 for its own mover, is a win in 1.
 */
export function forcedWin(evaluation: HtttxPositionEvaluation, view: ValueView): ForcedWin | null {
    if (view.kind === `line` && view.completesSix) return { winner: view.mover, turns: 1 };
    const winner = forcedWinner(evaluation);
    if (winner === null) return null;
    const count = Math.abs(evaluation.win_in ?? 0);
    if (view.kind === `line` && view.mover === winner) return { winner, turns: count === 1 ? 1 : 1 + Math.ceil(count / 2) };
    return { winner, turns: Math.ceil(count / 2) };
}

/**
 * An evaluation from `side`'s view, rounded to hundredths as judging compares it:
 * 1 or -1 for a forced win or loss, else the heuristic divided by `scale` and held to -1 to 1;
 * null when the evaluation holds neither.
 */
export function sideValue(evaluation: HtttxPositionEvaluation, side: Side, scale = 1): number | null {
    const hundredths = sideHundredths(evaluation, side, scale);
    return hundredths === null ? null : hundredths / 100;
}

/**
 * The forced wins around a played turn, from the board's facts first and the analyzer's win_in after them.
 * Before: a six the mover can complete is its win in 1; else sixes the opponent holds that no two stones block are the opponent's;
 * else the best line's win_in.
 * After: a six left to the opponent is its win in 1; else the win_in of the played turn's own evaluation
 * when the analyzer listed the turn, in either stone order, or of the best line at the position after.
 * Null while either reading is missing.
 */
export function forcedWinsAround(played: Pick<PlayedTurn, `side` | `cells`>, readings: TurnReadings): ForcedWinsAround | null {
    const read = readAround(played, readings);
    return read === null ? null : forcedOf(read, played.side, readings.board);
}

/**
 * Judge one played turn against one analyzer's readings.
 * Forced wins judge every analyzer alike, graded by their length:
 * a side already lost is never blamed, and a turn that keeps a forced win, however slow, gets no mark;
 * letting a win go while handing the opponent one is a blunder;
 * letting one go is graded by `missedWinTurns`, handing one over by `allowedWinBlunderTurns`.
 * Otherwise a drop of value is judged only by the cuts the analyzer declared, on its declared scale.
 * Never judged, so null: opening turns, a turn that completes six,
 * turns past the analysis cap, and turns missing either reading.
 * The caller keeps variations and a bot's view of its own turns away, since neither is a judgment.
 */
export function judgeTurn(played: PlayedTurn, readings: TurnReadings): Judgment | null {
    if (played.opening || played.completesSix || played.turn > analysisTurnCap) return null;
    const read = readAround(played, readings);
    if (read === null) return null;
    const mover = played.side;
    const { before, after } = forcedOf(read, mover, readings.board);
    if (before !== null) {
        if (before.winner !== mover || after?.winner === mover) return null;
        if (after !== null) return { severity: `blunder`, reason: `gave-away-win`, turns: after.turns };
        return { severity: missedWinSeverity(before.turns), reason: `missed-win`, turns: before.turns };
    }
    if (after !== null) {
        if (after.winner === mover) return null;
        return { severity: after.turns <= allowedWinBlunderTurns ? `blunder` : `mistake`, reason: `allowed-win`, turns: after.turns };
    }
    return valueDrop(read.best.evaluation, read.after.evaluation, mover, readings.values);
}

/** A run of consecutive judged turns, both sides', each marked for a forced win: its first and last turn. */
export interface JudgmentRun {
    readonly from: number;
    readonly to: number;
}

/** The fewest consecutive turns that make a run. */
export const judgmentRunMin = 3;

/**
 * The runs among a game's judged turns: `judgmentRunMin` or more consecutive turns, both sides', each with a forced mark,
 * as when each side in turn lets a win go or hands one over.
 * Every turn keeps its own mark and counts; a run only lets a list fold them under one note.
 */
export function judgmentRuns(turns: Iterable<{ readonly turn: number; readonly judgment: Judgment | null }>): JudgmentRun[] {
    const forced = [...turns].flatMap((each) => (each.judgment === null || each.judgment.reason === `value-drop` ? [] : [each.turn])).sort((a, b) => a - b);
    const runs: JudgmentRun[] = [];
    let from: number | null = null;
    for (const [index, turn] of forced.entries()) {
        from ??= turn;
        if (forced[index + 1] === turn + 1) continue;
        if (turn - from + 1 >= judgmentRunMin) runs.push({ from, to: turn });
        from = null;
    }
    return runs;
}

/** A value in words: as it shows, and as a screen reader says it. */
export interface ValueText {
    readonly shown: string;
    readonly spoken: string;
}

/**
 * An evaluation in words, as `values` declare its heuristic reads; null when it holds no value.
 * A forced win counts the winner's own turns from the position shown, the line itself when the winner plays it:
 * `o wins in 3`, or `x wins` for a line that completes six.
 * A heuristic is divided by its scale and held to -1 to 1.
 * An expected one shows the leading side's win chance, (1 + v) / 2, in whole percent: `x 67%`,
 * spoken `x's win chance 67 percent`; never 100, which only a forced win is.
 * A raw one shows the side it favors and its size in hundredths: `o 0.33`.
 * Either reads `even` where it rounds to no lead.
 */
export function valueWords(evaluation: HtttxPositionEvaluation, view: ValueView, values: AnalyzerValues): ValueText | null {
    if (view.kind === `line` && view.completesSix) return said(`${view.mover} wins`);
    const winner = forcedWinner(evaluation);
    if (winner !== null) {
        // The board after a line has the other side to move; from either
        // board the winner moves on alternate turns, so half the count,
        // rounded up, is its own, plus the line when it is the winner's.
        const n = Math.abs(evaluation.win_in ?? 0);
        const own = Math.ceil(n / 2) + (view.kind === `line` && view.mover === winner ? 1 : 0);
        return said(`${winner} wins in ${String(own)}`);
    }
    const value = scaledHeuristic(evaluation, values.scale);
    if (value === null) return null;
    if (values.meaning === `expected`) {
        const chance = leadingChance(value);
        if (chance === null) return said(`even`);
        return { shown: `${chance.side} ${String(chance.percent)}%`, spoken: `${chance.side}'s win chance ${String(chance.percent)} percent` };
    }
    const shown = rounded(value);
    if (shown === 0) return said(`even`);
    return said(`${shown > 0 ? `x` : `o`} ${(Math.abs(shown) / 100).toFixed(2)}`);
}

/**
 * How far `side`'s value fell from `best` to `after`, in words, as `valueWords` shows the two:
 * points of the side's win chance between its whole percents, `6 points`, where the values are expected;
 * hundredths of the scaled value, `0.12`, where they are raw.
 * Null when either holds no value.
 */
export function valueDropWords(best: HtttxPositionEvaluation, after: HtttxPositionEvaluation, side: Side, values: AnalyzerValues): string | null {
    if (values.meaning === `raw`) {
        const before = sideHundredths(best, side, values.scale);
        const now = sideHundredths(after, side, values.scale);
        return before === null || now === null ? null : ((before - now) / 100).toFixed(2);
    }
    const before = sideChance(best, side, values.scale);
    const now = sideChance(after, side, values.scale);
    if (before === null || now === null) return null;
    const points = before - now;
    return `${String(points)} ${Math.abs(points) === 1 ? `point` : `points`}`;
}

function said(words: string): ValueText {
    return { shown: words, spoken: words };
}

// The heuristic divided by its scale and held to -1 to 1, where its analyzer calls a position decided.
function scaledHeuristic(evaluation: HtttxPositionEvaluation, scale: number): number | null {
    const heuristic = evaluation.heuristic;
    if (heuristic === undefined || !Number.isFinite(heuristic)) return null;
    return Math.max(-1, Math.min(1, heuristic / scale));
}

// The highest win chance a heuristic shows, as only a forced win is certain.
const winChanceShownMax = 99;

// The leading side's win chance for an expected value, in whole percent, half a percent rounding away from 50;
// null where it rounds to 50, which is no lead.
function leadingChance(value: number): { readonly side: Side; readonly percent: number } | null {
    const percent = Math.min(winChanceShownMax, Math.round(50 + 50 * Math.abs(value)));
    return percent === 50 ? null : { side: value > 0 ? `x` : `o`, percent };
}

// `side`'s win chance in whole percent, as the leader's shows it: a forced win is certain.
function sideChance(evaluation: HtttxPositionEvaluation, side: Side, scale: number): number | null {
    const winner = forcedWinner(evaluation);
    if (winner !== null) return winner === side ? 100 : 0;
    const value = scaledHeuristic(evaluation, scale);
    if (value === null) return null;
    const chance = leadingChance(value);
    if (chance === null) return 50;
    return chance.side === side ? chance.percent : 100 - chance.percent;
}

const severestFirst: readonly JudgmentSeverity[] = [`blunder`, `mistake`, `inaccuracy`];

// The best line at the position played from, and the evaluation after the
// turn with the view it reads from: the played turn's own, of the board
// after it, or the next mover's best line.
interface Read {
    readonly best: EvaluatedLine;
    readonly after: { readonly evaluation: HtttxPositionEvaluation; readonly view: ValueView };
}

function readAround(played: Pick<PlayedTurn, `side` | `cells`>, readings: TurnReadings): Read | null {
    const best = readings.before[0];
    if (best === undefined) return null;
    const listed = readings.before.find((line) => sameCells(line.cells, played.cells));
    if (listed !== undefined) return { best, after: { evaluation: listed.evaluation, view: { kind: `board` } } };
    if (readings.nextBest === null) return null;
    return { best, after: { evaluation: readings.nextBest, view: { kind: `line`, mover: otherSide(played.side), completesSix: false } } };
}

// Board facts first, alike for every analyzer; the analyzer's win_in after them.
function forcedOf(read: Read, mover: Side, board: BoardFacts): ForcedWinsAround {
    const opponent = otherSide(mover);
    const before = board.sixOnBoard
        ? { winner: mover, turns: 1 }
        : board.sixesUnblockable
          ? { winner: opponent, turns: 1 }
          : forcedWin(read.best.evaluation, { kind: `line`, mover, completesSix: false });
    const after = board.sixLeft ? { winner: opponent, turns: 1 } : forcedWin(read.after.evaluation, read.after.view);
    return { before, after };
}

function missedWinSeverity(turns: number): JudgmentSeverity {
    if (turns <= missedWinTurns.blunder) return `blunder`;
    return turns <= missedWinTurns.mistake ? `mistake` : `inaccuracy`;
}

function valueDrop(best: HtttxPositionEvaluation, after: HtttxPositionEvaluation, side: Side, values: AnalyzerValues): Judgment | null {
    const cuts = values.cuts;
    if (cuts === null) return null;
    const before = sideHundredths(best, side, values.scale);
    const now = sideHundredths(after, side, values.scale);
    if (before === null || now === null) return null;
    const drop = before - now;
    const severity = severestFirst.find((each) => drop >= hundredthsOf(cuts[each]));
    return severity === undefined ? null : { severity, reason: `value-drop`, turns: null };
}

// Values compare in whole hundredths, the precision a raw value shows, so a
// cut never falls between what a reader sees and what was judged.
function sideHundredths(evaluation: HtttxPositionEvaluation, side: Side, scale: number): number | null {
    const sign = side === `x` ? 1 : -1;
    const winner = forcedWinner(evaluation);
    if (winner !== null) return (winner === `x` ? 100 : -100) * sign;
    const value = scaledHeuristic(evaluation, scale);
    return value === null ? null : rounded(value) * sign;
}

// Half a hundredth rounds away from zero, so x and o values mirror exactly.
function rounded(value: number): number {
    return Math.sign(value) * Math.round(Math.abs(value) * 100);
}

function hundredthsOf(cut: number): number {
    return Math.round(cut * 100);
}

function otherSide(side: Side): Side {
    return side === `x` ? `o` : `x`;
}

function sameCells(a: readonly AxialCoord[], b: readonly AxialCoord[]): boolean {
    return a.length === b.length && a.every((cell) => b.some((other) => other.x === cell.x && other.y === cell.y));
}
