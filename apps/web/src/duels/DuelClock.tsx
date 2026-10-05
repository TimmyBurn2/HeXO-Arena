import { useId, useState } from 'react';
import { scheduledIncrementMs, scheduledMainMs, scheduledTurnMs, type BotListing, type TimeControl } from '@hexo-arena/contract';
import { turnWindowOf } from '../play/accepts';
import { Stepper } from '../play/ClockPicker';
import { presetOf, sameClock } from '../play/setup';
import { text } from '../text';
import { defaultFieldClock, duelPresets, fieldClocks, isPreset, refusersOf, takenByAll } from './setup';

/**
 * A scheduled game's clock for a field, a duel's two bots or a round
 * robin's: Play's presets but Unlimited, a preset a bot refuses drawn as an
 * outline naming the bots, or a clock set by hand inside what every bot
 * takes and the bounds a scheduled game keeps. The foot says what every
 * bot takes, unless one limits the presets.
 */
export function DuelClock({ field, clock, foot, onClock }: { field: readonly BotListing[]; clock: TimeControl; foot: string; onClock: (clock: TimeControl) => void }) {
    const [byHand, setByHand] = useState(() => !isPreset(clock));
    const ids = useId();
    const out = duelPresets.filter((preset) => !takenByAll(preset.clock, field));
    const limiting = out.length === 0 ? null : (refusersOf(out[0]?.clock ?? clock, field)[0] ?? null);
    const limitingWindow = limiting === null ? null : turnWindowOf(limiting.accepts);
    return (
        <div className="setup-block">
            <h3 className="play-label" id={`${ids}-clock`}>
                {text.play.clock}
            </h3>
            {byHand ? (
                <HandClock field={field} clock={clock} onClock={onClock} />
            ) : (
                <div className="clock-grid clock-grid-duel" role="radiogroup" aria-labelledby={`${ids}-clock`}>
                    {duelPresets.map((preset) => {
                        const taken = takenByAll(preset.clock, field);
                        const refusers = taken ? [] : refusersOf(preset.clock, field).map((bot) => bot.name);
                        const tile = text.play.tiles[preset.id];
                        return (
                            <label key={preset.id} className="clock-tile">
                                <input
                                    type="radio"
                                    name={`${ids}-preset`}
                                    value={preset.id}
                                    aria-label={tile.name}
                                    aria-describedby={taken ? undefined : `${ids}-${preset.id}-out`}
                                    checked={presetOf(clock)?.id === preset.id}
                                    disabled={!taken}
                                    onChange={() => {
                                        onClock(preset.clock);
                                    }}
                                />
                                <span className="clock-value" aria-hidden="true">
                                    {tile.value}
                                </span>
                                {taken ? (
                                    <span className="clock-kind" aria-hidden="true">
                                        {tile.kind}
                                    </span>
                                ) : (
                                    <span className="clock-out" id={`${ids}-${preset.id}-out`}>
                                        {text.duels.clockOut(refusers, preset.clock.mode === `match` ? tile.kind : `${tile.value} ${tile.kind}`)}
                                    </span>
                                )}
                            </label>
                        );
                    })}
                </div>
            )}
            <div className="clock-foot">
                <p className="note">
                    {byHand
                        ? null
                        : limiting === null || limiting.accepts === undefined
                          ? foot
                          : text.play.acceptsLine(limiting.name, {
                                turn: limitingWindow === null ? null : [limitingWindow[0] / 1000, limitingWindow[1] / 1000],
                                match: limiting.accepts.match,
                                unlimited: false,
                            })}
                </p>
                <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                        if (byHand && !isPreset(clock)) {
                            const fallback = defaultFieldClock(field, null);
                            if (fallback !== null) onClock(fallback);
                        }
                        setByHand(!byHand);
                    }}
                >
                    {byHand ? text.play.presets : text.play.customClock}
                </button>
            </div>
        </div>
    );
}

// A clock by hand: a turn clock in the window every bot takes inside a
// scheduled game's bounds, or a match clock in them when every bot takes one.
function HandClock({ field, clock, onClock }: { field: readonly BotListing[]; clock: TimeControl; onClock: (clock: TimeControl) => void }) {
    const clocks = fieldClocks(field);
    const turnBounds = clocks.turn;
    const mainBounds = { min: scheduledMainMs.min / 60_000, max: scheduledMainMs.max / 60_000 };
    const incrementBounds = { min: scheduledIncrementMs.min / 1000, max: scheduledIncrementMs.max / 1000 };
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
    const mode = clock.mode === `match` && clocks.match ? `match` : turnBounds !== null ? `turn` : `match`;
    const seconds = clock.mode === `turn` ? clock.turnTimeMs / 1000 : (turnBounds?.[0] ?? scheduledTurnMs.min / 1000);
    const minutes = clock.mode === `match` ? clock.mainTimeMs / 60_000 : 5;
    const increment = clock.mode === `match` ? clock.incrementMs / 1000 : 3;
    const set = (next: TimeControl) => {
        if (!sameClock(next, clock)) onClock(next);
    };
    return (
        <div className="custom">
            <div className="seg" role="group" aria-label={text.play.clock}>
                <button
                    type="button"
                    className={`seg-btn${mode === `turn` ? ` active` : ``}`}
                    aria-pressed={mode === `turn`}
                    aria-disabled={turnBounds === null ? `true` : undefined}
                    onClick={() => {
                        if (turnBounds !== null && mode !== `turn`) set({ mode: `turn`, turnTimeMs: clamp(20, turnBounds[0], turnBounds[1]) * 1000 });
                    }}
                >
                    {text.play.turn}
                </button>
                <button
                    type="button"
                    className={`seg-btn${mode === `match` ? ` active` : ``}`}
                    aria-pressed={mode === `match`}
                    aria-disabled={clocks.match ? undefined : `true`}
                    onClick={() => {
                        if (clocks.match && mode !== `match`) set({ mode: `match`, mainTimeMs: 300_000, incrementMs: 3_000 });
                    }}
                >
                    {text.play.match}
                </button>
            </div>
            {mode === `turn` && turnBounds !== null ? (
                <Stepper
                    label={text.play.turnClock}
                    value={seconds}
                    min={turnBounds[0]}
                    max={turnBounds[1]}
                    step={5}
                    shown={text.play.seconds}
                    spoken={text.play.secondsSpoken}
                    onValue={(value) => {
                        set({ mode: `turn`, turnTimeMs: value * 1000 });
                    }}
                />
            ) : mode === `match` ? (
                <>
                    <Stepper
                        label={text.play.mainTime}
                        value={minutes}
                        min={mainBounds.min}
                        max={mainBounds.max}
                        step={1}
                        shown={text.play.minutes}
                        spoken={text.play.minutesSpoken}
                        onValue={(value) => {
                            set({ mode: `match`, mainTimeMs: value * 60_000, incrementMs: increment * 1000 });
                        }}
                    />
                    <Stepper
                        label={text.play.increment}
                        value={increment}
                        min={incrementBounds.min}
                        max={incrementBounds.max}
                        step={1}
                        shown={text.play.plusSeconds}
                        spoken={text.play.plusSecondsSpoken}
                        onValue={(value) => {
                            set({ mode: `match`, mainTimeMs: minutes * 60_000, incrementMs: value * 1000 });
                        }}
                    />
                </>
            ) : null}
        </div>
    );
}
