import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { GamePlayers, JudgmentSeverity, Side, ValueText } from '@hexo-arena/contract';
import { GameGraph } from '../analysis/GameGraph';
import { verdictInLine } from '../analysis/explain';
import { JudgmentChip } from '../analysis/Judgment';
import { SpokenText } from '../analysis/SpokenText';
import { useAnalysisSettings } from '../analysis/analysis-settings';
import type { GameLine, GameReading } from '../analysis/game-readings';
import { useAnalyzers } from '../analysis/use-analyzers';
import { BoardToggles } from '../board/BoardToggles';
import { DiscordButton } from '../components/DiscordButton';
import { BotBadge, seatName, Swatch } from '../components/player';
import { nextUtcDay } from '../analysis/readings';
import { text } from '../text';
import { involvedNote, type AnalysesState, type AnalysisHeadState, type ReadingChoice, type RequestCard, type RequestRefusal } from './game-analyses';
import './DrawerAnalysis.css';

const words = text.drawer.reading;
const judged = text.analysis.judged;
const sides = [`x`, `o`] as const satisfies readonly Side[];
const severities = [`inaccuracy`, `mistake`, `blunder`] as const satisfies readonly JudgmentSeverity[];

/** Who the person is, as far as asking for a reading goes. */
export type Asker = { readonly kind: `unknown` } | { readonly kind: `signed-out` } | { readonly kind: `user`; readonly left: number };

/**
 * The Moves tab's head on a finished game: the readings to pick from, who read the one shown,
 * the board's switches, its graph and the marks per side, and what is said of asking for a reading.
 * It never asks for anything on its own: a reading is requested only by the button.
 */
export function ReadingHead({ state, head, active, onChoose, view, line, players, cursor, asker, onRequest, onRetry, onTurn }: {
    state: AnalysesState;
    head: AnalysisHeadState | null;
    active: ReadingChoice | null;
    onChoose: (id: string) => void;
    view: GameReading | null;
    line: GameLine;
    players: GamePlayers;
    cursor: number;
    asker: Asker;
    onRequest: (analyzer: string | null) => void;
    onRetry: () => void;
    onTurn: (turn: number) => void;
}) {
    const [settings, updateSettings] = useAnalysisSettings();
    const card = head?.card ?? null;
    const statusRef = useRef<HTMLDivElement>(null);
    const [asked, setAsked] = useState(false);
    const request = (analyzer: string | null) => {
        setAsked(true);
        onRequest(analyzer);
    };
    // A request taken replaces its button with the card that says where it
    // stands, so the keyboard lands there rather than on the page; a refused
    // one keeps its button, which kept focus.
    const outcome = state.request.kind;
    useEffect(() => {
        if (!asked || outcome === `sending`) return;
        if (outcome === `idle`) statusRef.current?.focus();
        setAsked(false);
    }, [asked, outcome]);
    // A status card speaks under the analyzer's line; the invitation to ask comes after the graph it would fill.
    const status =
        card !== null && card.kind !== `none` ? (
            <div className="dr-status" ref={statusRef} tabIndex={-1}>
                <StatusCard card={card} state={state} asker={asker} onRequest={request} />
            </div>
        ) : null;
    return (
        <div className="dr-reading">
            {head !== null && head.choices.length > 0 ? <Pills choices={head.choices} active={active} onChoose={onChoose} /> : null}
            {active === null ? null : <ReadingBy choice={active} players={players} />}
            {status}
            <div className="dr-toggles">
                {card?.kind === `opted-out` ? null : (
                    <label className="checkline">
                        <input
                            type="checkbox"
                            role="switch"
                            checked={settings.boardLines}
                            onChange={(event) => {
                                updateSettings({ boardLines: event.target.checked });
                            }}
                        />
                        {text.analysis.settings.boardLines}
                    </label>
                )}
                <BoardToggles />
            </div>
            {state.load.kind === `loading` ? <p className="note dr-quiet">{words.loading}</p> : null}
            {state.load.kind === `failed` ? (
                <p className="dr-failed">
                    <span className="field-error">{words.loadFailed}</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
                        {text.states.tryAgain}
                    </button>
                </p>
            ) : null}
            {view === null || active === null ? null : (
                <ReadingGraph view={view} choice={active} line={line} cursor={cursor} onTurn={onTurn} />
            )}
            {view !== null && active?.kind === `community` && active.analysis.status === `done` ? <Marks view={view} players={players} /> : null}
            {card?.kind === `none` ? <RequestBlock state={state} asker={asker} onRequest={request} /> : null}
        </div>
    );
}

