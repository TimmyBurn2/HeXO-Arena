import type { ReactNode } from 'react';
import { placeholderNamePattern, type Accepts, type Side } from '@hexo-arena/contract';
import { Link } from '../router/Link';
import { text } from '../text';
import { cellPoints, cellSize, hexPoints } from '../board/geometry';
import { turnWindowOf } from '../play/accepts';
import './player.css';

/** The bot marker every bot name carries, wherever a name renders. */
export function BotBadge() {
    return <span className="badge-bot">{text.player.botBadge}</span>;
}

const cellWidthHalf = (Math.sqrt(3) * cellSize) / 2;

// At a swatch's size a board-scale stone would hide its cell,
// and the cell is the ground the stone is measured against,
// so the stone leaves a band of it.
const swatchStoneScale = 0.7;

// A cell's box, so the swatch's hexagon fills it edge to edge.
const swatchBox = `${String(-cellWidthHalf)} ${String(-cellSize)} ${String(2 * cellWidthHalf)} ${String(2 * cellSize)}`;

/**
 * A side's stone on a board cell, tying a name to the board without a legend;
 * drawn as the board draws it, rim included,
 * so the stone reads on its own ground whatever surface the swatch sits on.
 */
export function Swatch({ side }: { side: Side }) {
    return (
        <svg className="swatch" viewBox={swatchBox} aria-hidden="true">
            <polygon className="swatch-cell" points={cellPoints()} />
            <polygon className={`swatch-stone swatch-stone-${side}`} points={hexPoints(cellSize * swatchStoneScale)} />
        </svg>
    );
}

/** Presence is the stream: filled green online, hollow gray offline. */
export function PresenceDot({ online }: { online: boolean }) {
    return <span className={online ? `dot` : `dot offline`} title={online ? text.player.online : text.player.offline} />;
}

/** Open for challenges is a separate fact from online. */
export function OpenTag({ open }: { open: boolean }) {
    return <span className={open ? `tag` : `tag muted`}>{open ? text.player.open : text.player.closed}</span>;
}

export const provisionalNote = text.player.provisional;

/** Whole points, tabular, with the trailing question mark when provisional. */
export function Rating({ value, provisional }: { value: number; provisional: boolean }) {
    return (
        <>
            {String(value)}
            {provisional ? (
                <span className="prov" title={provisionalNote}>
                    ?
                </span>
            ) : null}
        </>
    );
}

/**
 * A name leads to its page: a bot's under Bots, a human's under Players.
 * A deleted player's placeholder has no page, so it stays plain text.
 */
export function PlayerName({ name, kind }: { name: string; kind: `bot` | `human` }): ReactNode {
    if (placeholderNamePattern.test(name)) return <span className="player-name">{name}</span>;
    return (
        <Link to={kind === `bot` ? `/bots/${encodeURIComponent(name)}` : `/players/${encodeURIComponent(name)}`} className="player-name">
            {name}
        </Link>
    );
}

/**
 * The compressed declaration view the directory shows: turn window in
 * seconds plus the flat modes, nothing when nothing is declared.
 */
export function summarizeAccepts(accepts: Accepts | undefined): string {
    if (accepts === undefined) return ``;
    const parts: string[] = [];
    const window = turnWindowOf(accepts);
    if (window !== null) {
        parts.push(text.player.acceptsTurn(window[0] / 1000, window[1] / 1000));
    }
    if (accepts.match) parts.push(text.player.acceptsMatch);
    if (accepts.unlimited) parts.push(text.player.acceptsUnlimited);
    return text.player.acceptsList(parts);
}
