import { useMemo } from 'react';
import { clockText, type GamePlayer, type GameSnapshot, type LiveGameEntry, type Side } from '@hexo-arena/contract';
import { Board } from '../board/Board';
import { defaultBoardSettings } from '../board/board-settings';
import { stonesFrame } from '../board/geometry';
import { BotBadge, Rating, Swatch } from '../components/player';
import { Clock } from '../game/Clock';
import { lastMoveOf, resultLine, stonesOf, winLineOf } from '../game/snapshot-views';
import { MiniBoard } from '../live/MiniBoard';
import type { LiveView } from '../live/use-live-replay';
import { Link } from '../router/Link';
import { text } from '../text';
import type { Featured } from './featured';

// The featured board keeps the minis' shape, so the slot holds still as games come and go.
const featuredAspect = 4 / 3;

// Numbers at this size would cover the stones they name.
const featuredSettings = { ...defaultBoardSettings, numbers: false };

/**
 * The featured slot: a live game with its seats and clock on chips, or a
 * finished one frozen at its end with the result.
 * The board is one link into the game, named by its seats; the chips over
 * it are its words for every reader and let a press through to the board.
 */
export function FeaturedBoard({ featured }: { featured: Exclude<Featured, { kind: `none` } | { kind: `pending` }> }) {
    if (featured.kind === `live`) return <FeaturedLive view={featured.view} />;
    return <FeaturedFinished snapshot={featured.snapshot} ended={featured.kind === `ended`} />;
}

function FeaturedLive({ view }: { view: LiveView }) {
    const { entry } = view;
    const { x, o } = entry.players;
    // The clock belongs to the latest read, so it waits until the board shows that read.
    const landed = view.cells.length === entry.cells.length;
    return (
        <article className="featured" aria-label={text.home.featured}>
            <Link to={`/game/${encodeURIComponent(entry.gameId)}`} className="featured-link" ariaLabel={text.home.watch(x.name, o.name)}>
                <MiniBoard game={view} />
            </Link>
            <div className="featured-bar featured-top">
                <SeatChip side="o" player={o} />
            </div>
            <div className="featured-bar featured-bottom">
                <SeatChip side="x" player={x} />
                <p className="featured-chip">
                    <span>{text.ladder.live.toMove(entry.players[view.toMove].name)}</span>
                    {landed ? <RunningClock entry={entry} side={view.toMove} since={view.readAt} /> : <span>{clockText(entry.timeControl)}</span>}
                </p>
            </div>
        </article>
    );
}

function FeaturedFinished({ snapshot, ended }: { snapshot: GameSnapshot; ended: boolean }) {
    const { x, o } = snapshot.players;
    const stones = useMemo(() => stonesOf(snapshot), [snapshot]);
    const frame = useMemo(() => stonesFrame(snapshot.board.cells, featuredAspect), [snapshot]);
    const overlays = useMemo(() => {
        const winLine = winLineOf(snapshot);
        return winLine === null ? { lastMove: lastMoveOf(snapshot) } : { winLine };
    }, [snapshot]);
    return (
        <article className="featured" aria-label={text.home.featured}>
            <Link to={`/game/${encodeURIComponent(snapshot.gameId)}`} className="featured-link" ariaLabel={text.home.replay(x.name, o.name)}>
                <div className="mini-board">
                    <Board stones={stones} settings={featuredSettings} label={resultLine(snapshot)} overlays={overlays} frame={frame} />
                </div>
            </Link>
            <div className="featured-bar featured-top">
                <SeatChip side="o" player={o} />
            </div>
            <div className="featured-bar featured-bottom">
                <SeatChip side="x" player={x} />
                <p className="featured-chip featured-result" role={ended ? `status` : undefined}>
                    <span className="tag muted">{ended ? text.home.ended : text.home.last}</span>
                    <span>{resultLine(snapshot)}</span>
                </p>
            </div>
        </article>
    );
}

function SeatChip({ side, player }: { side: Side; player: GamePlayer }) {
    return (
        <p className="featured-chip">
            <Swatch side={side} />
            <span className="featured-name">{player.name}</span>
            {player.kind === `bot` ? <BotBadge /> : null}
            {player.rating === null ? (
                <span className="tag muted">{text.ladder.live.unrated}</span>
            ) : (
                <span className="featured-rating">
                    <Rating value={player.rating} provisional={player.provisional} />
                </span>
            )}
        </p>
    );
}

// The side to move's time, counted from the read however late the board lands;
// an unlimited game names its clock instead.
function RunningClock({ entry, side, since }: { entry: LiveGameEntry; side: Side; since: number }) {
    const clock = entry.clock;
    if (clock.mode === `turn`) return <Clock remainingMs={clock.remainingTurnMs} running since={since} />;
    if (clock.mode === `match`) return <Clock remainingMs={clock.remainingMainMs[side]} running since={since} />;
    return <span>{clockText(entry.timeControl)}</span>;
}
