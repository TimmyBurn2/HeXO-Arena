import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { BotListing, TimeControl } from '@hexo-arena/contract';
import { text } from '../text';
import { turnWindowOf } from './accepts';
import { accepts, clockFor, custom, presetOf, presets, turnBounds } from './setup';

/**
 * The clock: six presets, a refused one drawn as an outline with its
 * reason, or a clock set by hand.
 */
export function ClockPicker({
    bot,
    clock,
    last,
    onClock,
    onAdjust,
}: {
    bot: BotListing;
    clock: TimeControl;
    // The clock of the last game started here, the default when a clock set by hand gives way.
    last: TimeControl | null;
    // A clock the person picks, a press on the one shown included.
    onClock: (clock: TimeControl) => void;
    // A clock the picker sets itself, which is no pick of the person's.
    onAdjust: (clock: TimeControl) => void;
}) {
    const [byHand, setByHand] = useState(() => presetOf(clock) === undefined);
    const [swapped, setSwapped] = useState(false);
    const block = useRef<HTMLDivElement>(null);
    const ids = useId();

    // The swap replaces the controls above the button that made it,
    // so focus goes to the picked mode or preset, where the new controls begin.
    useEffect(() => {
        if (!swapped) return;
        setSwapped(false);
        block.current?.querySelector<HTMLElement>(byHand ? `.seg-btn.active` : `input:checked`)?.focus();
    }, [swapped, byHand]);

    const someOut = presets.some((preset) => !accepts(bot, preset.clock));
    const turnWindow = turnWindowOf(bot.accepts);
    return (
        <div className="setup-block" ref={block}>
            <h3 className="play-label" id={`${ids}-clock`}>
                {text.play.clock}
            </h3>
            {byHand ? (
                <CustomClock bot={bot} clock={clock} onClock={onClock} onAdjust={onAdjust} />
            ) : (
                <div className="clock-grid" role="radiogroup" aria-labelledby={`${ids}-clock`}>
                    {presets.map((preset) => {
                        const taken = accepts(bot, preset.clock);
                        const tile = text.play.tiles[preset.id];
                        return (
                            <label key={preset.id} className="clock-tile">
                                <input
                                    type="radio"
                                    name={`${ids}-preset`}
                                    value={preset.id}
                                    aria-label={tile.name}
                                    aria-describedby={taken ? (preset.id === `u` && clock.mode === `unlimited` ? `${ids}-unlimited` : undefined) : `${ids}-${preset.id}-out`}
                                    checked={presetOf(clock)?.id === preset.id}
                                    disabled={!taken}
                                    onChange={() => {
                                        onClock(preset.clock);
                                    }}
                                    onClick={() => {
                                        // A press on the tile already picked changes nothing but is still the person's pick.
                                        if (presetOf(clock)?.id === preset.id) onClock(preset.clock);
                                    }}
                                    onKeyUp={(event) => {
                                        // Space on a radio already checked fires no click.
                                        if (event.key === ` ` && presetOf(clock)?.id === preset.id) onClock(preset.clock);
                                    }}
                                />
                                <span className="clock-value" aria-hidden="true">
                                    {tile.value}
                                </span>
                                <span className="clock-kind" aria-hidden="true">
                                    {tile.kind}
                                </span>
                                {taken ? null : (
                                    <span className="sr-only" id={`${ids}-${preset.id}-out`}>
                                        {text.play.tileOut(bot.name)}
                                    </span>
                                )}
                            </label>
                        );
                    })}
                </div>
            )}
            {clock.mode === `unlimited` && !byHand ? (
                <p className="note unlimited-note" id={`${ids}-unlimited`}>
                    {text.play.unlimitedNote}
                </p>
            ) : null}
            <div className="clock-foot">
                <p className="note">
                    {someOut && !byHand && bot.accepts !== undefined
                        ? text.play.acceptsLine(bot.name, {
                              turn: turnWindow === null ? null : [turnWindow[0] / 1000, turnWindow[1] / 1000],
                              match: bot.accepts.match,
                              unlimited: bot.accepts.unlimited,
                          })
                        : null}
                </p>
                <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                        // Back on the presets, a clock set by hand gives way to the bot's default.
                        onClock(byHand && presetOf(clock) === undefined ? clockFor(bot, null, last) : clock);
                        setByHand(!byHand);
                        setSwapped(true);
                    }}
                >
                    {byHand ? text.play.presets : text.play.customClock}
                </button>
            </div>
        </div>
    );
}