function Pills({ choices, active, onChoose }: { choices: readonly ReadingChoice[]; active: ReadingChoice | null; onChoose: (id: string) => void }) {
    return (
        <div className="pills dr-pills" role="group" aria-label={words.readings}>
            {choices.map((choice) => (
                <button
                    key={choice.id}
                    type="button"
                    className={`pill${choice.id === active?.id ? ` active` : ``}`}
                    aria-pressed={choice.id === active?.id}
                    onClick={() => {
                        onChoose(choice.id);
                    }}
                >
                    {choice.kind === `own` ? words.own : choice.name}
                </button>
            ))}
        </div>
    );
}

function ReadingBy({ choice, players }: { choice: ReadingChoice; players: GamePlayers }) {
    if (choice.kind === `own`) return <p className="note dr-by-note">{words.ownNote}</p>;
    const analyzer = choice.analysis.analyzer;
    const involved = involvedNote(choice.analysis, players);
    return (
        <>
            <p className="dr-by">
                <svg className="dr-lens" viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="10.5" cy="10.5" r="6" />
                    <path d="M15 15l5 5" />
                </svg>
                <span className="dr-by-name">
                    {choice.name}
                    <BotBadge />
                </span>
                <span className="dr-by-meta">{text.analysis.reading.by(analyzer?.version ?? null, analyzer?.ownerName ?? null, choice.analysis.seconds)}</span>
            </p>
            {involved === null ? null : <p className="note dr-involved">{involved}</p>}
        </>
    );
}

/**
 * A reading's graph with its labels: x ahead above the middle line and o below, from the board after the opening
 * to the game's last turn, the own views keyed by seat; a press steps to the turn under it.
 */
export function ReadingGraph({ view, choice, line, cursor, onTurn }: {
    view: GameReading;
    choice: ReadingChoice;
    line: GameLine;
    cursor: number;
    onTurn: (turn: number) => void;
}) {
    const first = line.firstTurn - 1;
    const last = line.lastTurn;
    return (
        <div className="dr-graph">
            <p className="dr-graph-label">
                <span>{judged.above}</span>
                <span>{words.span(openingWords(line), last)}</span>
            </p>
            <GameGraph
                reading={view}
                first={first}
                last={last}
                cursor={cursor}
                label={graphLabel(choice, last)}
                variant="full"
                onTurn={onTurn}
            />
            <p className="dr-graph-label">
                <span>{judged.below}</span>
                {choice.kind === `own` ? (
                    <span className="dr-own-key">
                        {choice.views.map((each) => (
                            <span key={each.side}>
                                <Swatch side={each.side} />
                                {each.player}
                            </span>
                        ))}
                    </span>
                ) : (
                    <span>{text.analysis.window.meaning[view.meaning]}</span>
                )}
            </p>
        </div>
    );
}

/** The mini graph a phone's closed sheet shows under its readout. */
export function PeekGraph({ view, choice, line, cursor }: { view: GameReading; choice: ReadingChoice; line: GameLine; cursor: number }) {
    const first = line.firstTurn - 1;
    const last = line.lastTurn;
    return (
        <GameGraph
            reading={view}
            first={first}
            last={last}
            cursor={cursor}
            label={graphLabel(choice, last)}
            variant="mini"
        />
    );
}

// The graph starts on the board after the opening, which the feed calls by its turns.
function openingWords(line: GameLine): string {
    const last = line.firstTurn - 1;
    return last === 0 ? text.drawer.openingLabel : text.drawer.openingRangeLabel(last);
}

function graphLabel(choice: ReadingChoice, last: number): string {
    return choice.kind === `own` ? words.ownGraph(last) : words.graph(choice.name, last);
}

/**
 * Per side, its marks by severity: per game only, never a share or a rate.
 * As a `grid`, every severity keeps its column, each count a number beside its mark and a zero dimmed.
 * Every turn of a run keeps its mark and counts; a note says how many of them runs hold.
 */
