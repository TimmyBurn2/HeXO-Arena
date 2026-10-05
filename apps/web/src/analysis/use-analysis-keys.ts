import { useEffect } from 'react';
import { back, forward, switchLine, toEnd, toStart, unmark, type AnalysisState } from './state';

/**
 * The analysis board's keys, on the window: while setting up, Esc leaves as Cancel does;
 * otherwise, with no dialog open, the arrows, Home, and End step through the tree, Esc drops the mark,
 * `s` opens Set up, and `a` asks for a reading.
 * Keys typed into a field or a dialog stay there.
 */
export function useAnalysisKeys({ editing, dialog, step, openSetup, leaveSetup, askNow }: {
    editing: boolean;
    dialog: boolean;
    step: (move: (board: AnalysisState) => AnalysisState) => void;
    openSetup: () => void;
    leaveSetup: () => void;
    askNow: () => void;
}): void {
    useEffect(() => {
        if (!editing) return;
        function onKey(event: KeyboardEvent) {
            if (event.key !== `Escape` || event.defaultPrevented || typingInto(event.target)) return;
            if (event.target instanceof Element && event.target.closest(`dialog`) !== null) return;
            event.preventDefault();
            leaveSetup();
        }
        window.addEventListener(`keydown`, onKey);
        return () => {
            window.removeEventListener(`keydown`, onKey);
        };
    }, [editing, leaveSetup]);

    useEffect(() => {
        if (editing || dialog) return;
        function onKey(event: KeyboardEvent) {
            if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || typingInto(event.target)) return;
            if (event.target instanceof Element && event.target.closest(`dialog`) !== null) return;
            const moves: Record<string, ((board: AnalysisState) => AnalysisState) | undefined> = {
                ArrowLeft: back,
                ArrowRight: forward,
                ArrowUp: (current) => switchLine(current, -1),
                ArrowDown: (current) => switchLine(current, 1),
                Home: toStart,
                End: toEnd,
                Escape: unmark,
            };
            const move = moves[event.key];
            if (move !== undefined) {
                event.preventDefault();
                step(move);
                return;
            }
            if (event.key === `s`) {
                event.preventDefault();
                openSetup();
            }
            if (event.key === `a`) {
                event.preventDefault();
                askNow();
            }
        }
        window.addEventListener(`keydown`, onKey);
        return () => {
            window.removeEventListener(`keydown`, onKey);
        };
    }, [editing, dialog, step, openSetup, askNow]);
}

// A switch takes no arrows or letters, so the board's keys still work from
// the Analyze switch a click has just turned on.
function typingInto(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target instanceof HTMLInputElement) return target.type !== `checkbox`;
    return target.isContentEditable || [`TEXTAREA`, `SELECT`].includes(target.tagName);
}
