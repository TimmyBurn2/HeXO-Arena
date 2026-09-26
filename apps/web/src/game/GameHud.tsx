import type { ReactNode } from 'react';
import type { GameSnapshot, Side } from '@hexarena/contract';
import { BotBadge, provisionalNote, Rating } from '../components/player';
import { selfName, type MeState } from '../me';
import { Link } from '../router/Link';
import { Clock } from './Clock';
import type { TurnStatus } from './GameBoard';
import { resultLine } from './snapshot-views';

/** A side's stone as a small cell, tying a chip to the board without a legend. */
export function Swatch({ side }: { side: Side }) {
    return <span className={`swatch swatch-${side}`} aria-hidden="true" />;
}

/**
 * The side's clock at the read: match clocks on both chips, the shared turn
 * clock on the chip to move, nothing when unlimited.
 */
export function clockOf(snapshot: GameSnapshot, side: Side): ReactNode {
    const running = snapshot.status === `in-progress`;
    const active = running && snapshot.toMove === side;
    const clock = snapshot.clock;
    if (clock === undefined) return null;
    if (clock.mode === `match`) return <Clock remainingMs={clock.remainingMainMs[side]} running={active} />;
    if (clock.mode === `turn` && active) return <Clock remainingMs={clock.remainingTurnMs} running />;
    return null;
}

/** The time control in the words the play dialog used. */
export function clockModeText(snapshot: GameSnapshot): string {
    const clock = snapshot.clock;
    if (clock === undefined) return `game over`;
    if (clock.mode === `unlimited`) return `no clock`;
    return clock.mode === `turn` ? `turn clock` : `match clock`;
}

function Chip({ className, children }: { className: string; children: ReactNode }) {
    // The lift sits on this wrapper because the cut clips it on the chip.
    return (
        <div className={`hud-lift ${className}`}>
            <div className="hud-chip">{children}</div>
        </div>
    );
}

export function OpponentChip({ snapshot }: { snapshot: GameSnapshot }) {
    const side: Side = snapshot.you === `x` ? `o` : `x`;
    const opponent = snapshot.opponent;
    return (
        <Chip className="hud-top-left">
            <Link to="/" className="hud-exit" ariaLabel="Leave to the arena">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M15 5l-7 7 7 7" />
                </svg>
            </Link>
            <Swatch side={side} />
            <span className="hud-who">
                <span className="hud-name">
                    {opponent.name}
                    <BotBadge />
                </span>
                <span className="hud-meta">
                    <span className="hud-rating">{String(opponent.rating)}</span>
                    {opponent.provisional ? (
                        <span className="prov" title={provisionalNote}>
                            ?
                        </span>
                    ) : null}
                    {snapshot.status === `in-progress` ? <span>{clockModeText(snapshot)}</span> : null}
                </span>
            </span>
            {clockOf(snapshot, side)}
        </Chip>
    );
}

export function YouChip({ snapshot, me }: { snapshot: GameSnapshot; me: MeState }) {
    const self = me.status === `ready` ? me.me : null;
    return (
        <Chip className="hud-bottom-left">
            <Swatch side={snapshot.you} />
            <span className="hud-who">
                <span className="hud-name">{selfName(me)}</span>
                <span className="hud-meta">
                    {self?.kind === `user` ? (
                        <span className="hud-rating">
                            <Rating value={self.rating} provisional={self.provisional} />
                        </span>
                    ) : null}
                    {self?.kind === `guest` ? <span className="tag muted">unrated</span> : null}
                    <span>Playing {snapshot.you}</span>
                </span>
            </span>
            {clockOf(snapshot, snapshot.you)}
        </Chip>
    );
}

/** Two cells that fill as the turn's stones are marked. */
export function Pips({ placed }: { placed: 0 | 1 }) {
    return (
        <span className="pips" aria-hidden="true">
            <span className={`pip${placed === 1 ? ` on` : ``}`} />
            <span className="pip" />
        </span>
    );
}

/**
 * Whose turn it is, in one chip: your two stones, the opponent thinking,
 * or the result with the ways onward.
 */
export function TurnChip({ snapshot, status, stale, onMoves }: {
    snapshot: GameSnapshot;
    status: TurnStatus;
    stale: boolean;
    onMoves: () => void;
}) {
    if (stale) {
        return (
            <Chip className="hud-bottom-center">
                <span className="hud-note" role="status">
                    Connection lost, retrying
                </span>
            </Chip>
        );
    }
    if (snapshot.status === `finished`) {
        return (
            <Chip className="hud-bottom-center">
                <span className="hud-result" role="status">
                    {resultLine(snapshot)}
                </span>
                <Link to="/" className="btn btn-primary btn-sm">
                    Arena
                </Link>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onMoves}>
                    Moves
                </button>
            </Chip>
        );
    }
    if (snapshot.toMove !== snapshot.you) {
        return (
            <Chip className="hud-bottom-center">
                <span className="hud-turn" role="status">
                    {snapshot.opponent.name} is thinking
                </span>
            </Chip>
        );
    }
    return (
        <Chip className="hud-bottom-center">
            <span className="hud-turn">Your move</span>
            <Pips placed={status.placed} />
            {status.note === null ? (
                <span className="hud-hint" role="status">
                    {status.placed === 0 ? `Two stones` : `One stone left`}
                </span>
            ) : (
                <span className="hud-note" role="alert">
                    {status.note}
                </span>
            )}
        </Chip>
    );
}
