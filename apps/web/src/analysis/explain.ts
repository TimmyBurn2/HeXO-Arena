import type { AxialCoord, Judgment, JudgmentSeverity, Side } from '@hexo-arena/contract';
import { text } from '../text';
import type { ShownLine } from './reading-view';

const words = text.analysis.explain;

/**
 * A turn as its explanation names it: the opening a game drew, or a played turn,
 * on a game's own line that a reading of the whole game judges or will, on a variation off a game,
 * or on a board no such reading can judge.
 */
export type ExplainedTurn =
    | { readonly kind: `opening` }
    | {
          readonly kind: `turn`;
          readonly turn: number;
          readonly side: Side;
          readonly cells: readonly AxialCoord[];
          readonly completesSix: boolean;
          readonly place: `game` | `variation` | `board`;
          /** Who played the turn, where a game says; null otherwise. */
          readonly player: string | null;
      };

/**
 * What one reading says around a turn: nothing; an analyzer's lines at the position it was played from,
 * the value after it, and its verdict where the whole game was read and judged;
 * or a bot's own view of the turn it played.
 */
export type ExplainedReading =
    | { readonly kind: `none` }
    | {
          readonly kind: `analyzer`;
          readonly name: string;
          /** Its line A at the position the turn was played from. */
          readonly best: ShownLine | null;
          readonly after: string | null;
          readonly judgment: Judgment | null;
          /** Whether the reading covers the whole game and judged it, as a running or missing one has not. */
          readonly whole: boolean;
      }
    | { readonly kind: `own`; readonly name: string; readonly after: string | null };

/** The line an analyzer preferred to a turn, which the explanation names and offers to play. */
export interface PreferredLine {
    readonly side: Side;
    readonly cells: ShownLine[`cells`];
    /** As the explanation writes it: `x: [-3,4] [-3,3]`. */
    readonly words: string;
}

/**
 * A turn explained: its verdict where it was judged, what names the turn, and the text,
 * which holds the preferred line, where it names one, between `text` and `tail`.
 * `joiner` joins the verdict, or the name where there is none, to the text on one line.
 */
export interface Explanation {
    readonly severity: JudgmentSeverity | null;
    /** The verdict in its two parts, the severity word and the reason after it, as "Blunder" and ": allowed a forced win". */
    readonly verdict: { readonly severity: string; readonly reason: string } | null;
    readonly title: string | null;
    readonly head: string;
    readonly joiner: string;
    readonly text: string;
    readonly line: PreferredLine | null;
    readonly tail: string;
}

/**
 * The explanation of a turn from one reading, as a named analyzer's opinion:
 * a judged turn's verdict, then the values before and after it and the line the analyzer preferred;
 * a turn it would have played itself, its first choice; a six, its winner;
 * a variation, never judged; a game's turn before the whole game is read, not judged yet;
 * a bot's own view, the value it gave its own turn.
 * Values keep their side and number together on one line.
 */
export function explain(turn: ExplainedTurn, reading: ExplainedReading): Explanation {
    if (turn.kind === `opening`) return plain(words.openingHead, words.opening);
    const head = turn.place === `variation` ? words.variationHead(turn.turn) : turn.player === null ? words.boardHead(turn.turn) : words.gameHead(turn.turn, turn.player);
    if (turn.completesSix) return plain(head, words.six(turn.side));
    // A bot's own view names the bot, so the turn goes by its number alone.
    if (reading.kind === `own`) return plain(turn.place === `variation` ? head : words.boardHead(turn.turn), reading.after === null ? `` : words.own(reading.name, valueText(reading.after)));
    if (turn.place === `variation`) {
        const after = reading.kind === `analyzer` ? reading.after : null;
        return plain(head, after === null ? words.variationUnread : words.variation(valueText(after)));
    }
    const pending = turn.place === `game` && (reading.kind === `none` || !reading.whole);
    if (reading.kind === `none` || reading.after === null) return plain(head, pending ? words.unread : ``);
    const after = valueText(reading.after);
    const best = reading.best;
    if (reading.judgment !== null) {
        const { severity, reason } = reading.judgment;
        return {
            severity,
            verdict: { severity: words.severity(severity), reason: words.reason(reason) },
            title: words.title(severity, reason),
            head,
            joiner: words.joiner(reason !== `value-drop`),
            text: best === null ? words.afterOnly(after) : words.preferred(valueText(best.value), after, reading.name),
            line: best === null ? null : preferredLine(turn.side, best),
            tail: ``,
        };
    }
    const tail = pending ? words.unjudged : ``;
    if (best === null) return plain(head, `${words.afterOnly(after)}${tail}`);
    if (sameCells(best.cells, turn.cells)) return plain(head, `${words.firstChoice(after, reading.name)}${tail}`);
    return { ...plain(head, words.preferred(valueText(best.value), after, reading.name)), line: preferredLine(turn.side, best), tail };
}

/** An explanation on one line: its verdict or what names the turn, then its text, the preferred line written out. */
export function explanationSentence(explanation: Explanation): string {
    return `${explanation.title ?? explanation.head}${explanation.joiner}${explanationText(explanation)}`;
}

/** An explanation's text alone, the preferred line written out. */
export function explanationText(explanation: Explanation): string {
    return `${explanation.text}${explanation.line === null ? `` : ` ${explanation.line.words}`}${explanation.tail}`;
}

/** A judged turn's verdict as it heads a row or a note: "Mistake", or "Blunder: allowed a forced win". */
export function verdictTitle(judgment: Judgment): string {
    return words.title(judgment.severity, judgment.reason);
}

/** A judged turn's verdict as a line runs on: "mistake", or "allowed a forced win". */
export function verdictInLine(judgment: Judgment): string {
    return words.inLine(judgment.severity, judgment.reason);
}

function plain(head: string, said: string): Explanation {
    return { severity: null, verdict: null, title: null, head, joiner: words.joiner(false), text: said, line: null, tail: `` };
}

function preferredLine(side: Side, best: ShownLine): PreferredLine {
    return { side, cells: best.cells, words: text.analysis.reading.cells(side, [best.cellsText]) };
}

// A value's side stays with its number, so "x 0.12" never breaks between them.
function valueText(value: string): string {
    return text.drawer.reading.value(value);
}

function sameCells(a: readonly AxialCoord[], b: readonly AxialCoord[]): boolean {
    return a.length === b.length && a.every((cell) => b.some((other) => other.x === cell.x && other.y === cell.y));
}
