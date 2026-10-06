import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { sideOf, type AxialCoord, type HtttxTag, type Side } from '@hexo-arena/contract';
import type { Player, Setup } from '@hexo-arena/rules';
import { Board, type BoardStone } from '../board/Board';
import { defaultBoardSettings } from '../board/board-settings';
import { stonesFrame } from '../board/geometry';
import { Swatch } from '../components/player';
import { text } from '../text';
import { writeBoat } from './boat';
import { readImport, type Imported } from './import-text';
import { cellText } from './notation';
import { importedKinds } from './study';
import { notationErrorText, positionWords } from './words';

// A modal dialog over the analysis screen. Every way out closes the
// element itself, Esc and a press on the backdrop as its own buttons do,
// so the browser returns focus to whatever opened it before `onClose` lets
// the screen drop it.
function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: (close: () => void) => ReactNode }) {
    const ref = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    useLayoutEffect(() => {
        const dialog = ref.current;
        if (dialog !== null && !dialog.open) dialog.showModal();
    }, []);
    const close = () => {
        ref.current?.close();
    };
    return (
        <dialog
            ref={ref}
            className="an-dialog"
            aria-labelledby={titleId}
            onClose={onClose}
            onClick={(event) => {
                if (event.target === event.currentTarget) close();
            }}
        >
            <div className="an-dialog-body">
                <h2 id={titleId}>{title}</h2>
                {children(close)}
            </div>
        </dialog>
    );
}

// Previews share the minis' aspect, so a position reads at the same size.
const previewAspect = 4 / 3;

function Preview({ stones, mark }: { stones: readonly BoardStone[]; mark: AxialCoord | null }) {
    const frame = useMemo(() => stonesFrame(mark === null ? stones : [...stones, mark], previewAspect), [stones, mark]);
    return (
        <div className="an-mini">
            <Board stones={stones} settings={defaultBoardSettings} label={text.analysis.boardStones(stones.length)} frame={frame} overlays={mark === null ? {} : { pending: mark }} />
        </div>
    );
}

function stonesOf(setup: Setup): BoardStone[] {
    return setup.stones.map((stone) => ({ x: stone.x, y: stone.y, side: sideOf(stone.player), number: null }));
}

/**
 * Import: paste HTTTX notation, a boat position, or a link, see it read
 * with a preview or the reason it does not load, and load it.
 * A boat position holds no side to move, so its preview offers one.
 */
export function ImportDialog({ initial, onClose, onLoad }: {
    initial: string;
    onClose: () => void;
    onLoad: (imported: Imported) => void;
}) {
    const [value, setValue] = useState(initial);
    const [toMove, setToMove] = useState<Player | null>(null);
    const fieldId = useId();
    const errorId = useId();
    const read = useMemo(() => (value.trim() === `` ? null : readImport(value, window.location.origin)), [value]);
    const loaded: Imported | null = read?.ok === true ? withToMove(read.value, toMove) : null;
    const words = text.analysis.import;

    return (
        <Dialog title={words.title} onClose={onClose}>
            {(close) => (
                <form
                    className="an-form"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (loaded === null || loaded.kind === `elsewhere`) return;
                        close();
                        onLoad(loaded);
                    }}
                >
                    <label className="field-label" htmlFor={fieldId}>
                        {words.label}
                    </label>
                    <textarea
                        id={fieldId}
                        className="an-field"
                        rows={6}
                        spellCheck={false}
                        autoComplete="off"
                        aria-invalid={read?.ok === false ? true : undefined}
                        aria-describedby={read?.ok === false ? errorId : undefined}
                        value={value}
                        onChange={(event) => {
                            setValue(event.target.value);
                            setToMove(null);
                        }}
                    />
                    <div aria-live="polite">
                        {read === null ? null : read.ok ? (
                            <ImportPreview imported={loaded ?? read.value} onToMove={setToMove} />
                        ) : (
                            <p className="an-error" id={errorId}>
                                {notationErrorText(read.error)}
                            </p>
                        )}
                    </div>
                    <div className="card-actions">
                        <button type="button" className="btn btn-ghost" onClick={close}>
                            {words.cancel}
                        </button>
                        <button type="submit" className="btn btn-primary" aria-disabled={loaded === null || loaded.kind === `elsewhere` ? `true` : undefined}>
                            {words.load}
                        </button>
                    </div>
                </form>
            )}
        </Dialog>
    );
}

function withToMove(imported: Imported, toMove: Player | null): Imported {
    if (imported.kind !== `setup` || toMove === null || imported.line.turns.length > 0) return imported;
    const start = { stones: imported.start.stones, toMove };
    return { ...imported, start, line: { ...imported.line, end: start } };
}