export function Marks({ view, players, grid = false }: { view: GameReading; players: GamePlayers; grid?: boolean }) {
    const inRuns = view.runs.reduce((count, run) => count + run.to - run.from + 1, 0);
    return (
        <>
            <dl className={grid ? `dr-marks dr-marks-grid` : `dr-marks`}>
                {sides.map((side) => {
                    const counts = view.counts[side];
                    const shown = grid ? severities : severities.filter((severity) => counts[severity] > 0);
                    return (
                        <div key={side} className="dr-marks-row">
                            <dt>
                                <Swatch side={side} />
                                <span className="dr-marks-name">{seatName(players[side])}</span>
                            </dt>
                            <dd>
                                {shown.length === 0 ? <span>{judged.noMarks}</span> : null}
                                {shown.map((severity) => (
                                    <span key={severity} className={counts[severity] === 0 ? `dr-mark-count dr-mark-none` : `dr-mark-count`}>
                                        <JudgmentChip severity={severity} spoken={false} />
                                        {grid ? (
                                            <>
                                                <span aria-hidden="true">{String(counts[severity])}</span>
                                                <span className="sr-only">{judged.count(counts[severity], severity)}</span>
                                            </>
                                        ) : (
                                            <span>{judged.count(counts[severity], severity)}</span>
                                        )}
                                    </span>
                                ))}
                            </dd>
                        </div>
                    );
                })}
            </dl>
            {inRuns === 0 ? null : <p className="note dr-marks-runs">{text.analysis.explain.inRuns(inRuns)}</p>}
        </>
    );
}

function waitWords(seconds: number | null): string {
    const now = Date.now();
    return text.analysis.reading.wait(seconds ?? Math.ceil((nextUtcDay(now) - now) / 1000));
}

/** A refused request for a reading in the words the head has for it. */
export function refusalWords(code: RequestRefusal, retryAfter: number | null, analyzer: string | null): string {
    const refusals = words.refusals;
    switch (code) {
        case `analysis_limit`:
            return refusals.analysis_limit(waitWords(retryAfter));
        case `analysis_queue_full`:
        case `rate_limited`:
            return refusals[code](waitWords(retryAfter ?? 1));
        case `no_analyzer`:
            return refusals.no_analyzer(analyzer);
        default:
            return refusals[code];
    }
}

/**
 * The status of a community reading: waiting, under way, failed, refused by an opt-out, or out of reach;
 * or, after a reading by a player's analyzer, the offer of one by an independent analyzer.
 */
export function StatusCard({ card, state, asker, onRequest }: {
    card: Exclude<RequestCard, { kind: `none` }>;
    state: AnalysesState;
    asker: Asker;
    onRequest: (analyzer: string | null) => void;
}) {
    const titleId = useId();
    switch (card.kind) {
        case `queued`:
            return (
                <div className="dr-card" role="status">
                    <p className="dr-card-title">{words.queued(card.ahead)}</p>
                </div>
            );
        case `running`: {
            // React passes custom properties through as written; CSSProperties only lacks their names.
            const style = { '--progress': `${(card.share * 100).toFixed(1)}%` } as CSSProperties;
            return (
                <div className="dr-card">
                    <p className="dr-card-title" id={titleId} role="status">
                        {words.running(card.analyzer?.name ?? null, card.turn, card.last)}
                    </p>
                    <div className="dr-progress" role="progressbar" aria-labelledby={titleId} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(card.share * 100)} style={style}>
                        <span />
                    </div>
                    <p className="note">{words.runningNote}</p>
                </div>
            );
        }
        case `failed`: {
            const title = card.cause === `expired` ? words.expired : words.failed(card.analyzer?.name ?? null, words.failures[card.cause], card.turn);
            return (
                <div className="dr-card">
                    <p className="dr-card-title">{title}</p>
                    <Ask label={words.again} state={state} asker={asker} onRequest={onRequest} analyzer={null} />
                </div>
            );
        }
        case `opted-out`:
            return (
                <div className="dr-card">
                    <p className="dr-card-title">{words.optedOut}</p>
                </div>
            );
        case `unreadable`:
            return (
                <div className="dr-card">
                    <p className="dr-card-title">{card.why === `too-long` ? words.tooLong : words.unplayed}</p>
                </div>
            );
        case `independent`:
            // Asked for by no name, a reading goes to an independent analyzer while one is online.
            return (
                <div className="dr-card">
                    <p className="dr-card-title">{words.independent}</p>
                    <Ask label={words.askIndependent} state={state} asker={asker} onRequest={onRequest} analyzer={null} />
                </div>
            );
    }
}

