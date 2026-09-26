import type { GamePlayer, LiveGameEntry, Side, TimeControl } from '@hexarena/contract';
import { useLiveGames } from '../api/use-live-games';
import { Link } from '../router/Link';
import { BotBadge, Swatch } from './player';
import './LiveRail.css';

// A challenge may carry any whole number of milliseconds, so durations
// round to whole seconds and read in minutes and seconds.
function durationText(ms: number): string {
    const seconds = Math.round(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (minutes === 0) return `${String(rest)} s`;
    return rest === 0 ? `${String(minutes)} min` : `${String(minutes)} min ${String(rest)} s`;
}

/** The clock in the words the play dialog uses, with its amount. */
export function timeControlText(timeControl: TimeControl): string {
    switch (timeControl.mode) {
        case `unlimited`:
            return `no clock`;
        case `turn`:
            return `turn clock ${durationText(timeControl.turnTimeMs)}`;
        case `match`: {
            const increment = timeControl.incrementMs === 0 ? `` : ` +${durationText(timeControl.incrementMs)}`;
            return `match clock ${durationText(timeControl.mainTimeMs)}${increment}`;
        }
    }
}

/**
 * The games in progress under the ladder, each a way into watching it.
 * `onlyWhenLive` renders nothing until a game is live.
 */
export function LiveRail({ onlyWhenLive = false }: { onlyWhenLive?: boolean }) {
    const { data, error } = useLiveGames();
    if (onlyWhenLive && (data === null || data.length === 0)) return null;
    return (
        <section className="live-rail" aria-labelledby="live-title">
            <h2 id="live-title" className="section-title">
                Live games
            </h2>
            {data === null ? (
                error ? (
                    <p className="note">Live games did not load; trying again shortly.</p>
                ) : (
                    <div className="skeleton live-skeleton" aria-hidden="true" />
                )
            ) : data.length === 0 ? (
                <p className="note">No games are live right now.</p>
            ) : (
                <ul className="live-list">
                    {data.map((entry) => (
                        <li key={entry.gameId}>
                            <LiveGameLink entry={entry} />
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

// The verb is for assistive tech alone; the rest of the name is the row's
// own visible text, so a spoken command naming what is seen still matches.
function LiveGameLink({ entry }: { entry: LiveGameEntry }) {
    return (
        <Link to={`/game/${encodeURIComponent(entry.gameId)}`} className="live-game">
            <span className="sr-only">Watch </span>
            <span className="live-seats">
                <LiveSeat side="x" player={entry.players.x} />
                <span className="live-vs">vs</span>
                <LiveSeat side="o" player={entry.players.o} />
            </span>
            <span className="live-meta">
                {entry.rated ? null : <span className="tag muted">unrated</span>}
                <span>{timeControlText(entry.timeControl)}</span>
                <span>{entry.players[entry.toMove].name} to move</span>
            </span>
        </Link>
    );
}

function LiveSeat({ side, player }: { side: Side; player: GamePlayer }) {
    return (
        <span className="live-seat">
            <Swatch side={side} />
            <span className="live-name">{player.name}</span>
            {player.kind === `bot` ? <BotBadge /> : null}
        </span>
    );
}
