import { useId, type ReactNode } from 'react';
import { atLevel, expectedScore, levelFacts, type GamePlayer, type GamePlayers, type Side } from '@hexo-arena/contract';
import { cellPoints, cellSize, hexPoints } from '../board/geometry';
import { BotBadge, Rating, seatsRateNobody, Swatch } from '../components/player';
import { text } from '../text';
import type { FormResult, RundownSide, RundownSides } from './rundown';
import './Rundown.css';

const sides = [`x`, `o`] as const satisfies readonly Side[];
const halfWidth = (Math.sqrt(3) * cellSize) / 2;
const glyphBox = `${String(-halfWidth)} ${String(-cellSize)} ${String(2 * halfWidth)} ${String(2 * cellSize)}`;

/** How a game was started unrated: a person's choice, a duel's, a round robin a person set up, or a test, where one person holds both sides. */
export type UnratedBy = `choice` | `duel` | `roundRobin` | `test`;

/** The mark a snapshot carries, as the rundown says it. */
export function unratedByOf(snapshot: {
    readonly unratedByChoice?: true | undefined;
    readonly test?: true | undefined;
    readonly duel?: unknown;
    readonly tournament?: { readonly createdBy?: string | undefined } | undefined;
}): UnratedBy | null {
    if (snapshot.test === true) return `test`;
    if (snapshot.unratedByChoice !== true) return null;
    // A person's round robin names who set it up; the weekly's games are rated.
    if (snapshot.tournament?.createdBy !== undefined) return `roundRobin`;
    return snapshot.duel === undefined ? `choice` : `duel`;
}

/**
 * The pre-game rundown: each player's rating and deviation, their
 * expected score from the rating fold's own function, and their last
 * results, with the two players' meetings under them.
 * A guest's game is unrated, so it shows no expected score on either side;
 * nor does a game against a bot at a level other than its default, which
 * says it is practice, and that bot's seat shows its level, since its
 * rating belongs to its default; nor does a game started unrated, which
 * says how.
 */
export function Rundown({ players, unratedBy, data, meetings, onHide }: {
    players: GamePlayers;
    // How the game was started unrated, if it was.
    unratedBy: UnratedBy | null;
    // Null while the records load; the names and the seats' ratings stand meanwhile.
    data: RundownSides | null;
    // The two players' meetings, or null where another line already says them.
    meetings: ReactNode;
    // Present where the card floats over the stage.
    onHide?: () => void;
}) {
    const titleId = useId();
    const rated = !seatsRateNobody(players) && unratedBy === null;
    const practice = [players.x, players.o].some((player) => player.level !== undefined);
    const unrated = practice ? text.rundown.practice : unratedBy === null ? null : text.rundown.unratedBy[unratedBy];
    return (
        <section className="rundown" aria-labelledby={titleId}>
            <div className="rundown-head">
                <h2 id={titleId} className="rundown-title">
                    {text.rundown.title}
                </h2>
                {unrated === null ? null : <span className="tag muted rundown-unrated">{unrated}</span>}
                {onHide === undefined ? null : (
                    <button type="button" className="rundown-hide" aria-label={text.rundown.hide} onClick={onHide}>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M7 7l10 10M17 7L7 17" />
                        </svg>
                    </button>
                )}
            </div>
            <div className="rundown-sides">
                {sides.map((side) => {
                    const other = side === `x` ? `o` : `x`;
                    const own = data?.[side] ?? null;
                    const against = data?.[other] ?? null;
                    const expected = rated && own !== null && against !== null ? expectedScore(own.record, against.record) : null;
                    return <SideFacts key={side} side={side} player={players[side]} own={own} expected={expected} />;
                })}
            </div>
            {meetings === null ? null : <p className="rundown-meetings">{meetings}</p>}
        </section>
    );
}

function SideFacts({ side, player, own, expected }: { side: Side; player: GamePlayer; own: RundownSide | null; expected: number | null }) {
    const leveled = player.level !== undefined;
    const rating = leveled ? null : (own?.record.rating ?? player.rating);
    const provisional = own?.record.provisional ?? player.provisional;
    const facts = player.level === undefined ? `` : levelFacts(player.level);
    return (
        <div className="rundown-side">
            <p className="rundown-name">
                <Swatch side={side} />
                {/* The level holds together, so a narrow column breaks the line before the @. */}
                <span>
                    {player.name}
                    {player.level === undefined ? null : (
                        <>
                            {` `}
                            <span className="rundown-at">{atLevel(player.level)}</span>
                        </>
                    )}
                </span>
                {player.kind === `bot` ? <BotBadge /> : null}
            </p>
            {facts === `` ? null : <p className="rundown-level">{facts}</p>}
            {rating === null ? (
                <span className="tag muted">{text.game.unrated}</span>
            ) : (
                <p className="rundown-figures">
                    <span className="rundown-rating">
                        <Rating value={rating} provisional={provisional} />
                    </span>
                    {own === null ? null : <span className="rundown-deviation">{text.rundown.deviation(own.record.deviation)}</span>}
                </p>
            )}
            {expected === null ? null : (
                <p className="rundown-expected">
                    <span className="rundown-label">{text.rundown.expected}</span>
                    <span className="rundown-value">{text.rundown.score(expected)}</span>
                </p>
            )}
            {own === null ? null : <Form results={own.form} />}
        </div>
    );
}

// The results newest first as cells: filled won, a ring lost, a dot no winner.
function Form({ results }: { results: readonly FormResult[] }) {
    if (results.length === 0) return <p className="rundown-form-none">{text.rundown.noGames}</p>;
    return (
        <p className="rundown-form" role="img" aria-label={text.rundown.formSpoken(results.length, results.map((result) => text.rundown.results[result]))}>
            <span className="rundown-label">{text.rundown.form(results.length)}</span>
            <span className="rundown-glyphs">
                {results.map((result, index) => (
                    // A form repeats results, so its order is its identity.
                    <svg key={index} className={`rundown-glyph rundown-${result}`} viewBox={glyphBox}>
                        <polygon points={cellPoints()} />
                        {result === `none` ? <polygon className="rundown-dot" points={hexPoints(cellSize * 0.3)} /> : null}
                    </svg>
                ))}
            </span>
        </p>
    );
}