// No community reading yet: whom to ask, the button, and what is left of the day's requests.
function RequestBlock({ state, asker, onRequest }: { state: AnalysesState; asker: Asker; onRequest: (analyzer: string | null) => void }) {
    const titleId = useId();
    const selectId = useId();
    const signedIn = asker.kind === `user`;
    const { analyzers } = useAnalyzers(signedIn);
    const [picked, setPicked] = useState(``);
    const online = analyzers.kind === `ready` ? analyzers.bots.filter((bot) => bot.analyzer?.ready === true) : [];
    const analyzer = picked === `` || !online.some((bot) => bot.name === picked) ? null : picked;
    return (
        <section className="dr-card dr-request" aria-labelledby={titleId}>
            <h2 className="dr-card-title" id={titleId}>
                {words.none}
            </h2>
            <p className="note">{words.noneNote}</p>
            {signedIn && asker.left > 0 ? (
                <div className="dr-pick">
                    <label className="field-label" htmlFor={selectId}>
                        {words.analyzer}
                    </label>
                    <select
                        id={selectId}
                        value={analyzer ?? ``}
                        onChange={(event) => {
                            setPicked(event.target.value);
                        }}
                    >
                        <option value="">{words.any(analyzers.kind === `ready` ? online.length : null)}</option>
                        {online.map((bot) => (
                            <option key={bot.name} value={bot.name}>
                                {words.named(bot.name, bot.ownerName ?? null)}
                            </option>
                        ))}
                    </select>
                </div>
            ) : null}
            <Ask label={words.request} state={state} asker={asker} onRequest={onRequest} analyzer={analyzer} primary />
        </section>
    );
}

// The button that asks, held while a request is out, and what came of the last one;
// signed out, the way to sign in; with no requests left today, the day's count alone.
function Ask({ label, state, asker, onRequest, analyzer, primary = false }: {
    label: string;
    state: AnalysesState;
    asker: Asker;
    onRequest: (analyzer: string | null) => void;
    analyzer: string | null;
    primary?: boolean;
}): ReactNode {
    if (asker.kind === `unknown`) return null;
    if (asker.kind === `signed-out`) {
        return (
            <div className="dr-sign-in">
                <p className="note">{words.signIn}</p>
                <DiscordButton />
            </div>
        );
    }
    const sending = state.request.kind === `sending`;
    const refused = state.request.kind === `refused` ? state.request : null;
    return (
        <>
            {asker.left > 0 ? (
                <div className="card-actions dr-ask">
                    {/* Held, not disabled, while the request is out, so focus stays on it. */}
                    <button
                        type="button"
                        className={primary ? `btn btn-primary` : `btn btn-ghost btn-sm`}
                        aria-disabled={sending ? `true` : undefined}
                        onClick={() => {
                            if (!sending) onRequest(analyzer);
                        }}
                    >
                        {label}
                    </button>
                </div>
            ) : null}
            {refused === null ? null : (
                <p className="field-error" role="alert">
                    {refusalWords(refused.code, refused.retryAfter, analyzer)}
                </p>
            )}
            <p className="note">{words.left(asker.left)}</p>
        </>
    );
}

/**
 * The line a phone's closed sheet reads for the turn shown: its mark, who played it,
 * the reason or the value after it, and whose reading says so;
 * while a reading waits or runs, where it stands.
 */
export function PeekReadout({ card, view, choice, turn, players }: {
    card: RequestCard | null;
    view: GameReading | null;
    choice: ReadingChoice | null;
    turn: number;
    players: GamePlayers;
}): ReactNode {
    if (card?.kind === `queued`) return <span className="peek-readout">{words.queued(card.ahead)}</span>;
    if (card?.kind === `running`) return <span className="peek-readout">{words.running(card.analyzer?.name ?? null, card.turn, card.last)}</span>;
    const read = view?.turns.get(turn);
    if (read === undefined || choice === null) return null;
    const judgment = read.judgment;
    const verdict = judgment === null ? null : verdictInLine(judgment);
    const what: ValueText | null = verdict === null ? read.value : { shown: verdict, spoken: verdict };
    if (what === null) return null;
    const who = seatName(players[read.side]);
    const by = choice.kind === `own` ? words.ownBy : choice.name;
    return (
        <span className="peek-readout">
            {judgment === null ? null : <JudgmentChip severity={judgment.severity} />}
            <SpokenText words={{ shown: words.readout(who, what.shown, by), spoken: words.readout(who, what.spoken, by) }} className="peek-readout-words" />
        </span>
    );
}
