import { analysisCoordLimit, analysisStoneCap, type AxialCoord, type BotListing, type GamePlayers, type JudgmentSeverity, type Side } from '@hexo-arena/contract';
import type { Setup } from '@hexo-arena/rules';
import { seatName } from '../components/player';
import { involvedNote, type ReadingChoice, type RequestCard } from '../game/game-analyses';
import { text } from '../text';
import { explain, explainRun, turnReading, type ExplainedTurn, type Explanation } from './explain';
import { ownSourceId, turnCells, type GameLine, type GameReading } from './game-readings';
import type { ListFold } from './MoveList';
import type { ReadingEntry } from './readings';
import type { AnalyzerList, AnalyzerShown, ReadingPill, Unreadable } from './ReadingPanel';
import { shownLines } from './reading-view';
import { rowFacts, type RowFact } from './row-facts';
import { authorSourceId, botSourceId, type Reading, type ReadingAuthor } from './sources';
import { floorOf } from './state';
import { nodeAt, openingTurns, positionAt, type MoveTree, type NodeId, type TreeNode, type TurnNode } from './tree';

/** The pill of the bots' own views, which no analyzer setting names. */
export const ownPill = `own`;

/** A source's reading of a position, by the position's key and the source's id, from the readings held. */
export type ReadingLookup = (key: string, sourceId: string) => Reading | null;

/** Why an analyzer cannot read a position, if it cannot; `half` names a half-turn's lone stone, after which no whole turn stands to read. */
export function unreadableOf(position: Setup, won: boolean, half: { readonly side: Side; readonly cell: AxialCoord } | null = null): Unreadable | null {
    if (won) return { kind: `won` };
    if (half !== null) return { kind: `half`, side: half.side, cell: half.cell };
    if (position.stones.length > analysisStoneCap) return { kind: `too-many`, stones: position.stones.length };
    if (position.stones.some((stone) => Math.abs(stone.x) > analysisCoordLimit || Math.abs(stone.y) > analysisCoordLimit)) return { kind: `too-far` };
    return null;
}

/** The analyzer the settings name, as the list of analyzers has it. */
export function listingOf(analyzers: AnalyzerList, analyzer: string | null): BotListing | undefined {
    return analyzer === null || analyzers.kind !== `ready` ? undefined : analyzers.bots.find((bot) => bot.name === analyzer);
}

/**
 * The reading pills, and the one lit: each named analyzer that read the position, a stored game's readers,
 * and the analyzer the settings name, by name; the bots' own views last, where the game holds them.
 * The pill lit is the own views' while they show, else the settings' analyzer's, or, asking any, the one that answered.
 */
export function readingPills({ entries, analyzerId, analyzer, stored, ownViews, ownView }: {
    // What each source holds for the position shown, by source id.
    entries: ReadonlyMap<string, ReadingEntry>;
    // The source the panel asks.
    analyzerId: string;
    // The analyzer the settings name; null for any.
    analyzer: string | null;
    // The analyzers whose readings a stored game holds.
    stored: readonly string[];
    // Whether a stored game holds the bots' own views, and whether they show.
    ownViews: boolean;
    ownView: boolean;
}): { readonly pills: ReadingPill[]; readonly active: string | null } {
    const anyId = botSourceId(null);
    const read = entries.get(analyzerId)?.read ?? null;
    const analyzerPill = analyzerId === anyId ? (read === null ? null : authorSourceId(read.reading)) : analyzerId;
    const pills: ReadingPill[] = [];
    const addPill = (pill: ReadingPill) => {
        if (!pills.some((each) => each.id === pill.id)) pills.push(pill);
    };
    for (const [id, held] of entries) {
        const by = held.read?.reading.by;
        if (id !== anyId && by?.kind === `bot`) addPill({ id, name: by.name });
    }
    // A stored game's readers keep their pills on every turn, so the row holds still as the board steps.
    for (const name of stored) addPill({ id: botSourceId(name), name });
    if (analyzerPill !== null && analyzer !== null) addPill({ id: analyzerPill, name: analyzer });
    // By name, so a pill stays put as readings arrive; the own views last.
    pills.sort((a, b) => a.name.localeCompare(b.name));
    if (ownViews) pills.push({ id: ownPill, name: text.analysis.reading.ownView });
    return { pills, active: ownView ? ownPill : analyzerPill };
}

