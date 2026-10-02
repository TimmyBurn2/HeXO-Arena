import type { CSSProperties, ReactNode } from 'react';
import { analysisSecondsChoices, type BotListing, type Side } from '@hexo-arena/contract';
import { BoardToggles } from '../board/BoardToggles';
import { DiscordButton } from '../components/DiscordButton';
import { BotBadge } from '../components/player';
import { TopbarPanel, usePanel } from '../components/TopbarPanel';
import { text } from '../text';
import { effectiveSeconds, type AnalysisSettings } from './analysis-settings';
import type { HeldReading, ReadingState } from './readings';
import { lineLetters, xShare, type ShownLine } from './reading-view';

const words = text.analysis.reading;

/** Who reads the position shown: the analyzer that did, or the one the settings name, as the panel's line says it. */
export type AnalyzerShown =
    | { readonly kind: `named`; readonly name: string; readonly version: string | null; readonly ownerName: string | null; readonly seconds: number }
    | { readonly kind: `offline`; readonly name: string }
    | { readonly kind: `any`; readonly seconds: number };

/** Why the position shown cannot be read, if it cannot. */
export type Unreadable = { readonly kind: `won` } | { readonly kind: `too-many`; readonly stones: number } | { readonly kind: `too-far` };

/** The bots that declare an analyzer, as the settings list them. */
export type AnalyzerList =
    | { readonly kind: `loading` }
    | { readonly kind: `ready`; readonly bots: readonly BotListing[] }
    | { readonly kind: `failed`; readonly retry: () => void };

/** A reading pill: a source that read this position, by the name it goes by. */
export interface ReadingPill {
    readonly id: string;
    readonly name: string;
}

/**
 * The top of the analysis panel: the Analyze switch, off on every visit,
 * and the settings gear, whose panel hangs under it.
 */
export function AnalysisHead({ signedIn, analyzing, onAnalyzing, settings }: {
    signedIn: boolean;
    analyzing: boolean;
    onAnalyzing: (on: boolean) => void;
    settings: ReactNode;
}) {
    return (
        <div className="an-head">
            {signedIn ? (
                <label className="checkline an-switch">
                    <input
                        type="checkbox"
                        role="switch"
                        checked={analyzing}
                        onChange={(event) => {
                            onAnalyzing(event.target.checked);
                        }}
                    />
                    {words.analyze}
                </label>
            ) : null}
            {settings}
        </div>
    );
}

/**
 * What the panel says of the position shown: the readings to pick from, who reads it,
 * where the ask stands, and the analyzer's lines, or why there are none.
 * Each line previews on the board while pointed at or focused, and plays when pressed.
 */
