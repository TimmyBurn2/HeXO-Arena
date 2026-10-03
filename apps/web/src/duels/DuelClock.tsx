import { useId, useState } from 'react';
import { scheduledIncrementMs, scheduledMainMs, scheduledTurnMs, type BotListing, type TimeControl } from '@hexo-arena/contract';
import { turnWindowOf } from '../play/accepts';
import { Stepper } from '../play/ClockPicker';
import { presetOf, sameClock } from '../play/setup';
import { text } from '../text';
import { defaultDuelClock, duelClocks, duelPresets, isPreset, refusedBy, takenByBoth } from './setup';

/**
 * A duel's clock: Play's presets but Unlimited, a preset either bot
 * refuses drawn as an outline naming the bot, or a clock set by hand
 * inside what both bots take and the bounds a duel keeps.
 */
export function DuelClock({ first, second, clock, onClock }: { first: BotListing; second: BotListing; clock: TimeControl; onClock: (clock: TimeControl) => void }) {
    const [byHand, setByHand] = useState(() => !isPreset(clock));
    const ids = useId();
    const out = duelPresets.filter((preset) => !takenByBoth(preset.clock, first, second));
    const limiting = out.length === 0 ? null : refusedBy(out[0]?.clock ?? clock, first, second);
    const limitingWindow = limiting === null ? null : turnWindowOf(limiting.accepts);
    return (
        <div className="setup-block">
            <h3 className="play-label" id={`${ids}-clock`}>
                {text.play.clock}
            </h3>
            {byHand ? (
                <HandClock first={first} second={second} clock={clock} onClock={onClock} />
            ) : (
                <div className="clock-grid clock-grid-duel" role="radiogroup" aria-labelledby={`${ids}-clock`}>
                    {duelPresets.map((preset) => {
                        const taken = takenByBoth(preset.clock, first, second);
                        const refuser = taken ? null : refusedBy(preset.clock, first, second);
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
                                        {text.duels.clockOut(refuser?.name ?? ``, preset.clock.mode === `match` ? tile.kind : `${tile.value} ${tile.kind}`)}
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
                          ? text.duels.clockFoot
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
                            const fallback = defaultDuelClock(first, second, null);
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

// A clock by hand: a turn clock in the window both bots take inside a
// duel's bounds, or a match clock in a duel's bounds when both take one.
function HandClock({ first, second, clock, onClock }: { first: BotListing; second: BotListing; clock: TimeControl; onClock: (clock: TimeControl) => void }) {
    const clocks = duelClocks(first, second);
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
