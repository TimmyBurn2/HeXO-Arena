import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { sideOf, type AxialCoord } from '@hexo-arena/contract';
import type { Player, Setup } from '@hexo-arena/rules';
import { Board, type BoardStone } from '../board/Board';
import { defaultBoardSettings } from '../board/board-settings';
import { stonesFrame } from '../board/geometry';
import { Swatch } from '../components/player';
import { text } from '../text';
import { writeBoat } from './boat';
import { readImport, type Imported } from './import-text';
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
                        <p className="note">{words.lineNote(positionWords(sideOf(end.toMove), imported.pending !== null, won))}</p>
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

/** What Export shows: the line as HTTTX text when it starts from the origin, the position as boat text, and a link. */
export interface ExportView {
    readonly line: { readonly text: string; readonly turns: number } | null;
    readonly position: Setup;
    readonly link: { readonly url: string; readonly game: boolean };
}

/** Export: this line as HTTTX notation, this position as boat notation with the side to move, and a link. */
export function ExportDialog({ view, onClose }: { view: ExportView; onClose: () => void }) {
    const words = text.analysis.export;
    return (
        <Dialog title={words.title} onClose={onClose}>
            {(close) => (
                <>
                    {view.line === null ? <p className="note">{words.noLine}</p> : <ExportField label={words.line(view.line.turns)} value={view.line.text} rows={5} />}
                    <ExportField label={words.position(sideOf(view.position.toMove))} value={writeBoat(view.position.stones)} rows={3} />
                    <ExportField label={view.link.game ? words.gameLink : words.link} value={view.link.url} rows={2} />
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
