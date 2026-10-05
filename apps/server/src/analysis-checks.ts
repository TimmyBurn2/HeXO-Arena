import {
    analysisHeuristicLimit,
    analysisWinInLimit,
    wireToInternal,
    type AnalysisFailure,
    type AnalysisLine,
    type HtttxMoveOption,
    type HtttxPositionEvaluation,
} from '@hexo-arena/contract';
import { IndexedBoard, otherPlayer, type Coord, type Player, type Setup } from '@hexo-arena/rules';

// What an analyzer's answer comes to: its lines, best first, or why the reading fails.
type CheckedReading =
    | { readonly ok: true; readonly lines: readonly AnalysisLine[] }
    | { readonly ok: false; readonly failure: Extract<AnalysisFailure, `no_evaluation` | `illegal` | `inconsistent`> };

// The parts of a move_response a reading is made of.
interface ReadingAnswer {
    readonly move: HtttxMoveOption;
    readonly considerations?: readonly HtttxMoveOption[] | undefined;
}

type LineFault = `illegal` | `inconsistent`;

// A line as the checks judge it, and whether it ended the game.
type PlayedLine =
    | { readonly ok: true; readonly line: AnalysisLine; readonly completesSix: boolean }
    | { readonly ok: false; readonly fault: LineFault | `no_evaluation` };

/**
 * An analyzer's answer at `setup`, checked by the rules alone:
 * the move and the first `lines - 1` considerations that carry an evaluation,
 * each a legal turn for the side to move, none repeated,
 * each evaluation within bounds and consistent with the board.
 * A considered line without an evaluation is left out; a move without one fails the reading.
 */
export function checkReading(setup: Setup, answer: ReadingAnswer, lines: number): CheckedReading {
    const kept = [answer.move, ...(answer.considerations ?? []).filter((option) => evaluationOf(option.evaluation) !== null).slice(0, lines - 1)];
    // Indexed once, so each line is judged without walking the board again.
    const board = new IndexedBoard(setup.stones);
    const played: AnalysisLine[] = [];
    for (const [rank, option] of kept.entries()) {
        const line = playLine(board, setup.toMove, option);
        if (!line.ok) return { ok: false, failure: line.fault };
        // A side that can complete six this turn would; a best line that does not misreads the board.
        if (rank === 0 && !line.completesSix && board.winsThisTurn(setup.toMove)) return { ok: false, failure: `inconsistent` };
        if (played.some((other) => samePair(other.cells, line.line.cells))) return { ok: false, failure: `illegal` };
        played.push(line.line);
    }
    return { ok: true, lines: played };
}

/**
 * A bot's own view of the turn it played on `board`, `mover` to move: its move first, then up to
 * `considerations` of the lines it considered, each kept only when it passes
 * the checks a reading meets, the move's own choice aside.
 * Null when the move's evaluation is missing or fails them, since a view
 * leads with the turn played; a bad opinion is dropped, never punished.
 */
export function ownLines(board: IndexedBoard, mover: Player, answer: ReadingAnswer, considerations: number): readonly AnalysisLine[] | null {
    const move = playLine(board, mover, answer.move);
    if (!move.ok) return null;
    const kept: AnalysisLine[] = [move.line];
    for (const option of answer.considerations ?? []) {
        if (kept.length > considerations) break;
        const line = playLine(board, mover, option);
        if (line.ok && !kept.some((other) => samePair(other.cells, line.line.cells))) kept.push(line.line);
    }
    return kept;
}

function playLine(board: IndexedBoard, mover: Player, option: HtttxMoveOption): PlayedLine {
    const evaluation = evaluationOf(option.evaluation);
    if (evaluation === null) return { ok: false, fault: `no_evaluation` };
    if (evaluation === `out_of_bounds`) return { ok: false, fault: `inconsistent` };
    const [first, second] = option.pieces.map((piece) => wireToInternal(piece));
    if (first === undefined || second === undefined || (first.x === second.x && first.y === second.y)) return { ok: false, fault: `illegal` };
    const line: AnalysisLine = { cells: [first, second], ...evaluation };
    const opening = board.judgeTurn(mover, [first]);
    if (opening.ok) return favoursMover(line, mover) ? { ok: true, line, completesSix: true } : { ok: false, fault: `inconsistent` };
    if (opening.rejection.kind !== `turn-unfinished`) return { ok: false, fault: `illegal` };
    const turn = board.judgeTurn(mover, [first, second]);
    if (!turn.ok) return { ok: false, fault: `illegal` };
    if (turn.win !== null) return favoursMover(line, mover) ? { ok: true, line, completesSix: true } : { ok: false, fault: `inconsistent` };
    return consistentAfter(line, board, mover, [first, second]) ? { ok: true, line, completesSix: false } : { ok: false, fault: `inconsistent` };
}

// An evaluation in the site's terms: null when it holds no value, and
// out_of_bounds when it holds one past the limits.
function evaluationOf(evaluation: HtttxPositionEvaluation | undefined): Pick<AnalysisLine, `heuristic` | `winIn`> | `out_of_bounds` | null {
    if (evaluation === undefined) return null;
    const { heuristic, win_in: winIn } = evaluation;
    if (heuristic === undefined && winIn === undefined) return null;
    if (heuristic !== undefined && !(Math.abs(heuristic) <= analysisHeuristicLimit)) return `out_of_bounds`;
    if (winIn !== undefined && (winIn === 0 || Math.abs(winIn) > analysisWinInLimit)) return `out_of_bounds`;
    return { ...(heuristic === undefined ? {} : { heuristic }), ...(winIn === undefined ? {} : { winIn }) };
}

// x counts positive, as htttx's evaluations do.
function signOf(player: Player): 1 | -1 {
    return player === 0 ? 1 : -1;
}

function favoursMover(line: AnalysisLine, mover: Player): boolean {
    if (line.winIn !== undefined) return Math.sign(line.winIn) === signOf(mover);
    return (line.heuristic ?? 0) * signOf(mover) > 0;
}

// After a line that ends no game, the side then to move takes the odd turns
// of a forced win; it wins at once exactly when it holds a window to fill,
// and a board where it does is never the mover's.
function consistentAfter(line: AnalysisLine, board: IndexedBoard, mover: Player, cells: readonly Coord[]): boolean {
    const toMove = otherPlayer(mover);
    const winsNow = board.winsThisTurnAfter(toMove, cells);
    const winNow = signOf(toMove);
    if (line.winIn !== undefined) {
        const winner: Player = line.winIn > 0 ? 0 : 1;
        if ((Math.abs(line.winIn) % 2 === 1) !== (winner === toMove)) return false;
        return winsNow ? line.winIn === winNow : line.winIn !== winNow;
    }
    return !winsNow || (line.heuristic ?? 0) * signOf(mover) <= 0;
}

function samePair(a: readonly Coord[], b: readonly Coord[]): boolean {
    return a.length === b.length && a.every((cell) => b.some((other) => other.x === cell.x && other.y === cell.y));
}
