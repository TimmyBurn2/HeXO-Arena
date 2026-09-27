import type { ReactNode } from 'react';
import type { Accepts, Side } from '@hexo-arena/contract';
import { Link } from '../router/Link';
import { turnWindowOf } from './PlayDialog';
import './player.css';

/** The bot marker every bot name carries, wherever a name renders. */
export function BotBadge() {
    return <span className="badge-bot">BOT</span>;
}

/** A side's stone as a small cell, tying a name to the board without a legend. */
export function Swatch({ side }: { side: Side }) {
    return <span className={`swatch swatch-${side}`} aria-hidden="true" />;
}

/** Presence is the stream: filled green online, hollow gray offline. */
export function PresenceDot({ online }: { online: boolean }) {
    return <span className={online ? `dot` : `dot offline`} title={online ? `online` : `offline`} />;
}

/** Open for challenges is a separate fact from online. */
export function OpenTag({ open }: { open: boolean }) {
    return <span className={open ? `tag` : `tag muted`}>{open ? `open` : `closed`}</span>;
}

export const provisionalNote = `Provisional until the rating deviation settles`;

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

/** Bot names link to the bot page; human names stay plain text. */
export function PlayerName({ name, kind }: { name: string; kind: `bot` | `human` }): ReactNode {
    if (kind === `human`) return <span className="player-name">{name}</span>;
    return (
        <Link to={`/bots/${encodeURIComponent(name)}`} className="player-name">
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
        parts.push(`turn ${String(window[0] / 1000)} to ${String(window[1] / 1000)} s`);
    }
    if (accepts.match) parts.push(`match`);
    if (accepts.unlimited) parts.push(`unlimited`);
    return parts.join(`, `);
}