export function ReadingBlock({ signedIn, unreadable, analyzing, pills, activePill, onPill, analyzer, entry, lines, held, toMove, onPreview, onPlay, onAsk, wait }: {
    // Null until the page knows who the person is.
    signedIn: boolean | null;
    unreadable: Unreadable | null;
    analyzing: boolean;
    pills: readonly ReadingPill[];
    activePill: string | null;
    onPill: (pill: ReadingPill) => void;
    analyzer: AnalyzerShown;
    entry: { readonly read: HeldReading | null; readonly state: ReadingState };
    lines: readonly ShownLine[];
    // Rows kept for lines on their way, so the panel holds still while the position is read.
    held: number;
    toMove: Side;
    onPreview: (line: ShownLine | null) => void;
    onPlay: (line: ShownLine) => void;
    onAsk: () => void;
    // Seconds until the day's readings come back, for a refusal that names none.
    wait: (seconds: number | null) => string;
}) {
    if (signedIn === null) return null;
    if (!signedIn) {
        return (
            <div className="an-reading an-signed-out">
                <p className="note">{words.signedOut}</p>
                <DiscordButton />
            </div>
        );
    }
    if (unreadable !== null) {
        return (
            <div className="an-reading">
                <p className="note an-quiet">{unreadableText(unreadable)}</p>
            </div>
        );
    }
    const { read, state } = entry;
    const name = analyzer.kind === `any` ? words.anyOne : analyzer.name;
    return (
        <div className="an-reading">
            {pills.length > 1 ? (
                <div className="pills an-pills" role="group" aria-label={words.readings}>
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
            <AnalyzerLine analyzer={analyzer} />
            {state.kind === `refused` || state.kind === `failed` ? (
                <Trouble state={state} analyzer={analyzer} onAsk={onAsk} wait={wait} />
            ) : (
                <>
                    <p className="an-state" role="status">
                        {stateWords(state, read, analyzing, name, analyzer.kind === `any`, toMove)}
                    </p>
                    {state.kind === `queued` ? <p className="note an-quiet">{words.waitingNote(waitedFor(state, name), (state.ahead + 1) * (read?.ask.seconds ?? seconds(analyzer)))}</p> : null}
                    {read === null && state.kind === `idle` && !analyzing ? <p className="note an-quiet">{words.off}</p> : null}
                </>
            )}
            {/* A reading in hand stays, whatever became of a later ask. */}
            {lines.length > 0 ? <Lines lines={lines} toMove={toMove} onPreview={onPreview} onPlay={onPlay} /> : held > 0 ? <HeldLines count={held} toMove={toMove} /> : null}
        </div>
    );
}

// The analyzer a waiting position is queued for, once the site has chosen one.
function waitedFor(state: Extract<ReadingState, { kind: `queued` }>, name: string): string {
    return state.by?.kind === `bot` ? state.by.name : name;
}

function seconds(analyzer: AnalyzerShown): number {
    return analyzer.kind === `offline` ? 0 : analyzer.seconds;
}

function unreadableText(unreadable: Unreadable): string {
    switch (unreadable.kind) {
        case `won`:
            return words.won;
        case `too-many`:
            return words.tooMany(unreadable.stones);
        case `too-far`:
            return words.tooFar;
    }
}

function stateWords(state: ReadingState, read: HeldReading | null, analyzing: boolean, name: string, any: boolean, toMove: Side): ReactNode {
    const reading = any ? words.anyReading : words.reading(name);
    let said: string;
    switch (state.kind) {
        case `thinking`:
            said = reading;
            break;
        case `queued`:
            said = words.waiting(waitedFor(state, name), state.ahead);
            break;
        default:
            // A position Analyze will ask for reads as being read through the dwell before the ask.
            said = read === null ? (analyzing ? reading : ``) : read.reading.elapsedMs === null ? words.readBefore : words.readIn(read.reading.elapsedMs);
    }
    if (said === ``) return null;
    const live = state.kind === `thinking` || state.kind === `queued` || (read === null && analyzing);
    return (
        <>
            <span className={live ? `an-pip an-pip-live` : `an-pip`} aria-hidden="true" />
            {words.toMove(said, toMove)}
        </>
    );
}

function AnalyzerLine({ analyzer }: { analyzer: AnalyzerShown }) {
    return (
        <p className="an-by">
            <svg className="an-lens" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="10.5" cy="10.5" r="6" />
                <path d="M15 15l5 5" />
            </svg>
            {analyzer.kind === `any` ? (
                <>
                    <span className="an-by-name">{words.any}</span>
                    <span className="an-by-meta">{words.by(null, null, analyzer.seconds)}</span>
                </>
            ) : (
                <>
                    <span className="an-by-name">
                        {analyzer.name}
                        <BotBadge />
                    </span>
                    <span className="an-by-meta">
                        {analyzer.kind === `named` ? words.by(analyzer.version, analyzer.ownerName, analyzer.seconds) : words.notReading}
                    </span>
                </>
            )}
        </p>
    );
}

function Lines({ lines, toMove, onPreview, onPlay }: {
    lines: readonly ShownLine[];
    toMove: Side;
    onPreview: (line: ShownLine | null) => void;
    onPlay: (line: ShownLine) => void;
}) {
    return (
        <ol className="an-lines">
            {lines.map((line) => {
                const cells = words.cells(toMove, [line.cellsText]);
                return (
                    <li key={line.letter}>
                        <button
                            type="button"
                            className="an-line"
                            aria-label={words.play(line.letter, line.value, cells)}
                            onPointerEnter={() => {
                                onPreview(line);
                            }}
                            onPointerLeave={() => {
                                onPreview(null);
                            }}
                            onFocus={() => {
                                onPreview(line);
                            }}
                            onBlur={() => {
                                onPreview(null);
                            }}
                            onClick={() => {
                                onPreview(null);
                                onPlay(line);
                            }}
                        >
                            <span className={`an-letter an-letter-${toMove}`} aria-hidden="true">
                                {line.letter}
                            </span>
                            <span className="an-value">{line.value}</span>
                            <span className="an-cells">{cells}</span>
                            <svg className="an-play" viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                    </li>
                );
            })}
        </ol>
    );
}

function HeldLines({ count, toMove }: { count: number; toMove: Side }) {
    return (
        <ol className="an-lines" aria-hidden="true">
            {lineLetters.slice(0, count).map((letter) => (
                <li key={letter}>
                    <span className="an-line an-line-held">
                        <span className={`an-letter an-letter-${toMove}`}>{letter}</span>
                    </span>
                </li>
            ))}
        </ol>
    );
}

function Trouble({ state, analyzer, onAsk, wait }: {
    state: Extract<ReadingState, { kind: `refused` | `failed` }>;
    analyzer: AnalyzerShown;
    onAsk: () => void;
    wait: (seconds: number | null) => string;
}) {
    let title: string;
    let note: string;
    let again = true;
    if (state.kind === `failed`) {
        title = state.by === null || state.by.kind !== `bot` ? words.failedAny : words.failed(state.by.name);
        note = words.failures[state.code];
    } else {
        switch (state.code) {
            case `live_position`:
            case `seated`:
            case `unavailable`:
                ({ title, note } = words.refusals[state.code]);
                again = state.code === `unavailable`;
                break;
            case `analysis_busy`:
            case `rate_limited`:
                title = words.refusals[state.code].title;
                note = words.refusals[state.code].note(wait(state.retryAfter ?? 1));
                break;
            case `analysis_limit`:
                title = words.limit;
                note = words.limitNote(wait(state.retryAfter));
                again = false;
                break;
            case `no_analyzer`:
                title = analyzer.kind === `any` ? words.noneOnline : words.offline(analyzer.name);
                note = analyzer.kind === `any` ? words.noneOnlineNote : words.offlineNote;
                break;
            case `signed_out`:
                title = words.signedOut;
                note = ``;
                again = false;
                break;
        }
    }
    return (
        <div className="an-trouble" role="alert">
            <p className="an-trouble-title">{title}</p>
            {note === `` ? null : <p className="note">{note}</p>}
            {again ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={onAsk}>
                    {words.askAgain}
                </button>
            ) : null}
        </div>
    );
}

/**
 * The eval bar beside the board: x fills it from the bottom, where x's chip
 * sits on the game screen, up to the best line's value, which a chip at the
 * split names; on a phone it runs under the board, x from the left.
 * While a position is `held` for its reading the bar stays, even and dimmed.
 */
export function EvalBar({ line, mover, held }: { line: ShownLine | null; mover: Side; held: boolean }) {
    if (line === null && !held) return null;
    const share = `${((line === null ? 0.5 : xShare(line, mover)) * 100).toFixed(1)}%`;
    // React passes custom properties through as written; CSSProperties only lacks their names.
    const style = { '--x-share': share } as CSSProperties;
    return (
        <div className={line === null ? `an-evalbar an-evalbar-held` : `an-evalbar`} style={style} aria-hidden="true">
            <span className="an-evalbar-x" />
            {line === null ? null : <span className="an-evalbar-chip">{line.value}</span>}
        </div>
    );
}

/**
 * The analysis settings behind the panel's gear: whom to ask, how many lines,
 * how long a look, whether lines show on the board, stone numbers, and what
 * is left of the day's readings.
 */
export function AnalysisSettingsPanel({ signedIn, settings, onSettings, analyzers, onOpen, left }: {
    signedIn: boolean;
    settings: AnalysisSettings;
    onSettings: (changes: Partial<AnalysisSettings>) => void;
    analyzers: AnalyzerList;
    // Opening reads the analyzers again, since which are online changes.
    onOpen: () => void;
    left: number | null;
}) {
    const control = usePanel(`analysis-settings`);
    const set = text.analysis.settings;
    const online = analyzers.kind === `ready` ? analyzers.bots.filter((bot) => bot.analyzer?.ready === true) : [];
    const chosen = settings.analyzer === null ? null : (online.find((bot) => bot.name === settings.analyzer) ?? null);
    const cap = chosen?.analyzer?.maxSeconds ?? null;
    const effective = effectiveSeconds(settings.seconds, cap);
    const away = analyzers.kind === `ready` && settings.analyzer !== null && chosen === null ? settings.analyzer : null;
    return (
        <>
            <button
                ref={control.button}
                type="button"
                className="an-gear"
                aria-label={words.settings}
                aria-haspopup="dialog"
                aria-expanded={control.mode !== `closed`}
                aria-controls={control.mode === `closed` ? undefined : `analysis-settings-panel`}
                onClick={() => {
                    if (control.mode === `closed` && signedIn) onOpen();
                    control.toggle();
                }}
            >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M9.42 5.28L9.75 2.26L14.25 2.26L14.58 5.28L16.53 6.4L19.31 5.18L21.56 9.08L19.11 10.87L19.11 13.13L21.56 14.92L19.31 18.82L16.53 17.6L14.58 18.72L14.25 21.74L9.75 21.74L9.42 18.72L7.47 17.6L4.69 18.82L2.44 14.92L4.89 13.13L4.89 10.87L2.44 9.08L4.69 5.18L7.47 6.4ZM14.77 13.6L12 15.2L9.23 13.6L9.23 10.4L12 8.8L14.77 10.4Z" />
                </svg>
            </button>
            <TopbarPanel
                id="analysis-settings-panel"
                className="an-settings"
                control={control}
                labelledBy="analysis-settings-title"
                head={
                    <h2 id="analysis-settings-title" className="an-settings-title">
                        {set.title}
                    </h2>
                }
                closeLabel={set.close}
                initialFocus={signedIn ? `input[type="radio"]:checked` : `input`}
            >
                {signedIn ? (
                    <>
                        <fieldset className="an-set-group">
                            <legend className="an-set-legend">{set.analyzer}</legend>
                            <div className="an-analyzers">
                                {online.map((bot) => (
                                    <AnalyzerChoice
                                        key={bot.name}
                                        name={bot.name}
                                        note={bot.analyzer === null ? `` : set.analyzerNote(bot.ownerName ?? null, bot.analyzer.maxSeconds, bot.analyzer.lines)}
                                        checked={settings.analyzer === bot.name}
                                        onPick={() => {
                                            onSettings({ analyzer: bot.name });
                                        }}
                                    />
                                ))}
                                {away === null ? null : <AnalyzerChoice name={away} note={words.notReading} checked onPick={() => undefined} />}
                                <AnalyzerChoice
                                    name={null}
                                    note={set.anyNote}
                                    checked={settings.analyzer === null}
                                    onPick={() => {
                                        onSettings({ analyzer: null });
                                    }}
                                />
                            </div>
                            {analyzers.kind === `ready` && online.length === 0 ? <p className="note an-quiet">{set.noneOnline}</p> : null}
                            {analyzers.kind === `failed` ? (
                                <p className="an-set-failed">
                                    <span className="field-error">{set.failed}</span>
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={analyzers.retry}>
                                        {text.states.tryAgain}
                                    </button>
                                </p>
                            ) : null}
                        </fieldset>
                        <div className="an-set-row">
                            <span className="an-set-label" id="analysis-lines">
                                {set.lines}
                            </span>
                            <div className="pills" role="group" aria-labelledby="analysis-lines">
                                {([1, 2, 3] as const).map((count) => (
                                    <button
                                        key={count}
                                        type="button"
                                        className={`pill${settings.lines === count ? ` active` : ``}`}
                                        aria-pressed={settings.lines === count}
                                        onClick={() => {
                                            onSettings({ lines: count });
                                        }}
                                    >
                                        {String(count)}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="an-set-row">
                            <span className="an-set-label" id="analysis-time">
                                {set.time}
                            </span>
                            <div className="pills" role="group" aria-labelledby="analysis-time" aria-describedby={cap === null ? undefined : `analysis-capped`}>
                                {analysisSecondsChoices.map((choice) => {
                                    const over = cap !== null && choice > cap && choice !== analysisSecondsChoices[0];
                                    return (
                                        <button
                                            key={choice}
                                            type="button"
                                            className={`pill${effective === choice ? ` active` : ``}`}
                                            aria-pressed={effective === choice}
                                            aria-disabled={over ? `true` : undefined}
                                            onClick={() => {
                                                if (!over) onSettings({ seconds: choice });
                                            }}
                                        >
                                            {set.seconds(choice)}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        {cap === null || chosen === null ? null : (
                            <p id="analysis-capped" className="note an-quiet">
                                {set.capped(chosen.name, cap)}
                            </p>
                        )}
                    </>
                ) : null}
                <div className="an-set-toggles">
                    <label className="checkline">
                        <input
                            type="checkbox"
                            role="switch"
                            checked={settings.boardLines}
                            onChange={(event) => {
                                onSettings({ boardLines: event.target.checked });
                            }}
                        />
                        {set.boardLines}
                    </label>
                    <BoardToggles />
                </div>
                <p className="note an-set-foot">{signedIn && left !== null ? set.left(left) : words.signedOut}</p>
            </TopbarPanel>
        </>
    );
}

function AnalyzerChoice({ name, note, checked, onPick }: { name: string | null; note: string; checked: boolean; onPick: () => void }) {
    const id = `analyzer-${name ?? `any`}`;
    return (
        <label className="an-analyzer">
            <input type="radio" name="analysis-analyzer" checked={checked} aria-labelledby={`${id}-name`} aria-describedby={`${id}-note`} onChange={onPick} />
            <span className="an-analyzer-text">
                <span className="an-analyzer-name">
                    <span id={`${id}-name`}>{name === null ? words.any : name}</span>
                    {name === null ? null : <BotBadge />}
                </span>
                <span className="an-analyzer-note" id={`${id}-note`}>
                    {note}
                </span>
            </span>
        </label>
    );
}
