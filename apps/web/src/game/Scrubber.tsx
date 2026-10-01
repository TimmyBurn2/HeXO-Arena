import type { KeyboardEvent, PointerEvent } from 'react';
import { text } from '../text';
import { stepStone, stepTurn, turnOf, type Replay } from './replay';

/**
 * The count a replay states: the opening, or the turn of how many, a turn
 * shown to its first stone short of the game's last, and whether the game
 * is still live.
 */
export function replayCount(replay: Replay, live: boolean): string {
    const { range, shown, following } = replay;
    const last = turnOf(range.total);
    if (live && following) return text.replay.latest(last);
    const words =
        shown <= range.opening
            ? range.opening === 1
                ? text.replay.origin
                : text.replay.opening(range.opening)
            : shown % 2 === 0 && shown < range.total
              ? text.replay.firstStone(turnOf(shown), last)
              : text.replay.turn(turnOf(shown), last);
    return live ? text.replay.live(words) : words;
}

/**
 * The replay's controls: to the opening, a turn back, the count as a
 * slider, a turn on, and to the latest stone.
 * On the slider, Left and Right step a turn, Shift with them a stone, and
 * Home and End jump to the ends; `compact` keeps the steps and the count
 * alone, for a phone's sheet.
 */
export function Scrubber({ replay, live, compact = false }: { replay: Replay; live: boolean; compact?: boolean }) {
    const { range, shown, go } = replay;
    const atStart = shown <= range.opening;
    const atEnd = shown >= range.total;
    // A phone's sheet keeps its line short; the chip above it says live.
    const count = replayCount(replay, live && !compact);

    function onKey(event: KeyboardEvent<HTMLElement>) {
        const direction = event.key === `ArrowLeft` || event.key === `ArrowDown` ? -1 : event.key === `ArrowRight` || event.key === `ArrowUp` ? 1 : 0;
        if (direction !== 0) {
            event.preventDefault();
            go(event.shiftKey ? stepStone(shown, direction, range) : stepTurn(shown, direction, range));
            return;
        }
        if (event.key === `Home` || event.key === `End`) {
            event.preventDefault();
            go(event.key === `Home` ? range.opening : range.total);
        }
    }

    // A press on the track seeks to the turn under it.
    function onTrack(event: PointerEvent<HTMLSpanElement>) {
        const box = event.currentTarget.getBoundingClientRect();
        if (box.width === 0) return;
        const share = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
        const turns = turnOf(range.total) - turnOf(range.opening);
        const turn = turnOf(range.opening) + Math.round(share * turns);
        go(turn <= turnOf(range.opening) ? range.opening : Math.min(range.total, 1 + 2 * turn));
    }

    const span = range.total - range.opening;
    const filled = span === 0 ? 1 : (shown - range.opening) / span;
    const step = (label: string, glyph: string, disabled: boolean, to: number) => (
        <button
            type="button"
            className="scrub-step"
            aria-label={label}
            aria-disabled={disabled ? `true` : undefined}
            onClick={() => {
                if (!disabled) go(to);
            }}
        >
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={glyph} />
            </svg>
        </button>
    );

    return (
        <span className={compact ? `scrubber compact` : `scrubber`}>
            {compact ? null : step(text.replay.toOpening, `M7 5v14M18 6l-7 6 7 6`, atStart, range.opening)}
            {step(text.replay.back, `M15 5l-7 7 7 7`, atStart, stepTurn(shown, -1, range))}
            <span
                className="scrub-count"
                role="slider"
                tabIndex={0}
                aria-label={text.replay.label}
                aria-valuemin={turnOf(range.opening)}
                aria-valuemax={turnOf(range.total)}
                aria-valuenow={turnOf(shown)}
                aria-valuetext={count}
                onKeyDown={onKey}
            >
                <span className="scrub-words">{count}</span>
                {compact ? null : (
                    <span className="scrub-track" aria-hidden="true" onPointerDown={onTrack}>
                        <span className="scrub-fill" style={{ inlineSize: `${String(Math.round(filled * 1000) / 10)}%` }} />
                    </span>
                )}
            </span>
            {step(text.replay.on, `M9 5l7 7-7 7`, atEnd, stepTurn(shown, 1, range))}
            {compact ? null : step(live ? text.replay.toLatest : text.replay.toEnd, `M17 5v14M6 6l7 6-7 6`, atEnd, range.total)}
        </span>
    );
}

/**
 * The switch that follows a live game: on, the board shows each stone as
 * it lands; off, it holds where it stands.
 */
export function LiveSwitch({ replay }: { replay: Replay }) {
    return (
        <button
            type="button"
            className="btn btn-sm scrub-live"
            aria-pressed={replay.following}
            onClick={() => {
                replay.follow(!replay.following);
            }}
        >
            {text.replay.liveSwitch}
        </button>
    );
}
