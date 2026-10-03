import type { ReactNode } from 'react';
import type { Side } from '@hexo-arena/contract';
import { DiscordButton } from '../components/DiscordButton';
import { Swatch } from '../components/player';
import { refusalWords, StatusCard, type Asker } from '../game/DrawerAnalysis';
import type { AnalysesState, ReadingChoice, RequestCard } from '../game/game-analyses';
import { text } from '../text';
import type { Explanation, PreferredLine } from './explain';
import { GameGraph } from './GameGraph';
import type { GameLine, GameReading } from './game-readings';
import { JudgmentChip } from './Judgment';
import { AnalyzerHead, HeldLine, heldNote, Lines, Trouble, unreadableText, type AnalyzerShown, type ReadingPill, type ShownEntry, type Unreadable } from './ReadingPanel';
import type { ShownLine } from './reading-view';

const words = text.analysis.window;
const reading = text.analysis.reading;

/** The position shown as the analyzer window reads it: who reads it, where that stands, its lines, and why none can come. */
export interface WindowReading {
    readonly analyzer: AnalyzerShown;
    readonly entry: ShownEntry;
    readonly lines: readonly ShownLine[];
    /** Whether line A's place is kept for a reading on its way. */
    readonly held: boolean;
    readonly toMove: Side;
    readonly unreadable: Unreadable | null;
}

/**
 * The analyzer window over the move list: its head names the analyzer and where its reading stands,
 * and says so when the analyzer's owner played in the stored game whose reading it shows,
 * beside the Analyze switch and the settings gear; then the readings to pick from,
 * a stored game's course as a graph or where a reading of it stands, each side's marks,
 * the explanation of the turn shown, and line A with the others folded.
 * On a phone it folds into a strip of the graph, the switch, and the gear, the explanation one paragraph under it.
 * Signed out, stored readings still show; only asking needs a sign-in.
 */
export function AnalyzerWindow({ signedIn, analyzing, onAnalyzing, settings, shown, involved, pills, activePill, onPill, graph, card, counts, explanation, onPreview, onPlay, onPreferred, onPlayPreferred, onAsk, wait }: {
    // Null until the page knows who the person is.
    signedIn: boolean | null;
    analyzing: boolean;
    onAnalyzing: (on: boolean) => void;
    settings: ReactNode;
    shown: WindowReading;
    // What the head and the explanation say of a reading by an analyzer whose owner played, where each shows that reading.
    involved: { readonly head: string | null; readonly explanation: string | null };
    pills: readonly ReadingPill[];
    activePill: string | null;
    onPill: (pill: ReadingPill) => void;
    graph: ReactNode;
    card: ReactNode;
    counts: ReactNode;
    explanation: Explanation | null;
    onPreview: (line: ShownLine | null) => void;
    onPlay: (line: ShownLine) => void;
    onPreferred: (line: PreferredLine | null) => void;
    onPlayPreferred: (line: PreferredLine) => void;
    onAsk: () => void;
    // Seconds until the day's readings come back, for a refusal that names none.
    wait: (seconds: number | null) => string;
}) {
    const { analyzer, entry, lines, held, toMove, unreadable } = shown;
    const { read, state } = entry;
    const own = analyzer.kind === `own`;
    const trouble = state.kind === `refused` || state.kind === `failed` ? state : null;
    // Nothing read here, nothing on its way, nothing gone wrong: the head says how to have it read.
    const silent = read === null && !held && trouble === null && !own;
    let who: ReactNode = null;
    if (unreadable !== null) who = <p className="an-win-quiet">{unreadableText(unreadable)}</p>;
    else if (silent && signedIn !== null) who = <p className="an-win-quiet">{signedIn ? reading.off : reading.signedOut}</p>;
    else if (signedIn !== null) {
        who = (
            <>
                <AnalyzerHead analyzer={analyzer} entry={entry} analyzing={analyzing} toMove={toMove} />
                {involved.head === null ? null : <p className="an-win-quiet an-involved">{involved.head}</p>}
            </>
        );
    }
    const troubled = trouble === null || unreadable !== null ? null : <Trouble state={trouble} analyzer={analyzer} onAsk={onAsk} wait={wait} />;
    // A reading in hand stays, whatever became of a later ask.
    const lineRow = lines.length > 0 ? <Lines lines={lines} toMove={toMove} onPreview={onPreview} onPlay={onPlay} /> : held ? <HeldLine toMove={toMove} note={heldNote(analyzer, entry, analyzing)} /> : null;
    // The head says why to sign in; a phone's strip, holding the graph in the head's place, leaves it to this row.
    const signIn =
        signedIn === false && silent && unreadable === null ? (
            <div className="an-win-sign-in">
                <p className="note an-win-sign-in-words">{reading.signedOut}</p>
                <DiscordButton />
            </div>
        ) : null;
    return (
        <section className="an-window" aria-label={words.label} data-graph={graph === null ? undefined : ``}>
            <div className="an-win-who">{who}</div>
            <div className="an-win-end">
                {signedIn === true ? (
                    <label className="checkline an-switch">
                        <input
                            type="checkbox"
                            role="switch"
                            checked={analyzing}
                            onChange={(event) => {
                                onAnalyzing(event.target.checked);
                            }}
                        />
                        {reading.analyze}
                    </label>
                ) : null}
                {settings}
            </div>
            {pills.length > 1 ? (
                <div className="pills an-pills" role="group" aria-label={reading.readings}>
                    {pills.map((pill) => (
                        <button
                            key={pill.id}
                            type="button"
                            className={`pill${pill.id === activePill ? ` active` : ``}`}
                            aria-pressed={pill.id === activePill}
                            onClick={() => {
                                onPill(pill);
                            }}
                        >
                            {pill.name}
                        </button>
                    ))}
                </div>
            ) : null}
            {graph === null ? null : <div className="an-win-graph">{graph}</div>}
            {card === null ? null : <div className="an-win-card">{card}</div>}
            {counts === null ? null : <div className="an-win-counts">{counts}</div>}
            {explanation === null ? null : <Bubble explanation={explanation} involved={involved.explanation} onPreferred={onPreferred} onPlay={onPlayPreferred} />}
            {troubled}
            {lineRow}
            {signIn}
        </section>
    );
}

