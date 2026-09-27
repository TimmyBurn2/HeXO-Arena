import type { ReactNode } from 'react';
import type { GameSnapshot, Side } from '@hexo-arena/contract';
import { BotBadge, Rating, Swatch } from '../components/player';
import { selfName, type MeState } from '../me';
import { Link } from '../router/Link';
import { Clock } from './Clock';
import type { TurnStatus } from './GameBoard';
import type { GameLink } from './use-game';
import { resultLine } from './snapshot-views';

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

/**
 * One seat as a chip: swatch, name with its BOT badge, rating or the
 * unrated tag of a guest, and its clock.
 * The top chip also carries the exit and, while running, the clock mode.
 */
export function SeatChip({ snapshot, side, corner }: { snapshot: GameSnapshot; side: Side; corner: `top` | `bottom` }) {
    const player = snapshot.players[side];
    const top = corner === `top`;
    return (
        <Chip className={top ? `hud-top-left` : `hud-bottom-left`}>
            {top ? (
                <Link to="/" className="hud-exit" ariaLabel="Leave to the ladder">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M15 5l-7 7 7 7" />
                    </svg>
                </Link>
            ) : null}
            <Swatch side={side} />
            <span className="hud-who">
                <span className="hud-name">
                    {player.name}
                    {player.kind === `bot` ? <BotBadge /> : null}
                </span>
                <span className="hud-meta">
                    {player.rating === null ? (
                        <span className="tag muted">unrated</span>
                    ) : (
                        <span className="hud-rating">
                            <Rating value={player.rating} provisional={player.provisional} />
                        </span>
                    )}
                    {top && snapshot.status === `in-progress` ? <span>{clockModeText(snapshot)}</span> : null}
                </span>
            </span>
            {clockOf(snapshot, side)}
        </Chip>
    );
}

export function YouChip({ snapshot, you, me }: { snapshot: GameSnapshot; you: Side; me: MeState }) {
    const self = me.status === `ready` ? me.me : null;
    return (
        <Chip className="hud-bottom-left">
            <Swatch side={you} />
            <span className="hud-who">
                <span className="hud-name">{selfName(me)}</span>
                <span className="hud-meta">
                    {self?.kind === `user` ? (
                        <span className="hud-rating">
                            <Rating value={self.rating} provisional={self.provisional} />
                        </span>
                    ) : null}
                    {self?.kind === `guest` ? <span className="tag muted">unrated</span> : null}
                    <span>Playing {you}</span>
                </span>
            </span>
            {clockOf(snapshot, you)}
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
 * Whose turn it is, in one chip: your two stones, the side to move
 * thinking, or the result with the ways onward.
 * A watcher, who holds no side, sees the side to move marked as watched.
 */
export function TurnChip({ snapshot, you, status, link, onMoves }: {
    snapshot: GameSnapshot;
    you: Side | null;
    status: TurnStatus;
    link: GameLink;
    onMoves: () => void;
}) {
    // A refused stream is the watcher cap, not a fault, so it reads calm; a
    // seat is never refused, so a player only ever sees the loss.
    if (link === `refused` && you === null) {
        return (
            <Chip className="hud-bottom-center">
                <span className="tag muted">watching</span>
                <span className="hud-hint" role="status">
                    Many watching; the board catches up shortly
                </span>
            </Chip>
        );
    }
    if (link !== `up`) {
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
                <Link to="/ladder" className="btn btn-primary btn-sm">
                    Ladder
                </Link>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onMoves}>
                    Moves
                </button>
            </Chip>
        );
    }
    if (snapshot.toMove !== you) {
        return (
            <Chip className="hud-bottom-center">
                {you === null ? <span className="tag muted">watching</span> : null}
                <span className="hud-turn" role="status">
                    {snapshot.players[snapshot.toMove].name} is thinking
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
