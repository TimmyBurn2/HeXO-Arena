import type { AxialCoord, ForcedWinsAround, Judgment, JudgmentRun, JudgmentSeverity, Side, ValueText } from '@hexo-arena/contract';
import { text } from '../text';
import { turnLines, type GameLine, type TurnRead } from './game-readings';
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
 * the value after it, the forced wins around it, and its verdict where the whole game was read and judged;
 * or a bot's own view of the turn it played.
 */
export type ExplainedReading =
    | { readonly kind: `none` }
    | {
          readonly kind: `analyzer`;
          readonly name: string;
          /** Its line A at the position the turn was played from. */
          readonly best: ShownLine | null;
          readonly after: ValueText | null;
          readonly judgment: Judgment | null;
          /** Whether the reading covers the whole game and judged it, as a running or missing one has not. */
          readonly whole: boolean;
          /** The forced wins before and after the turn, as the board and the reading hold them; null where unknown. */
          readonly forced: ForcedWinsAround | null;
          /** On a value drop, how far the mover's value fell, in words, as the analyzer's values show. */
          readonly drop: string | null;
      }
    | { readonly kind: `own`; readonly name: string; readonly after: ValueText | null };

/** What a reading of a whole game, by `analyzer`, says of one of its turns; `whole` once the reading is done and judged. */
export function turnReading(line: GameLine, read: TurnRead, analyzer: string, whole: boolean): ExplainedReading {
    return { kind: `analyzer`, name: analyzer, best: turnLines(line, read)[0] ?? null, after: read.value, judgment: read.judgment, whole, forced: read.forced, drop: read.drop };
}

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
 * `joiner` joins the verdict, or the name where there is none, to `inline`, the text as it runs on after it.
 */
export interface Explanation {
    readonly severity: JudgmentSeverity | null;
    /** The verdict in its two parts, the severity word and the reason after it, as "Blunder" and ": left a six". */
    readonly verdict: { readonly severity: string; readonly reason: string } | null;
    readonly title: string | null;
    readonly head: string;
    readonly joiner: string;
    readonly text: string;
    readonly inline: string;
    readonly line: PreferredLine | null;
    readonly tail: string;
}

/**
 * The explanation of a turn from one reading, as a named analyzer's opinion.
 * A judged turn says why: the win it gave away, the six or the win it missed, the six it left or the win it allowed,
 * or how far its value fell; then the line the analyzer preferred.
 * An unjudged one says what the forced wins around it show, still winning, already lost, or a win found;
 * else that it was the analyzer's first choice, or its values before and after.
 * A six names its winner; a variation is never judged; a game's turn waits for the whole game to be read;
 * a bot's own view gives the value it set on its own turn.
 * Values keep their side and number together on one line.
 */
export function explain(turn: ExplainedTurn, reading: ExplainedReading): Explanation {
    if (turn.kind === `opening`) return plain(words.openingHead, words.opening, true);
    const head = turn.place === `variation` ? words.variationHead(turn.turn) : turn.player === null ? words.boardHead(turn.turn) : words.gameHead(turn.turn, turn.player);
    if (turn.completesSix) return plain(head, words.six(turn.side));
    // A bot's own view names the bot, so the turn goes by its number alone.
    if (reading.kind === `own`) return plain(turn.place === `variation` ? head : words.boardHead(turn.turn), reading.after === null ? `` : words.own(reading.name, valueText(reading.after)));
    if (turn.place === `variation`) {
        const after = reading.kind === `analyzer` ? reading.after : null;
        return after === null ? plain(head, words.variationUnread, true) : plain(head, words.variation(valueText(after)));
    }
    const pending = turn.place === `game` && (reading.kind === `none` || !reading.whole);
    if (reading.kind === `none` || reading.after === null) return plain(head, pending ? words.unread : ``, true);
    const mover = turn.side;
    const opponent: Side = mover === `x` ? `o` : `x`;
    const after = valueText(reading.after);
    const best = reading.best;
    const before = best === null ? null : valueText(best.value);
    const line = best === null ? null : preferredLine(mover, best);
    const { name, judgment, forced } = reading;
    if (judgment !== null) {
        const said = judgedText(judgment, name, mover, opponent, forced, reading.drop, before, after);
        return {
            ...plain(head, line === null ? said.text : `${said.text}${said.preferred}`, said.common),
            severity: judgment.severity,
            verdict: { severity: words.severity(judgment.severity), reason: words.reason(judgment) },
            title: words.title(judgment),
            joiner: words.joiner(judgment.reason !== `value-drop`),
            line,
        };
    }
    const tail = `${pending ? words.unjudged : ``}${words.end}`;
    const known = forced ?? { before: null, after: null };
    if (known.before?.winner === opponent) return { ...plain(head, words.alreadyLost(name, opponent)), tail };
    if (known.before?.winner === mover && known.after?.winner === mover) return { ...plain(head, words.stillWinning(name, known.after.turns, mover)), tail };
    if (known.before === null && known.after?.winner === mover) return { ...plain(head, words.foundWin(name, known.after.turns, mover), true), tail };
    if (best === null || before === null) return { ...plain(head, words.afterOnly(after)), tail };
    if (sameCells(best.cells, turn.cells)) return { ...plain(head, words.firstChoice(after, name)), tail };
    return { ...plain(head, `${words.values(before, after)}${words.namedPreferred(name)}`), line, tail };
}

