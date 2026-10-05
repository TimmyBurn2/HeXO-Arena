import type { ReactNode } from 'react';
import { text } from '../text';
import { back, forward, toEnd, toStart, type AnalysisState } from './state';

/**
 * The analysis board's steps along the line shown, to its start, back, forward, and to its end,
 * around the words for where the board stands; without words, as a phone shows them apart.
 * A step that cannot go is held, not disabled, so the keyboard stays on it.
 */
export function NavSteps({ words, atStart, atEnd, onStep }: {
    words: string | null;
    atStart: boolean;
    atEnd: boolean;
    onStep: (move: (board: AnalysisState) => AnalysisState) => void;
}) {
    const nav = text.analysis.nav;
    return (
        <span className="scrubber">
            {stepButton(nav.start, `M7 5v14M18 6l-7 6 7 6`, atStart, () => {
                onStep(toStart);
            })}
            {stepButton(nav.back, `M15 5l-7 7 7 7`, atStart, () => {
                onStep(back);
            })}
            {words === null ? null : <span className="scrub-words">{words}</span>}
            {stepButton(nav.forward, `M9 5l7 7-7 7`, atEnd, () => {
                onStep(forward);
            })}
            {stepButton(nav.end, `M17 5v14M6 6l7 6-7 6`, atEnd, () => {
                onStep(toEnd);
            })}
        </span>
    );
}

function stepButton(label: string, glyph: string, disabled: boolean, go: () => void): ReactNode {
    return (
        <button
            type="button"
            className="scrub-step"
            aria-label={label}
            aria-disabled={disabled ? `true` : undefined}
            onClick={() => {
                if (!disabled) go();
            }}
        >
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={glyph} />
            </svg>
        </button>
    );
}