// A clock by hand: a turn clock inside what the bot accepts, in whole
// steps, or a match clock of main time and increment.
function CustomClock({
    bot,
    clock,
    onClock,
    onAdjust,
}: {
    bot: BotListing;
    clock: TimeControl;
    onClock: (clock: TimeControl) => void;
    onAdjust: (clock: TimeControl) => void;
}) {
    const bounds = turnBounds(bot.accepts);
    const takesMatch = bot.accepts?.match === true;
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
    const turn = (seconds: number) => {
        if (bounds !== null) onClock({ mode: `turn`, turnTimeMs: clamp(seconds, bounds.min, bounds.max) * 1000 });
    };
    const match = (minutes: number, increment: number) => {
        onClock({
            mode: `match`,
            mainTimeMs: clamp(minutes, custom.mainMinutes.min, custom.mainMinutes.max) * 60_000,
            incrementMs: clamp(increment, custom.incrementSeconds.min, custom.incrementSeconds.max) * 1000,
        });
    };
    const mode = clock.mode === `unlimited` ? (bounds !== null ? `turn` : `match`) : clock.mode;
    // An unlimited clock has no setting by hand; the first mode the bot takes stands in.
    useEffect(() => {
        if (clock.mode !== `unlimited`) return;
        if (bounds !== null) onAdjust({ mode: `turn`, turnTimeMs: bounds.min * 1000 });
        else if (takesMatch) onAdjust({ mode: `match`, mainTimeMs: 300_000, incrementMs: 3_000 });
    }, [clock.mode, bounds, takesMatch, onAdjust]);
    const seconds = clock.mode === `turn` ? clock.turnTimeMs / 1000 : (bounds?.min ?? custom.turnFloorSeconds);
    const minutes = clock.mode === `match` ? clock.mainTimeMs / 60_000 : 5;
    const increment = clock.mode === `match` ? clock.incrementMs / 1000 : 3;
    return (
        <div className="custom">
            <div className="seg" role="group" aria-label={text.play.clock}>
                <button
                    type="button"
                    className={`seg-btn${mode === `turn` ? ` active` : ``}`}
                    aria-pressed={mode === `turn`}
                    aria-disabled={bounds === null ? `true` : undefined}
                    onClick={() => {
                        if (bounds !== null && mode !== `turn`) turn(clamp(20, bounds.min, bounds.max));
                    }}
                >
                    {text.play.turn}
                </button>
                <button
                    type="button"
                    className={`seg-btn${mode === `match` ? ` active` : ``}`}
                    aria-pressed={mode === `match`}
                    aria-disabled={takesMatch ? undefined : `true`}
                    onClick={() => {
                        if (takesMatch && mode !== `match`) match(5, 3);
                    }}
                >
                    {text.play.match}
                </button>
            </div>
            {mode === `turn` && bounds !== null ? (
                <Stepper
                    label={text.play.turnClock}
                    value={seconds}
                    min={bounds.min}
                    max={bounds.max}
                    step={custom.turnStepSeconds}
                    shown={text.play.seconds}
                    spoken={text.play.secondsSpoken}
                    onValue={turn}
                />
            ) : mode === `match` ? (
                <>
                    <Stepper
                        label={text.play.mainTime}
                        value={minutes}
                        min={custom.mainMinutes.min}
                        max={custom.mainMinutes.max}
                        step={1}
                        shown={text.play.minutes}
                        spoken={text.play.minutesSpoken}
                        onValue={(value) => {
                            match(value, increment);
                        }}
                    />
                    <Stepper
                        label={text.play.increment}
                        value={increment}
                        min={custom.incrementSeconds.min}
                        max={custom.incrementSeconds.max}
                        step={1}
                        shown={text.play.plusSeconds}
                        spoken={text.play.plusSecondsSpoken}
                        onValue={(value) => {
                            match(minutes, value);
                        }}
                    />
                </>
            ) : null}
        </div>
    );
}

// The value is a spin button too, so the arrow keys, Home and End reach it without the buttons;
// a button at its end stays focusable, so pressing it there never drops focus.
function Stepper({
    label,
    value,
    min,
    max,
    step,
    shown,
    spoken,
    onValue,
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    shown: (value: number) => string;
    spoken: (value: number) => string;
    onValue: (value: number) => void;
}) {
    const id = useId();
    function onKey(event: KeyboardEvent) {
        const moves: Record<string, number> = { ArrowUp: value + step, ArrowRight: value + step, ArrowDown: value - step, ArrowLeft: value - step, Home: min, End: max };
        const next = moves[event.key];
        if (next === undefined) return;
        event.preventDefault();
        onValue(Math.min(Math.max(next, min), max));
    }
    return (
        <div className="stepper-row">
            <span className="play-label" id={id}>
                {label}
            </span>
            <span className="stepper">
                <button
                    type="button"
                    aria-label={text.play.decrease(label)}
                    aria-disabled={value <= min ? `true` : undefined}
                    onClick={() => {
                        if (value > min) onValue(value - step);
                    }}
                >
                    -
                </button>
                <span
                    className="stepper-value"
                    role="spinbutton"
                    tabIndex={0}
                    aria-labelledby={id}
                    aria-valuenow={value}
                    aria-valuemin={min}
                    aria-valuemax={max}
                    aria-valuetext={spoken(value)}
                    onKeyDown={onKey}
                >
                    {shown(value)}
                </span>
                <button
                    type="button"
                    aria-label={text.play.increase(label)}
                    aria-disabled={value >= max ? `true` : undefined}
                    onClick={() => {
                        if (value < max) onValue(value + step);
                    }}
                >
                    +
                </button>
            </span>
        </div>
    );
}