// The explanation of the turn shown, edged in its severity's color: a head and the text under it,
// or on a phone one paragraph, the verdict or the turn's name joined to the text;
// under either, whether the analyzer's owner played.
function Bubble({ explanation, involved, onPreferred, onPlay }: {
    explanation: Explanation;
    involved: string | null;
    onPreferred: (line: PreferredLine | null) => void;
    onPlay: (line: PreferredLine) => void;
}) {
    const { severity, verdict, title, head, joiner, text: said, inline, line, tail } = explanation;
    if (title === null && said === ``) return null;
    // The text as it stands alone under the head, or as it runs on after the verdict on a phone.
    const preferred = (opening: string) => (
        <>
            {opening}
            {line === null ? null : (
                <>
                    {` `}
                    <button
                        type="button"
                        className="an-pref"
                        aria-label={words.playPreferred(line.words)}
                        onPointerEnter={() => {
                            onPreferred(line);
                        }}
                        onPointerLeave={() => {
                            onPreferred(null);
                        }}
                        onFocus={() => {
                            onPreferred(line);
                        }}
                        onBlur={() => {
                            onPreferred(null);
                        }}
                        onClick={() => {
                            onPreferred(null);
                            onPlay(line);
                        }}
                    >
                        {line.words}
                    </button>
                </>
            )}
            {tail}
        </>
    );
    const chip = severity === null ? null : <JudgmentChip severity={severity} spoken={false} />;
    // The severity word takes its mark's color, the reason after it the text's.
    const named =
        verdict === null ? (
            head
        ) : (
            <>
                <span className="an-bubble-severity">{verdict.severity}</span>
                {verdict.reason}
            </>
        );
    return (
        <div className={severity === null ? `an-bubble` : `an-bubble an-bubble-${severity}`} role="status">
            <div className="an-bubble-full">
                <p className="an-bubble-head">
                    {chip}
                    <span className="an-bubble-title">{named}</span>
                    {title === null ? null : <span className="an-bubble-meta">{head}</span>}
                </p>
                {said === `` ? null : <p className="an-bubble-text">{preferred(said)}</p>}
            </div>
            <p className="an-bubble-flat">
                {chip}
                <span>
                    <strong className="an-bubble-title">{named}</strong>
                    {said === `` ? null : (
                        <>
                            {joiner}
                            {preferred(inline)}
                        </>
                    )}
                </span>
            </p>
            {involved === null ? null : <p className="an-bubble-involved">{involved}</p>}
        </div>
    );
}

/**
 * A stored game's course as the window draws it: the reading picked, from the board after the opening to the last turn,
 * x ahead above the middle and o below, keyed by each side's swatch and named by what its values mean;
 * a press goes to the turn under it.
 */
export function CourseGraph({ view, choice, line, cursor, onTurn }: { view: GameReading; choice: ReadingChoice; line: GameLine; cursor: number; onTurn: (turn: number) => void }) {
    const last = line.lastTurn;
    return (
        <>
            <GameGraph
                reading={view}
                first={line.firstTurn - 1}
                last={last}
                cursor={cursor}
                label={choice.kind === `own` ? text.drawer.reading.ownGraph(last) : text.drawer.reading.graph(choice.name, last)}
                variant="full"
                onTurn={onTurn}
            />
            <span className="an-graph-key an-graph-key-x" aria-hidden="true">
                <Swatch side="x" />
            </span>
            <span className="an-graph-key an-graph-key-o" aria-hidden="true">
                <Swatch side="o" />
            </span>
            <span className="an-graph-meaning">{words.meaning[view.meaning]}</span>
        </>
    );
}

/**
 * Where a reading of a stored game stands, in the graph's place or under it: none yet, with a request and what is left of the day's;
 * otherwise waiting, under way, failed, refused by an opt-out, or out of reach, as the game panel says it.
 */
export function GameRequest({ card, state, asker, analyzer, onRequest }: {
    card: RequestCard;
    state: AnalysesState;
    asker: Asker;
    // The analyzer the settings name, which a request asks for; null for any.
    analyzer: string | null;
    onRequest: (analyzer: string | null) => void;
}) {
    if (card.kind !== `none`) return <StatusCard card={card} state={state} asker={asker} onRequest={onRequest} />;
    const sending = state.request.kind === `sending`;
    const refused = state.request.kind === `refused` ? state.request : null;
    return (
        <div className="an-request">
            <p className="an-request-text">
                <span className="an-request-title">{words.noReading}</span>
                {asker.kind === `user` ? <span>{words.requestsLeft(asker.left)}</span> : null}
            </p>
            {asker.kind === `user` && asker.left > 0 ? (
                // Held, not disabled, while the request is out, so focus stays on it.
                <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-disabled={sending ? `true` : undefined}
                    onClick={() => {
                        if (!sending) onRequest(analyzer);
                    }}
                >
                    {text.drawer.reading.request}
                </button>
            ) : null}
            {refused === null ? null : (
                <p className="field-error" role="alert">
                    {refusalWords(refused.code, refused.retryAfter, analyzer)}
                </p>
            )}
        </div>
    );
}
