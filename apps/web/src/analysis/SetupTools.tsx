import { useEffect, useRef } from 'react';
import type { Player } from '@hexo-arena/rules';
import { sideOf } from '@hexo-arena/contract';
import { Swatch } from '../components/player';
import { text } from '../text';
import { checkDraft, clearBoard, originOnly, setTool, setToMove, undo, type SetupDraft, type SetupTool } from './draft';

const tools: readonly { tool: SetupTool; label: string; side: `x` | `o` | null }[] = [
    { tool: `x`, label: text.analysis.setup.xStone, side: `x` },
    { tool: `o`, label: text.analysis.setup.oStone, side: `o` },
    { tool: `off`, label: text.analysis.setup.takeOff, side: null },
];

const players: readonly Player[] = [0, 1];

/**
 * The set-up tools: what a click places, the player to move, the board's
 * own edits, and the check line saying whether the position can be played
 * from; Done starts a new tree at it, replacing the one named in `replaces`.
 */
export function SetupTools({ draft, replaces, onChange, onCancel, onDone }: {
    draft: SetupDraft;
    replaces: string;
    onChange: (draft: SetupDraft) => void;
    onCancel: () => void;
    onDone: () => void;
}) {
    const heading = useRef<HTMLHeadingElement>(null);
    // The tools take the place of the button that opened them, so the
    // keyboard starts at their head rather than at the page's.
    useEffect(() => {
        heading.current?.focus({ preventScroll: true });
    }, []);
    const check = checkDraft(draft);
    const problem = check.problem;
    const side = sideOf(draft.toMove);
    return (
        <div className="an-tools">
            <h2 className="card-title" ref={heading} tabIndex={-1}>
                {text.analysis.setup.title}
            </h2>
            <div className="an-tool-row">
                <span className="an-tool-label" id="an-place">
                    {text.analysis.setup.place}
                </span>
                <div className="pills" role="group" aria-labelledby="an-place">
                    {tools.map((entry) => (
                        <button
                            key={entry.tool}
                            type="button"
                            className={`pill${draft.tool === entry.tool ? ` active` : ``}`}
                            aria-pressed={draft.tool === entry.tool}
                            onClick={() => {
                                onChange(setTool(draft, entry.tool));
                            }}
                        >
                            {entry.side === null ? null : <Swatch side={entry.side} />}
                            {entry.label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="an-tool-row">
                <span className="an-tool-label" id="an-to-move">
                    {text.analysis.setup.toMove}
                </span>
                <div className="pills" role="group" aria-labelledby="an-to-move">
                    {players.map((player) => (
                        <button
                            key={player}
                            type="button"
                            className={`pill${draft.toMove === player ? ` active` : ``}`}
                            aria-pressed={draft.toMove === player}
                            onClick={() => {
                                onChange(setToMove(draft, player));
                            }}
                        >
                            <Swatch side={sideOf(player)} />
                            {sideOf(player)}
                        </button>
                    ))}
                </div>
            </div>
            <div className="an-tool-row">
                <span className="an-tool-label">{text.analysis.setup.board}</span>
                <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                        onChange(clearBoard(draft));
                    }}
                >
                    {text.analysis.setup.clear}
                </button>
                <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                        onChange(originOnly(draft));
                    }}
                >
                    {text.analysis.setup.originOnly}
                </button>
                <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-disabled={draft.history.length === 0 ? `true` : undefined}
                    onClick={() => {
                        onChange(undo(draft));
                    }}
                >
                    {text.analysis.setup.undo}
                </button>
            </div>
            <div className="an-check" role="status">
                {draft.stones.length === 0 ? null : <span>{text.analysis.setup.count(draft.stones.length, check.x, check.o, side)}</span>}
                {problem === null ? (
                    <span className="an-check-ok">{text.analysis.setup.ready}</span>
                ) : (
                    <span className="an-check-bad">
                        {problem.kind === `no-stones`
                            ? text.analysis.setup.noStones
                            : problem.kind === `too-many-stones`
                              ? text.analysis.setup.tooMany(problem.count)
                              : problem.kind === `six-on-board`
                                ? text.analysis.setup.six
                                : text.analysis.setup.shared}
                    </span>
                )}
            </div>
            <p className="note">{text.analysis.setup.anywhere}</p>
            <p className="note">{text.analysis.setup.replaces(replaces)}</p>
            <div className="card-actions">
                <button type="button" className="btn btn-ghost" onClick={onCancel}>
                    {text.analysis.setup.cancel}
                </button>
                <button
                    type="button"
                    className="btn btn-primary"
                    aria-disabled={problem === null ? undefined : `true`}
                    onClick={() => {
                        if (problem === null) onDone();
                    }}
                >
                    {text.analysis.setup.done}
                </button>
            </div>
        </div>
    );
}
