import type { ReactNode } from 'react';
import { atLevel, clockText, type GameSnapshot, type Side } from '@hexo-arena/contract';
import { BotBadge, Rating, seatLevelFacts, seatName, Swatch } from '../components/player';
import { WaitText } from '../components/wait';
import { selfName, type MeState } from '../me';
import { Link } from '../router/Link';
import { text } from '../text';
import { Clock } from './Clock';
import type { TurnStatus } from './GameBoard';
import type { GameLink } from './use-game';
import { gameLink } from '../analysis/links';
import { turnOf, type Replay } from './replay';
import { LiveSwitch, Scrubber } from './Scrubber';
import { resultLine } from './snapshot-views';
import './hud.css';

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

function Chip({ className, children }: { className: string; children: ReactNode }) {
    // The lift sits on this wrapper because the cut clips it on the chip.
    return (
        <div className={`hud-lift ${className}`}>
            <div className="hud-chip">{children}</div>
        </div>
    );
}

/**
 * One seat as a chip: swatch, name with its BOT badge, then any level, whose
 * budget is its title, and the rating or the unrated tag of a guest or a
 * bot at a level, and its clock.
 * A person who started the game unrated keeps their rating with the tag beside it.
 * The top chip also carries the exit and, while running, the clock mode.
 */
export function SeatChip({ snapshot, side, corner }: { snapshot: GameSnapshot; side: Side; corner: `top` | `bottom` }) {
    const player = snapshot.players[side];
    const top = corner === `top`;
    const choseUnrated = snapshot.unratedByChoice === true && player.kind === `user`;
    return (
        <Chip className={top ? `hud-top-left` : `hud-bottom-left`}>
            {top ? (
                <Link to="/" className="hud-exit" ariaLabel={text.game.exit}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M15 5l-7 7 7 7" />
                    </svg>
                </Link>
            ) : null}
            <Swatch side={side} />
            <span className="hud-who">
                <span className="hud-name">
                    <span className={player.deleted === true ? `deleted-name` : undefined}>{player.name}</span>
                    {player.kind === `bot` ? <BotBadge /> : null}
                </span>
                {/* The level sits on the second line, so the name keeps the first whole beside the clock. */}
                <span className="hud-meta">
                    {player.level === undefined ? null : (
                        <span className="hud-level" title={seatLevelFacts(player)}>
                            {atLevel(player.level)}
                        </span>
                    )}
                    {player.rating === null ? null : (
                        <span className="hud-rating">
                            <Rating value={player.rating} provisional={player.provisional} />
                        </span>
                    )}
                    {player.rating === null || choseUnrated ? <span className="tag muted">{text.game.unrated}</span> : null}
                    {top && snapshot.status === `in-progress` ? <span className="hud-mode">{clockText(snapshot.clock.mode)}</span> : null}
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
                    {self?.kind === `guest` || snapshot.unratedByChoice === true ? <span className="tag muted">{text.game.unrated}</span> : null}
                    <span>{text.game.playing(you)}</span>
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
 * thinking, or the result.
 * A watcher, who holds no side, sees the side to move marked as watched.
 * A finished game, or a live one watched, carries the replay's controls on
 * the chip's first line and that state on its second.
 */
export function TurnChip({ snapshot, you, status, link, replay }: {
    snapshot: GameSnapshot;
    you: Side | null;
    status: TurnStatus;
    link: GameLink;
    replay: Replay | null;
}) {
    // A refused stream is the watcher cap, not a fault, so it reads calm; a
    // seat is never refused, so a player only ever sees the loss.
    if (link === `refused` && you === null) {
        return (
            <Chip className="hud-bottom-center">
                <span className="tag muted">{text.game.watching}</span>
                <span className="hud-hint" role="status">
                    {text.game.manyWatching}
                </span>
            </Chip>
        );
    }
    if (link !== `up`) {
        return (
            <Chip className="hud-bottom-center">
                <span className="hud-note" role="status">
                    {text.game.connectionLost}
                </span>
            </Chip>
        );
    }
    if (snapshot.status === `finished`) {
        return (
            <Chip className="hud-bottom-center hud-replay">
                {replay === null ? null : <Scrubber replay={replay} live={false} />}
                <span className="hud-replay-line">
                    {snapshot.voided ? <span className="tag muted">{text.game.voided}</span> : null}
                    <span className="hud-result" role="status">
                        {resultLine(snapshot)}
                    </span>
                    <Link to={gameLink(snapshot.gameId, replay === null ? null : turnOf(replay.shown))} className="hud-analysis">
                        {text.game.openInAnalysis}
                    </Link>
                </span>
            </Chip>
        );
    }
    if (you === null && replay !== null) {
        return (
            <Chip className="hud-bottom-center hud-replay">
                <Scrubber replay={replay} live />
                <span className="hud-replay-line">
                    <span className="tag muted">{text.game.watching}</span>
                    <span className="hud-turn" role="status">
                        {text.game.thinking(seatName(snapshot.players[snapshot.toMove]))}
                    </span>
                    <LiveSwitch replay={replay} />
                </span>
            </Chip>
        );
    }
    if (snapshot.toMove !== you) {
        return (
            <Chip className="hud-bottom-center">
                {you === null ? <span className="tag muted">{text.game.watching}</span> : null}
                <span className="hud-turn" role="status">
                    {text.game.thinking(seatName(snapshot.players[snapshot.toMove]))}
                </span>
            </Chip>
        );
    }
    return (
        <Chip className="hud-bottom-center">
            <span className="hud-turn">{text.game.yourTurn}</span>
            <Pips placed={status.placed} />
            {/* the latest refusal speaks first; a running wait shows again after the next mark */}
            {status.note !== null ? (
                <span className="hud-note" role="alert">
                    {status.note}
                </span>
            ) : status.wait !== null ? (
                <span className="hud-note" role="alert">
                    <WaitText wait={status.wait} line={text.states.tooMany} />
                </span>
            ) : (
                <span className="hud-hint" role="status">
                    {status.placed === 0 ? text.game.twoStones : text.game.oneStoneLeft}
                </span>
            )}
        </Chip>
    );
}
