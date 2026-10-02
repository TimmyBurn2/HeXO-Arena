import { analysisTurnCap } from './analysis';
import type { AxialCoord } from './board';
import type { HtttxPositionEvaluation } from './htttx';
import type { Side } from './stream';

/** How bad a judged turn was, mildest first. */
export type JudgmentSeverity = `inaccuracy` | `mistake` | `blunder`;

/**
 * Why a turn was judged: it let the mover's forced win go,
 * it handed the opponent one, or it gave up value.
 */
export type JudgmentReason = `missed-win` | `allowed-win` | `value-drop`;

/** One analyzer's verdict on one played turn. */
export interface Judgment {
    readonly severity: JudgmentSeverity;
    readonly reason: JudgmentReason;
}

/** The mark printed beside a judged turn. */
export const judgmentGlyphs: Readonly<Record<JudgmentSeverity, string>> = {
    inaccuracy: `?!`,
    mistake: `?`,
    blunder: `??`,
};

/**
 * The least loss of the mover's value, on the -1 to 1 scale, that earns each severity:
 * lichess's cuts on its winning-chance scale, which htttx's default heuristic shares.
 */
export const judgmentDrops: Readonly<Record<JudgmentSeverity, number>> = {
    inaccuracy: 0.1,
    mistake: 0.2,
    blunder: 0.3,
};

/**
 * Where a forced win given up or handed over stops being a blunder:
 * a missed win is an inaccuracy if the mover's value after it is still at least the first cut,
 * a mistake if at least the second; an allowed win is judged the same way on the value before it, negated.
 * They are lichess's 999 and 700 centipawns on its winning-chance curve.
 */
export const forcedWinCuts: Readonly<Record<Exclude<JudgmentSeverity, `blunder`>, number>> = {
    inaccuracy: 0.95,
    mistake: 0.86,
};

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

/** One analyzer's readings around a played turn. */
export interface TurnReadings {
    /** Its lines at the position the turn was played from, best first; empty when it read none. */
    readonly before: readonly EvaluatedLine[];
    /** The evaluation of its best line at the position after the turn, if it read one. */
    readonly nextBest: HtttxPositionEvaluation | null;
}

/** The side a forced win in an evaluation belongs to, if it names one. */
export function forcedWinner(evaluation: HtttxPositionEvaluation): Side | null {
    const winIn = evaluation.win_in;
    if (winIn === undefined || winIn === 0) return null;
    return winIn > 0 ? `x` : `o`;
}

/**
 * An evaluation from `side`'s view, rounded to hundredths as it is shown:
 * 1 or -1 for a forced win or loss, else the heuristic clamped to -1 to 1;
 * null when the evaluation holds neither.
 */
export function sideValue(evaluation: HtttxPositionEvaluation, side: Side): number | null {
    const hundredths = sideHundredths(evaluation, side);
    return hundredths === null ? null : hundredths / 100;
}

/**
 * Judge one played turn against one analyzer's readings, lichess's way.
 * The value before is the best line's at the position played from;
 * the value after is the played turn's own when the analyzer listed it, in either stone order,
 * else that of the best line at the position after.
 * Never judged, so null: opening turns, a turn that completes six,
 * turns past the analysis cap, and turns missing either reading.
 * The caller keeps variations and a bot's view of its own turns away, since neither is a judgment.
 */
export function judgeTurn(played: PlayedTurn, readings: TurnReadings): Judgment | null {
    if (played.opening || played.completesSix || played.turn > analysisTurnCap) return null;
    const best = readings.before[0];
    const listed = readings.before.find((line) => sameCells(line.cells, played.cells));
    const afterEvaluation = listed?.evaluation ?? readings.nextBest;
    if (best === undefined || afterEvaluation === null) return null;
    const before = sideHundredths(best.evaluation, played.side);
    const after = sideHundredths(afterEvaluation, played.side);
    if (before === null || after === null) return null;
    const mover = played.side;
    const opponent: Side = mover === `x` ? `o` : `x`;
    const forcedBefore = forcedWinner(best.evaluation);
    const forcedAfter = forcedWinner(afterEvaluation);
    if (forcedBefore === forcedAfter && forcedBefore !== null) return null;
    if (forcedBefore === mover) return { severity: forcedSeverity(after), reason: `missed-win` };
    if (forcedAfter === opponent) return { severity: forcedSeverity(-before), reason: `allowed-win` };
    const drop = before - after;
    const severity = severestFirst.find((each) => drop >= hundredthsOf(judgmentDrops[each]));
    return severity === undefined ? null : { severity, reason: `value-drop` };
}

/**
 * How a view of the board reads: `board` for an evaluation of the position shown,
 * `line` for one of a turn `mover` would play from it.
 */
export type ValueView =
    | { readonly kind: `board` }
    | { readonly kind: `line`; readonly mover: Side; readonly completesSix: boolean };

/**
 * An evaluation in words: `x 0.52`, `even` when it rounds to zero, `o wins in 3`,
 * or `x wins` for a line that completes six; null when it holds no value.
 * A heuristic beyond 1 prints as it is.
 * A forced win counts the winner's own turns from the position shown,
 * the line itself when the winner plays it.
 */
export function valueWords(evaluation: HtttxPositionEvaluation, view: ValueView): string | null {
    if (view.kind === `line` && view.completesSix) return `${view.mover} wins`;
    const winner = forcedWinner(evaluation);
    if (winner !== null) {
        // The board after a line has the other side to move; from either
        // board the winner moves on alternate turns, so half the count,
        // rounded up, is its own, plus the line when it is the winner's.
        const n = Math.abs(evaluation.win_in ?? 0);
        const own = Math.ceil(n / 2) + (view.kind === `line` && view.mover === winner ? 1 : 0);
        return `${winner} wins in ${String(own)}`;
    }
    const heuristic = evaluation.heuristic;
    if (heuristic === undefined || !Number.isFinite(heuristic)) return null;
    const shown = rounded(heuristic);
    if (shown === 0) return `even`;
    return `${shown > 0 ? `x` : `o`} ${(Math.abs(shown) / 100).toFixed(2)}`;
}

const severestFirst: readonly JudgmentSeverity[] = [`blunder`, `mistake`, `inaccuracy`];

// Values compare in whole hundredths, the precision they are shown at, so a
// cut never falls between what a reader sees and what was judged.
function sideHundredths(evaluation: HtttxPositionEvaluation, side: Side): number | null {
    const sign = side === `x` ? 1 : -1;
    const winner = forcedWinner(evaluation);
    if (winner !== null) return (winner === `x` ? 100 : -100) * sign;
    const heuristic = evaluation.heuristic;
    if (heuristic === undefined || !Number.isFinite(heuristic)) return null;
    return rounded(Math.max(-1, Math.min(1, heuristic))) * sign;
}

function forcedSeverity(value: number): JudgmentSeverity {
    if (value >= hundredthsOf(forcedWinCuts.inaccuracy)) return `inaccuracy`;
    if (value >= hundredthsOf(forcedWinCuts.mistake)) return `mistake`;
    return `blunder`;
}

// Half a hundredth rounds away from zero, so x and o values mirror exactly.
function rounded(value: number): number {
    return Math.sign(value) * Math.round(Math.abs(value) * 100);
}

function hundredthsOf(cut: number): number {
    return Math.round(cut * 100);
}

function sameCells(a: readonly AxialCoord[], b: readonly AxialCoord[]): boolean {
    return a.length === b.length && a.every((cell) => b.some((other) => other.x === cell.x && other.y === cell.y));
}
