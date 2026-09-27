import { useMemo, useState } from 'react';
import {
    defaultOpeningPlies,
    openingPliesValues,
    type Accepts,
    type OpeningPlies,
    type TimeControl,
} from '@hexo-arena/contract';
import { createGame, ApiError } from '../api/client';
import { Dialog } from './Dialog';
import { DiscordSignIn } from './DiscordButton';
import { meStore, useMe } from '../me';
import { navigate } from '../router/use-route';
import './PlayDialog.css';

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
    human_busy: () => `You already have three live games`,
    game_cooldown: () => `A moment: one new game per minute`,
    bot_busy: (name) => `${name} is seated elsewhere`,
    clock_not_accepted: (name) => `${name} declined that clock`,
    not_open: (name) => `${name} is not open for challenges right now`,
    paused: () => `Starting games is paused; live games continue`,
};

const guestLimitSentence = `Too many guests right now; try in a minute or sign in`;

// A refused session is its own failure, since it swaps the start action
// for the sign-in rather than only saying what went wrong.
type Failure = { kind: `message`; text: string } | { kind: `sign-in` };

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
    const [openingPlies, setOpeningPlies] = useState<OpeningPlies>(defaultOpeningPlies);
    const [failure, setFailure] = useState<Failure | null>(null);
    const [sending, setSending] = useState(false);
    const me = useMe();
    const signedOut = me.status === `ready` && me.me === null;
    const guestName = me.status === `ready` && me.me?.kind === `guest` ? me.me.name : null;

    const turnWindow = turnWindowOf(bot.accepts);
    const turnMin = turnWindow === null ? turnFloorSeconds : Math.max(turnFloorSeconds, turnWindow[0] / 1000);
    const turnMax = turnWindow === null ? 60 : Math.max(turnMin, turnWindow[1] / 1000);

    // A signed-out player becomes a guest and starts the game in the same
    // click, so the dialog stays one confirmation.
    async function startAsGuest() {
        setSending(true);
        setFailure(null);
        try {
            await meStore.guest();
        } catch (cause) {
            setFailure({
                kind: `message`,
                text:
                    cause instanceof ApiError && cause.code === `guest_limit`
                        ? guestLimitSentence
                        : `The guest session did not start; try again`,
            });
            setSending(false);
            return;
        }
        await start();
    }

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
            const snapshot = await createGame({ bot: bot.name, timeControl, openingPlies });
            onClose();
            navigate(`/game/${encodeURIComponent(snapshot.gameId)}`);
        } catch (cause) {
            const sentence = cause instanceof ApiError && cause.code !== null ? errorSentences[cause.code] : undefined;
            if (sentence !== undefined) {
                setFailure({ kind: `message`, text: sentence(bot.name) });
            } else if (cause instanceof ApiError && cause.status === 401) {
                // The session ended on the server; asking again lets the
                // top bar and this dialog show the visitor as signed out.
                setFailure({ kind: `sign-in` });
                void meStore.refresh();
            } else {
                setFailure({ kind: `message`, text: `The game could not start; try again` });
            }
            setSending(false);
        }
    }

    return (
        <Dialog open={open} onClose={onClose} label={`Play ${bot.name}`}>
            <h2>Play {bot.name}</h2>
            <div className="row">
                <span className="row-label">Clock mode, only what the bot accepts</span>
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
                            <span className="slider-label">Turn clock</span>
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
                        Clamped to the bot's window: {String(turnMin)} to {String(turnMax)} s.
                    </p>
                </div>
            ) : null}

            {mode === `match` ? (
                <div className="mode-panel">
                    <div className="slider-row">
                        <div className="slider-head">
                            <span className="slider-label">Main time</span>
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
                            <span className="slider-label">Increment</span>
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
                    <p className="note">No clocks; the server caps the game at 24 hours.</p>
                </div>
            ) : null}

            <div className="row">
                <details className="advanced">
                    <summary>Advanced session</summary>
                    <fieldset>
                        <legend>Opening stones, the origin included</legend>
                        <div className="controls">
                            {openingPliesValues.map((count) => (
                                <span className="opt" key={count}>
                                    <input
                                        type="radio"
                                        id={`opening-${String(count)}`}
                                        name="opening-plies"
                                        value={count}
                                        checked={openingPlies === count}
                                        onChange={() => {
                                            setOpeningPlies(count);
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
                {openingPlies === 1
                    ? `Only the origin stone lands before either side moves; every turn after it places two stones.`
                    : `The origin and ${String(openingPlies - 1)} random stones land before either side moves; every turn after them places two stones.`}
            </p>
            {failure !== null ? (
                <p className="field-error" role="alert">
                    {failure.kind === `message` ? failure.text : `Sign in to start a game`}
                </p>
            ) : null}
            {guestName === null ? null : <p className="note">You play as {guestName}; guest games are unrated.</p>}
            {signedOut ? (
                <>
                    <p className="note">Play now as a guest, unrated, or sign in to play rated.</p>
                    <p className="card-actions">
                        <button type="button" className="btn btn-primary" disabled={sending} onClick={() => void startAsGuest()}>
                            Play as guest
                        </button>
                    </p>
                    <DiscordSignIn />
                </>
            ) : failure?.kind === `sign-in` ? (
                <DiscordSignIn />
            ) : (
                <p>
                    <button type="button" className="btn btn-primary" disabled={sending} onClick={() => void start()}>
                        Start game
                    </button>
                </p>
            )}
        </Dialog>
    );
}