// A judged turn's sentence, and how it names the line its analyzer preferred, which follows where the reading gives one.
function judgedText(
    judgment: Judgment,
    name: string,
    mover: Side,
    opponent: Side,
    forced: ForcedWinsAround | null,
    drop: string | null,
    before: string | null,
    after: string,
): { readonly text: string; readonly preferred: string; readonly common: boolean } {
    switch (judgment.reason) {
        case `gave-away-win`:
            return { text: words.gaveAway(name, mover, forced?.before?.turns ?? 1, opponent, judgment.turns), preferred: words.itPreferred, common: false };
        case `missed-win`:
            return judgment.turns === 1
                ? { text: words.missedSix(mover), preferred: words.namedPreferred(name), common: false }
                : { text: words.missedWin(name, judgment.turns, mover), preferred: words.itPreferred, common: false };
        case `allowed-win`:
            return judgment.turns === 1
                ? { text: words.leftSix(opponent), preferred: words.namedPreferred(name), common: true }
                : { text: words.allowedWin(name, judgment.turns, opponent), preferred: words.itPreferred, common: true };
        case `value-drop`:
            return drop === null || before === null
                ? { text: words.afterOnly(after), preferred: words.namedPreferred(name), common: false }
                : { text: words.valueDrop(name, drop, before, after), preferred: words.itPreferred, common: false };
    }
}

/** A run of turns that each let a win go or handed one over, as the list folds it under one note. */
export interface RunNote {
    readonly title: string;
    readonly text: string;
}

/** The note a run folds under: its turns, and that `analyzer` marks every one of them. */
export function explainRun(run: JudgmentRun, analyzer: string): RunNote {
    return { title: words.run(run.from, run.to), text: words.runText(analyzer, run.to - run.from + 1) };
}

/** An explanation on one line: its verdict or what names the turn, then its text as it runs on, the preferred line written out. */
export function explanationSentence(explanation: Explanation): string {
    return `${explanation.title ?? explanation.head}${explanation.joiner}${explanation.inline}${preferredAndTail(explanation)}`;
}

/** An explanation's text alone, the preferred line written out. */
export function explanationText(explanation: Explanation): string {
    return `${explanation.text}${preferredAndTail(explanation)}`;
}

function preferredAndTail(explanation: Explanation): string {
    return `${explanation.line === null ? `` : ` ${explanation.line.words}`}${explanation.tail}`;
}

/** A judged turn's verdict as it heads a row or a note: "Mistake", or "Blunder: left a six". */
export function verdictTitle(judgment: Judgment): string {
    return words.title(judgment);
}

/** A judged turn's verdict as a line runs on: "mistake", or "left a six". */
export function verdictInLine(judgment: Judgment): string {
    return words.inLine(judgment);
}

// A sentence that opens with a common word starts with a capital where it stands alone, and runs on in lower case after a verdict;
// one that opens with a name or a value keeps it as written.
function plain(head: string, said: string, common = false): Explanation {
    const text = common ? `${said.charAt(0).toUpperCase()}${said.slice(1)}` : said;
    return { severity: null, verdict: null, title: null, head, joiner: words.joiner(false), text, inline: said, line: null, tail: said === `` ? `` : words.end };
}

function preferredLine(side: Side, best: ShownLine): PreferredLine {
    return { side, cells: best.cells, words: text.analysis.reading.cells(side, [best.cellsText]) };
}

// A value's side stays with its number, so "x 0.12" never breaks between them.
function valueText(value: ValueText): string {
    return text.drawer.reading.value(value.shown);
}

function sameCells(a: readonly AxialCoord[], b: readonly AxialCoord[]): boolean {
    return a.length === b.length && a.every((cell) => b.some((other) => other.x === cell.x && other.y === cell.y));
}
