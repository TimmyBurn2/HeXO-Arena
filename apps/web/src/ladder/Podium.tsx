import { useId, type CSSProperties } from 'react';
import type { BotListing, LeaderboardEntry } from '@hexo-arena/contract';
import { ShineDefs, StoneArt } from '../board/Board';
import { cellPoints } from '../board/geometry';
import { BotBadge, PlayerName } from '../components/player';
import { playBotPath, readinessOf } from '../play/setup';
import { Link } from '../router/Link';
import { text } from '../text';
import { podiumLayout, type PodiumLayout, type Place } from './podium';
import './Podium.css';

// Towers this many columns apart on a wide window, and on a phone, where
// the same podium stands at a larger cell size than the wide one would.
const wideSpread = 12;
const narrowSpread = 4;

function translate(x: number, y: number): string {
    return `translate(${x.toFixed(2)} ${y.toFixed(2)})`;
}

/**
 * The top of the ladder as a piece of board: x stones stacked in towers
 * of 5, 6, and 4 on a floor of empty cells, the six carrying the win line,
 * each tower under a plate naming its player; fewer players stand fewer
 * towers, first in the middle.
 * The board takes the theme's stones, win line, and glare, and holds still.
 */
export function Podium({ entries, roster }: { entries: readonly LeaderboardEntry[]; roster: readonly BotListing[] | null }) {
    const top = entries.slice(0, 3);
    const places = top.map((_, index): Place => (index === 0 ? 1 : index === 1 ? 2 : 3));
    const wide = podiumLayout(wideSpread, places);
    const narrow = podiumLayout(narrowSpread, places);
    const label = text.ladder.podiumLabel(top.map((entry) => ({ name: entry.name, rating: entry.rating })));
    const drop = (layout: PodiumLayout, place: Place) => -100 * (layout.towers.find((tower) => tower.place === place)?.drop ?? 0);
    return (
        <section className="podium" aria-label={text.ladder.top}>
            <ol className="podium-plates" data-places={String(top.length)}>
                {top.map((entry, index) => {
                    const place = places[index] ?? 1;
                    // React passes custom properties through as written; CSSProperties only lacks their names.
                    const style = { '--drop-wide': `${drop(wide, place).toFixed(3)}%`, '--drop-narrow': `${drop(narrow, place).toFixed(3)}%` } as CSSProperties;
                    return (
                        <li key={entry.name} className={`podium-slot p${String(place)}`} style={style}>
                            <Plate entry={entry} place={place} listing={roster?.find((bot) => bot.name === entry.name)} />
                        </li>
                    );
                })}
            </ol>
            <PodiumBoard layout={wide} className="podium-board wide" label={label} />
            <PodiumBoard layout={narrow} className="podium-board narrow" label={label} />
        </section>
    );
}

/**
 * The podium's shape while the ladder loads: the same plates and boards,
 * drawn as one blank block, so the rows below do not move when it lands.
 * A bot's plate holds a Play button, a human's does not.
 */
export function PodiumSkeleton({ play }: { play: boolean }) {
    const places: Place[] = [1, 2, 3];
    const wide = podiumLayout(wideSpread, places);
    const narrow = podiumLayout(narrowSpread, places);
    const drop = (layout: PodiumLayout, place: Place) => -100 * (layout.towers.find((tower) => tower.place === place)?.drop ?? 0);
    return (
        <div className="podium podium-skeleton skeleton" aria-hidden="true">
            <ol className="podium-plates" data-places="3">
                {places.map((place) => {
                    // React passes custom properties through as written; CSSProperties only lacks their names.
                    const style = { '--drop-wide': `${drop(wide, place).toFixed(3)}%`, '--drop-narrow': `${drop(narrow, place).toFixed(3)}%` } as CSSProperties;
                    return (
                        <li key={place} className={`podium-slot p${String(place)}`} style={style}>
                            <div className="podium-plate">
                                <span className="podium-who">
                                    <span className="podium-rank">{String(place)}</span>
                                    <span className="podium-name">-</span>
                                </span>
                                <span className="podium-rating">0</span>
                                <span className="podium-meta">-</span>
                                {play ? <span className="btn btn-sm podium-play">-</span> : null}
                            </div>
                        </li>
                    );
                })}
            </ol>
            {[wide, narrow].map((layout, index) => (
                <svg
                    key={index === 0 ? `wide` : `narrow`}
                    className={`podium-board ${index === 0 ? `wide` : `narrow`}`}
                    viewBox={`${layout.viewBox.x.toFixed(2)} ${layout.viewBox.y.toFixed(2)} ${layout.viewBox.w.toFixed(2)} ${layout.viewBox.h.toFixed(2)}`}
                />
            ))}
        </div>
    );
}

function Plate({ entry, place, listing }: { entry: LeaderboardEntry; place: Place; listing: BotListing | undefined }) {
    const ready = entry.kind === `bot` && listing !== undefined && readinessOf(listing) === `ready`;
    const owner = entry.kind === `bot` ? entry.ownerName : null;
    return (
        <div className="podium-plate">
            <span className="podium-who">
                <span className={place === 1 ? `podium-rank first` : `podium-rank`}>{String(place)}</span>
                <span className="podium-name">
                    <PlayerName name={entry.name} kind={entry.kind} />
                </span>
                {entry.kind === `bot` ? <BotBadge /> : null}
            </span>
            <span className="podium-rating">{String(entry.rating)}</span>
            <span className="podium-meta">{text.ladder.plateMeta(owner, entry.games)}</span>
            {ready ? (
                <Link to={playBotPath(entry.name)} className="btn btn-primary btn-sm podium-play" ariaLabel={text.ladder.playBot(entry.name)}>
                    {text.ladder.play}
                </Link>
            ) : null}
        </div>
    );
}

function PodiumBoard({ layout, className, label }: { layout: PodiumLayout; className: string; label: string }) {
    const shine = `shine${useId().replace(/:/g, ``)}`;
    const { viewBox } = layout;
    const six = layout.towers.find((tower) => tower.place === 1)?.stones ?? [];
    const line = six.map((stone) => `${stone.x.toFixed(2)},${stone.y.toFixed(2)}`).join(` `);
    return (
        <svg
            className={className}
            viewBox={`${viewBox.x.toFixed(2)} ${viewBox.y.toFixed(2)} ${viewBox.w.toFixed(2)} ${viewBox.h.toFixed(2)}`}
            role="img"
            aria-label={label}
        >
            <ShineDefs id={shine} />
            {layout.floor.map((cell) => (
                <polygon key={`${cell.x.toFixed(1)},${cell.y.toFixed(1)}`} className="cell" points={cellPoints(true)} transform={translate(cell.x, cell.y)} />
            ))}
            {layout.towers.flatMap((tower) =>
                tower.stones.map((stone, index) => (
                    <g key={`${String(tower.place)}-${String(index)}`} className="stone s-x" transform={translate(stone.x, stone.y)}>
                        <StoneArt side="x" shine={shine} flat />
                    </g>
                )),
            )}
            {six.length === 0 ? null : (
                <g className="win">
                    <polyline className="win-casing" points={line} />
                    <polyline className="win-line" points={line} />
                </g>
            )}
        </svg>
    );
}