/**
 * Who the panel says reads the position shown: whoever wrote the reading in hand; else the seat to move, for its own view;
 * else any analyzer, or the one the settings name, offline once the list of analyzers says it is not ready.
 */
export function analyzerShownOf({ read, ownView, ownBot, toMove, analyzer, analyzers, seconds }: {
    read: Reading | null;
    ownView: boolean;
    // The bot in the seat to move, whose own view shows; null for a person.
    ownBot: string | null;
    toMove: Side;
    // The analyzer the settings name; null for any.
    analyzer: string | null;
    analyzers: AnalyzerList;
    // The look a reading is asked for.
    seconds: number;
}): AnalyzerShown {
    if (read !== null) return authorShown(read.by, read.seconds);
    if (ownView) return { kind: `own`, name: ownBot, side: toMove };
    if (analyzer === null) return { kind: `any`, seconds };
    const listing = listingOf(analyzers, analyzer);
    if (analyzers.kind === `ready` && listing?.analyzer?.ready !== true) return { kind: `offline`, name: analyzer };
    return { kind: `named`, name: analyzer, version: listing?.version ?? null, ownerName: listing?.ownerName ?? null, seconds };
}

/**
 * The source a row away from a stored game's own turns reads, by the side to move there:
 * the one behind the game's reading picked, else the analyzer the panel asks.
 */
export function rowSource(active: ReadingChoice | null, gameId: string | null, analyzerId: string): (side: Side) => string {
    return (side) => (active === null || gameId === null ? analyzerId : active.kind === `community` ? botSourceId(active.name) : ownSourceId(gameId, side));
}

/**
 * The move list's facts: on a stored game's own turns, what the game's reading picked says, and nothing where it says nothing;
 * on every other turn, what the row's source read around it.
 */
export function listFacts({ tree, read, sourceFor, view, gameNodes }: {
    tree: MoveTree;
    read: ReadingLookup;
    sourceFor: (side: Side) => string;
    view: GameReading | null;
    gameNodes: readonly TurnNode[];
}): Map<NodeId, RowFact> {
    const all = rowFacts(tree, read, sourceFor);
    if (view === null) return all;
    for (const node of gameNodes) {
        const turn = view.turns.get(node.turn);
        if (turn === undefined || (turn.value === null && turn.judgment === null)) all.delete(node.id);
        else all.set(node.id, { judgment: turn.judgment, value: turn.value });
    }
    return all;
}

/** A community reading's runs of marked turns, each folded in the move list after its first turn. */
export function listFolds(view: GameReading | null, active: ReadingChoice | null, gameNodes: readonly TurnNode[]): ListFold[] {
    if (view === null || active?.kind !== `community`) return [];
    const idOf = new Map(gameNodes.map((node) => [node.turn, node.id]));
    return view.runs.flatMap((run) => {
        const first = idOf.get(run.from);
        if (first === undefined) return [];
        const hidden = Array.from({ length: run.to - run.from }, (_, index) => idOf.get(run.from + 1 + index)).filter((id) => id !== undefined);
        return [{ first, hidden, ...explainRun(run, active.name) }];
    });
}

/** The turn shown explained, and whether a stored game's community reading is the one that says it. */
export interface ShownExplanation {
    readonly explanation: Explanation;
    readonly community: boolean;
}

/**
 * The turn shown explained from the reading its row's value comes from:
 * a stored game's drawn opening as such; a game's own turn from the game's reading picked;
 * any other turn from what the same source read around it.
 */
