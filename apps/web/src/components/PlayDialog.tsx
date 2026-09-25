import { useMemo, useState } from 'react';
import { defaultOpeningTurns, discordLoginPath, type Accepts, type TimeControl } from '@hexarena/contract';
import { createGame, ApiError } from '../api/client';
import { Dialog } from './Dialog';
import { navigate } from '../router/use-route';

export interface PlayableBot {
    name: string;
    accepts: Accepts | undefined;
}

const turnFloorSeconds = 5;
const turnStepSeconds = 5;
const mainFloorMinutes = 1;
const mainMaxMinutes = 30;
const incrementMaxSeconds = 30;
const defaultMainMinutes = 5;
const defaultIncrementSeconds = 3;

const errorSentences: Record<string, (name: string) => string> = {
    human_busy: () => `you already have three live games`,
    game_cooldown: () => `a moment: one new game per minute`,
    bot_busy: (name) => `${name} is seated elsewhere`,
    clock_not_accepted: (name) => `${name} declined that clock`,
    not_open: (name) => `${name} is not open for challenges right now`,
    paused: () => `starting games is paused; live games continue`,
};

/** The accepted turn window as a pair, or null when turn clocks are out. */
export function turnWindowOf(accepts: Accepts | undefined): readonly [number, number] | null {
    const declared = accepts?.turnMs;
    if (declared === null || declared === undefined || declared.length !== 2) return null;
    const [min, max] = declared;
    if (min === undefined || max === undefined) return null;
    return [min, max];
}

/** Which clock modes the declaration covers; a segment needs its mode. */
export function coveredModes(accepts: Accepts | undefined): Record<`turn` | `match` | `unlimited`, boolean> {
    return {
        turn: accepts?.turnMs != null,
        match: accepts?.match === true,
        unlimited: accepts?.unlimited === true,
    };
}

function defaultTurnSeconds(window: readonly [number, number]): number {
    const min = Math.max(turnFloorSeconds, window[0] / 1000);
    const max = Math.max(min, window[1] / 1000);
    const snapped = Math.round(Math.min(Math.max(10, min), max) / turnStepSeconds) * turnStepSeconds;
    return Math.min(Math.max(snapped, min), max);
}

/**
 * The two-click play flow: the dialog opens already valid, the first
 * accepted mode selected and every slider inside its window, so the second
 * click is only ever a confirmation.
 */