function ImportPreview({ imported, onToMove }: { imported: Imported; onToMove: (toMove: Player) => void }) {
    const words = text.analysis.import;
    switch (imported.kind) {
        case `line`: {
            const end = imported.line.end;
            const won = imported.line.win === null ? null : sideOf(imported.line.win.player);
            return (
                <div className="an-preview">
                    <Preview stones={stonesOf(end)} mark={imported.pending} />
                    <div>
                        <p className="card-title">{words.line(imported.line.turns.length)}</p>
                        <Players tags={imported.tags} />
                        <p className="note">{words.lineNote(positionWords(sideOf(end.toMove), imported.pending !== null, won))}</p>
                    </div>
                </div>
            );
        }
        case `study`: {
            const { study } = imported;
            const won = study.win === null ? null : sideOf(study.win.player);
            const kinds = importedKinds(study.tree);
            return (
                <div className="an-preview">
                    <Preview stones={stonesOf(study.position)} mark={null} />
                    <div>
                        <p className="card-title">{words.study(study.turns, study.variations)}</p>
                        <Players tags={study.tags} />
                        <p className="note">{words.lineNote(positionWords(sideOf(study.position.toMove), study.half, won))}</p>
                        {kinds.length === 0 ? null : <p className="note">{words.notes(kinds.map((kind) => words.kinds[kind]))}</p>}
                    </div>
                </div>
            );
        }
        case `setup`: {
            const end = imported.line.end;
            const pick = imported.line.turns.length === 0;
            return (
                <div className="an-preview">
                    <Preview stones={stonesOf(end)} mark={null} />
                    <div>
                        <p className="card-title">{words.setup(imported.start.stones.length, imported.line.turns.length)}</p>
                        {pick ? (
                            <>
                                <p className="note">{words.setupNote}</p>
                                <div className="pills" role="group" aria-label={text.analysis.setup.toMove}>
                                    {([0, 1] as const).map((player) => (
                                        <button
                                            key={player}
                                            type="button"
                                            className={`pill${imported.start.toMove === player ? ` active` : ``}`}
                                            aria-pressed={imported.start.toMove === player}
                                            onClick={() => {
                                                onToMove(player);
                                            }}
                                        >
                                            <Swatch side={sideOf(player)} />
                                            {text.analysis.nav.toMove(sideOf(player))}
                                        </button>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <p className="note">{positionWords(sideOf(end.toMove), false, imported.line.win === null ? null : sideOf(imported.line.win.player))}</p>
                        )}
                    </div>
                </div>
            );
        }
        case `game`:
            return (
                <div className="an-preview-text">
                    <p className="card-title">{words.game}</p>
                    <p className="note">{words.gameNote(imported.turn)}</p>
                </div>
            );
        case `elsewhere`:
            return <p className="an-error">{words.elsewhere}</p>;
        default:
            return assertNever(imported);
    }
}

// The game's name and players, where a text's tags give them.
function Players({ tags }: { tags: readonly HtttxTag[] }) {
    const tag = (key: string) => tags.find((each) => each.key === key)?.value.trim() ?? ``;
    const players = tag(`playercross`) === `` || tag(`playercircle`) === `` ? null : text.analysis.source.players(tag(`playercross`), tag(`playercircle`));
    const said = [tag(`name`), players ?? ``].filter((part) => part !== ``);
    return said.length === 0 ? null : <p className="note">{said.join(`: `)}</p>;
}

function ExportField({ label, value, rows }: { label: string; value: string; rows: number }) {
    const id = useId();
    const [copied, setCopied] = useState<`no` | `yes` | `failed`>(`no`);
    async function copy() {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(`yes`);
        } catch {
            setCopied(`failed`);
        }
    }
    return (
        <div className="an-field-row">
            <div className="an-field-head">
                <label className="field-label" htmlFor={id}>
                    {label}
                </label>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy()}>
                    {copied === `yes` ? text.analysis.export.copied : text.analysis.export.copy}
                </button>
            </div>
            <textarea
                id={id}
                className="an-field"
                readOnly
                rows={rows}
                spellCheck={false}
                value={value}
                onFocus={(event) => {
                    event.currentTarget.select();
                }}
            />
            {copied === `failed` ? <p className="an-error">{text.analysis.export.copyFailed}</p> : null}
        </div>
    );
}

/** Why the reading shown adds no evaluation: nobody signed in to ask, Analyze off, Analyze on with nothing read yet, or the text's own evaluations covering every turn read. */
export type EvaluationsNone = `signed-out` | `off` | `reading` | `covered`;

/** How the tree is written: the version, and for v2 whether the reading's evaluations and the game's clocks go in. */
export interface ExportChoice {
    readonly version: 1 | 2;
    readonly evaluations: boolean;
    readonly clocks: boolean;
}

/**
 * What Export shows: the tree as HTTTX when it starts from the origin, with what each choice can add,
 * the position as boat text, and a link.
 */
export interface ExportView {
    readonly notation: {
        // Null where v2 has no turn to write.
        readonly write: (choice: ExportChoice) => string | null;
        readonly turns: { readonly v1: number; readonly v2: number };
        readonly variations: number;
        // Turns the reading shown evaluates where the text gives none, and why none where it is none;
        // turns the game's clocks time, null where there is no such choice.
        readonly evaluations: { readonly turns: number; readonly none: EvaluationsNone };
        readonly clocks: number | null;
    } | null;
    readonly position: Setup;
    // A half-turn's lone stone, which neither the position nor the link holds; null on any other node.
    readonly lone: { readonly side: Side; readonly cell: AxialCoord } | null;
    readonly link: { readonly url: string; readonly game: boolean };
}

/**
 * Export: the tree as HTTTX notation, v2 with every variation or v1 with the main line,
 * this position as boat notation with the side to move, and a link.
 */
export function ExportDialog({ view, onClose }: { view: ExportView; onClose: () => void }) {
    const words = text.analysis.export;
    const [choice, setChoice] = useState<ExportChoice>({ version: 2, evaluations: false, clocks: false });
    const notation = view.notation;
    const written = notation === null ? null : notation.write(choice);
    const formId = useId();
    return (
        <Dialog title={words.title} onClose={onClose}>
            {(close) => (
                <>
                    {notation === null ? (
                        <p className="note">{words.noLine}</p>
                    ) : (
                        <>
                            <div className="an-export-form">
                                <div className="pills" role="group" aria-labelledby={formId}>
                                    <span className="sr-only" id={formId}>
                                        {words.form}
                                    </span>
                                    {([2, 1] as const).map((version) => (
                                        <button
                                            key={version}
                                            type="button"
                                            className={`pill${choice.version === version ? ` active` : ``}`}
                                            aria-pressed={choice.version === version}
                                            onClick={() => {
                                                setChoice({ ...choice, version });
                                            }}
                                        >
                                            {version === 2 ? words.v2 : words.v1}
                                        </button>
                                    ))}
                                </div>
                                <p className="note">{choice.version === 2 ? words.v2Note : words.v1Note}</p>
                                {choice.version === 2 ? (
                                    <label className="checkline">
                                        <input
                                            type="checkbox"
                                            checked={choice.evaluations && notation.evaluations.turns > 0}
                                            disabled={notation.evaluations.turns === 0}
                                            onChange={(event) => {
                                                setChoice({ ...choice, evaluations: event.target.checked });
                                            }}
                                        />
                                        {notation.evaluations.turns === 0 ? words.evaluationsNone[notation.evaluations.none] : words.evaluations(notation.evaluations.turns)}
                                    </label>
                                ) : null}
                                {choice.version === 2 && notation.clocks !== null ? (
                                    <label className="checkline">
                                        <input
                                            type="checkbox"
                                            checked={choice.clocks}
                                            onChange={(event) => {
                                                setChoice({ ...choice, clocks: event.target.checked });
                                            }}
                                        />
                                        {words.clocks(notation.clocks)}
                                    </label>
                                ) : null}
                            </div>
                            {written === null ? (
                                <p className="note">{words.noTurns}</p>
                            ) : (
                                <ExportField
                                    label={words.line(choice.version, choice.version === 2 ? notation.turns.v2 : notation.turns.v1, choice.version === 2 ? notation.variations : 0)}
                                    value={written}
                                    rows={6}
                                />
                            )}
                        </>
                    )}
                    <ExportField
                        label={view.lone === null ? words.position(sideOf(view.position.toMove)) : words.positionBefore(cellText(view.lone.cell), sideOf(view.position.toMove))}
                        value={writeBoat(view.position.stones)}
                        rows={3}
                    />
                    <ExportField label={view.lone !== null ? words.linkBefore(cellText(view.lone.cell)) : view.link.game ? words.gameLink : words.link} value={view.link.url} rows={2} />
                    <p className="note">{words.note}</p>
                    <div className="card-actions">
                        <button type="button" className="btn btn-ghost" onClick={close}>
                            {words.close}
                        </button>
                    </div>
                </>
            )}
        </Dialog>
    );
}

function assertNever(value: never): never {
    throw new Error(`unexpected value ${JSON.stringify(value)}`);
}