export function explainShown({ tree, at, players, gameId, onGame, card, view, active, line, read, sourceFor, facts }: {
    tree: MoveTree;
    at: NodeId;
    // A stored game's seats; null on any other board.
    players: GamePlayers | null;
    gameId: string | null;
    // The stored game's own turns, by node.
    onGame: ReadonlyMap<NodeId, number>;
    card: RequestCard | null;
    view: GameReading | null;
    active: ReadingChoice | null;
    line: GameLine | null;
    read: ReadingLookup;
    sourceFor: (side: Side) => string;
    facts: ReadonlyMap<NodeId, RowFact>;
}): ShownExplanation | null {
    const plainly = (explanation: Explanation) => ({ explanation, community: false });
    if (players !== null && at === floorOf(tree) && openingTurns(tree.root) > 0) return plainly(explain({ kind: `opening` }, { kind: `none` }));
    const node = nodeAt(tree, at);
    if (node?.kind !== `turn`) return null;
    const ownTurn = onGame.has(node.id);
    // A game no reading may judge whole, opted out or out of an analyzer's reach, waits for none.
    const judgeable = card?.kind !== `opted-out` && card?.kind !== `unreadable`;
    const place = gameId === null ? `board` : !ownTurn ? `variation` : judgeable ? `game` : `board`;
    const player = ownTurn && players !== null ? seatName(players[node.side]) : null;
    const turn: ExplainedTurn = { kind: `turn`, turn: node.turn, side: node.side, cells: node.cells, completesSix: node.win !== null, place, player };
    if (ownTurn && view !== null && active !== null && line !== null) {
        const turnRead = view.turns.get(node.turn);
        if (active.kind === `own`) return plainly(explain(turn, { kind: `own`, name: player ?? ``, after: turnRead?.value ?? null }));
        if (turnRead === undefined) return plainly(explain(turn, { kind: `none` }));
        // A six speaks for itself, whoever read the game.
        return { explanation: explain(turn, turnReading(line, turnRead, active.name, active.analysis.status === `done`)), community: !turn.completesSix };
    }
    const parent = nodeAt(tree, node.parent);
    const readAt = (key: string, side: Side) => read(key, sourceFor(side));
    const before = parent === undefined ? null : readAt(parent.key, node.side);
    const after = facts.get(node.id)?.value ?? null;
    const by = before?.by ?? readAt(node.key, node.side === `x` ? `o` : `x`)?.by ?? null;
    if (by === null || (before === null && after === null)) return plainly(explain(turn, { kind: `none` }));
    if (by.kind === `own`) return plainly(explain(turn, { kind: `own`, name: by.name, after }));
    const best = before === null ? null : (shownLines(before, positionAt(tree, node.parent), node.side, 1)[0] ?? null);
    return plainly(explain(turn, { kind: `analyzer`, name: authorName(by), best, after, judgment: null, whole: false, forced: null, drop: null }));
}

/**
 * What the panel says of a stored game's community reading by an analyzer whose owner played:
 * in the head while the head names that analyzer, and under the explanation while the explanation is the reading's.
 */
export function involvedNotes({ active, players, analyzer, ownView, explained }: {
    active: ReadingChoice | null;
    players: GamePlayers | null;
    analyzer: AnalyzerShown;
    ownView: boolean;
    explained: ShownExplanation | null;
}): { readonly head: string | null; readonly explanation: string | null } {
    const words = active?.kind === `community` && players !== null ? involvedNote(active.analysis, players) : null;
    const headName = analyzer.kind === `named` || analyzer.kind === `offline` ? analyzer.name : null;
    const headNamesActive = !ownView && active?.kind === `community` && headName === active.name;
    return { head: headNamesActive ? words : null, explanation: explained?.community === true ? words : null };
}

/** The mark a stored game's reading sets on the turn shown, beside its last stone, where the turn is the game's own and judged. */
export function judgedMark({ node, onGame, view, line }: {
    node: TreeNode | undefined;
    onGame: ReadonlyMap<NodeId, number>;
    view: GameReading | null;
    line: GameLine | null;
}): { readonly cell: AxialCoord; readonly severity: JudgmentSeverity } | null {
    if (node?.kind !== `turn` || !onGame.has(node.id) || line === null) return null;
    const judgment = view?.turns.get(node.turn)?.judgment ?? null;
    if (judgment === null) return null;
    const cell = turnCells(line, node.turn).at(-1);
    return cell === undefined ? null : { cell, severity: judgment.severity };
}

// The panel's line for a reading in hand, by whose opinion it is.
function authorShown(by: ReadingAuthor, seconds: number): AnalyzerShown {
    switch (by.kind) {
        case `bot`:
            return { kind: `named`, name: by.name, version: by.version, ownerName: by.ownerName, seconds };
        case `own`:
            return { kind: `own`, name: by.name, side: by.side };
        case `worker`:
            return { kind: `engine`, name: by.engine, version: by.version, seconds };
    }
}

// The name a reading goes by in an explanation: the analyzer's, the bot's for its own view, the engine's.
function authorName(by: ReadingAuthor): string {
    switch (by.kind) {
        case `bot`:
        case `own`:
            return by.name;
        case `worker`:
            return by.engine;
    }
}