export function PlayDialog({ bot, open, onClose }: { bot: PlayableBot; open: boolean; onClose: () => void }) {
    const covered = useMemo(() => coveredModes(bot.accepts), [bot.accepts]);
    const firstMode = covered.turn ? `turn` : covered.match ? `match` : covered.unlimited ? `unlimited` : null;
    const [mode, setMode] = useState<`turn` | `match` | `unlimited`>(firstMode ?? `turn`);
    const [turnSeconds, setTurnSeconds] = useState(() => {
        const window = turnWindowOf(bot.accepts);
        return window === null ? 10 : defaultTurnSeconds(window);
    });
    const [mainMinutes, setMainMinutes] = useState(defaultMainMinutes);
    const [incrementSeconds, setIncrementSeconds] = useState(defaultIncrementSeconds);
    const [openingTurns, setOpeningTurns] = useState<0 | 1 | 2 | 3 | 4>(defaultOpeningTurns);
    const [failure, setFailure] = useState<string | null>(null);
    const [sending, setSending] = useState(false);

    const turnWindow = turnWindowOf(bot.accepts);
    const turnMin = turnWindow === null ? turnFloorSeconds : Math.max(turnFloorSeconds, turnWindow[0] / 1000);
    const turnMax = turnWindow === null ? 60 : Math.max(turnMin, turnWindow[1] / 1000);

    async function start() {
        setSending(true);
        setFailure(null);
        const timeControl: TimeControl =
            mode === `turn`
                ? { mode: `turn`, turnTimeMs: turnSeconds * 1000 }
                : mode === `match`
                  ? { mode: `match`, mainTimeMs: mainMinutes * 60_000, incrementMs: incrementSeconds * 1000 }
                  : { mode: `unlimited` };
        try {
            const snapshot = await createGame({ bot: bot.name, timeControl, openingTurns });
            onClose();
            navigate(`/game/${encodeURIComponent(snapshot.gameId)}`);
        } catch (cause) {
            const sentence = cause instanceof ApiError && cause.code !== null ? errorSentences[cause.code] : undefined;
            if (sentence !== undefined) {
                setFailure(sentence(bot.name));
            } else if (cause instanceof ApiError && cause.status === 401) {
                setFailure(`sign in to start a game`);
            } else {
                setFailure(`the game could not start; try again`);
            }
            setSending(false);
        }
    }

    return (
        <Dialog open={open} onClose={onClose} label={`Play ${bot.name}`}>
            <h2>Play {bot.name}</h2>
            <div className="row">
                <span className="row-label">clock mode, only what the bot accepts</span>
                <div className="seg" role="group" aria-label="Clock mode">
                    {([`turn`, `match`, `unlimited`] as const).map((candidate) => (
                        <button
                            key={candidate}
                            type="button"
                            className={`seg-btn${mode === candidate ? ` active` : ``}`}
                            aria-pressed={mode === candidate}
                            aria-disabled={!covered[candidate] ? `true` : undefined}
                            onClick={() => {
                                if (covered[candidate]) setMode(candidate);
                            }}
                        >
                            {candidate === `turn` ? `Turn` : candidate === `match` ? `Match` : `Unlimited`}
                        </button>
                    ))}
                </div>
            </div>

            {mode === `turn` && turnWindow !== null ? (
                <div className="mode-panel">
                    <div className="slider-row">
                        <div className="slider-head">
                            <span className="slider-label">turn clock</span>
                            <span className="slider-value">{String(turnSeconds)} s</span>
                        </div>
                        <input
                            type="range"
                            min={turnMin}
                            max={turnMax}
                            step={turnStepSeconds}
                            value={turnSeconds}
                            aria-label="turn clock seconds"
                            aria-valuetext={`${String(turnSeconds)} seconds`}
                            onChange={(event) => {
                                setTurnSeconds(Number(event.target.value));
                            }}
                        />
                        <div className="ticks">
                            <span>{`${String(turnMin)}s`}</span>
                            <span>{`${String(Math.round((turnMin + turnMax) / 2))}s`}</span>
                            <span>{`${String(turnMax)}s`}</span>
                        </div>
                    </div>
                    <p className="note">
                        clamped to the bot's window: {String(turnMin)} - {String(turnMax)} s
                    </p>
                </div>
            ) : null}

            {mode === `match` ? (
                <div className="mode-panel">
                    <div className="slider-row">
                        <div className="slider-head">
                            <span className="slider-label">main time</span>
                            <span className="slider-value">{String(mainMinutes)} min</span>
                        </div>
                        <input
                            type="range"
                            min={mainFloorMinutes}
                            max={mainMaxMinutes}
                            step={1}
                            value={mainMinutes}
                            aria-label="main time minutes"
                            aria-valuetext={`${String(mainMinutes)} minutes`}
                            onChange={(event) => {
                                setMainMinutes(Number(event.target.value));
                            }}
                        />
                        <div className="ticks">
                            <span>1m</span>
                            <span>15m</span>
                            <span>30m</span>
                        </div>
                    </div>
                    <div className="slider-row">
                        <div className="slider-head">
                            <span className="slider-label">increment</span>
                            <span className="slider-value">+{String(incrementSeconds)} s</span>
                        </div>
                        <input
                            type="range"
                            min={0}
                            max={incrementMaxSeconds}
                            step={1}
                            value={incrementSeconds}
                            aria-label="increment seconds"
                            aria-valuetext={`plus ${String(incrementSeconds)} seconds`}
                            onChange={(event) => {
                                setIncrementSeconds(Number(event.target.value));
                            }}
                        />
                        <div className="ticks">
                            <span>0s</span>
                            <span>15s</span>
                            <span>30s</span>
                        </div>
                    </div>
                </div>
            ) : null}

            {mode === `unlimited` ? (
                <div className="mode-panel">
                    <p className="note">no clocks; the server caps the game at 24 hours</p>
                </div>
            ) : null}

            <div className="row">
                <details className="advanced">
                    <summary>advanced session</summary>
                    <fieldset>
                        <legend>opening turns after the origin, placed by the server</legend>
                        <div className="controls">
                            {([0, 1, 2, 3, 4] as const).map((count) => (
                                <span className="opt" key={count}>
                                    <input
                                        type="radio"
                                        id={`opening-${String(count)}`}
                                        name="opening-turns"
                                        value={count}
                                        checked={openingTurns === count}
                                        onChange={() => {
                                            setOpeningTurns(count);
                                        }}
                                    />
                                    <label htmlFor={`opening-${String(count)}`}>{String(count)}</label>
                                </span>
                            ))}
                        </div>
                    </fieldset>
                </details>
            </div>

            <p className="note">
                {openingTurns === 0
                    ? `the opening stone lands before your first turn; two stones per turn, always`
                    : `the opening stone and ${String(openingTurns)} random ${openingTurns === 1 ? `turn` : `turns`} land before your first turn; two stones per turn, always`}
            </p>
            {failure !== null ? (
                <p className="field-error" role="alert">
                    {failure}
                </p>
            ) : null}
            {failure === `sign in to start a game` ? (
                <p>
                    <a className="btn btn-ghost btn-sm" href={discordLoginPath}>
                        Sign in with Discord
                    </a>
                </p>
            ) : null}
            <p>
                <button type="button" className="btn btn-primary" disabled={sending} onClick={() => void start()}>
                    Start game
                </button>
            </p>
        </Dialog>
    );
}
