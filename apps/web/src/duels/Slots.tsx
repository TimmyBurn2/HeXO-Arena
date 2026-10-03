import type { ReactNode } from 'react';
import { levelFacts, type BotListing, type Level } from '@hexo-arena/contract';
import { hexPoints } from '../board/geometry';
import { BotBadge, PlayerName, PresenceDot, Rating, summarizeAccepts } from '../components/player';
import { ownedBy } from '../play/setup';
import { text } from '../text';
import './Duels.css';

// A framed cell: the frame a little larger than the cell it holds.
const frameSize = 28;
const cellSizeInner = 24;
const socketBox = `-26 -30 52 60`;

/** The framed board cell an empty slot carries, a plus inside it. */
export function Socket({ small = false }: { small?: boolean }) {
    return (
        <svg className={small ? `socket socket-sm` : `socket`} viewBox={socketBox} aria-hidden="true">
            <polygon className="socket-frame" points={hexPoints(frameSize)} />
            <polygon className="socket-cell" points={hexPoints(cellSizeInner)} />
            <path className="socket-plus" d="M-9 0H9M0 -9V9" />
        </svg>
    );
}

/** The small framed cell between two slots, reading vs: sides are drawn by lot, so the slots carry none. */
export function VsCell() {
    return (
        <div className="vs-row" aria-hidden="true">
            <span className="vs-hex">
                <svg viewBox={socketBox}>
                    <polygon className="vs-frame" points={hexPoints(frameSize)} />
                    <polygon className="vs-cell" points={hexPoints(cellSizeInner)} />
                </svg>
                <span className="vs-text">{text.duels.vs}</span>
            </span>
        </div>
    );
}

/** An empty slot: the add button, its hint under it; the next to fill carries the accent. */
export function EmptySlot({ hint, target, disabled = false, onAdd, label }: { hint: string; target: boolean; disabled?: boolean; onAdd: () => void; label: string }) {
    return (
        <div className={`slot slot-empty${target ? ` slot-target` : ``}`}>
            <button type="button" className="slot-empty-add" aria-label={label} disabled={disabled} onClick={onAdd}>
                <Socket />
                <span>
                    <strong>{text.duels.slot.add}</strong>
                    {hint === `` ? null : <span className="note">{hint}</span>}
                </span>
            </button>
        </div>
    );
}

/**
 * A bot in a slot: its name, presence, owner, clocks, and in a test its
 * version; its strength as a select when it offers more than one, the
 * rated one tagged; its rating, Change, and Remove; and a warning when it
 * can no longer start.
 */
export function FilledSlot({
    bot,
    viewer,
    level,
    showVersion,
    warning,
    onLevel,
    onChange,
    onRemove,
}: {
    bot: BotListing;
    viewer: string | null;
    level: Level | null;
    showVersion: boolean;
    warning: string | null;
    onLevel: (id: string) => void;
    onChange: () => void;
    onRemove: () => void;
}) {
    const words = text.duels.slot;
    const presence = !bot.online ? words.offline : bot.openForChallenges ? words.onlineOpen : words.onlineClosed;
    return (
        <div className="slot slot-filled">
            <div className="slot-who">
                <p className="slot-name">
                    <PlayerName name={bot.name} kind="bot" />
                    <BotBadge />
                </p>
                <p className="slot-meta">
                    <span>
                        <PresenceDot online={bot.online} />
                        {presence}
                    </span>
                    <span>{ownedBy(bot, viewer) ? words.yours : bot.ownerName === null ? null : words.by(bot.ownerName)}</span>
                    {showVersion && bot.version !== undefined ? <span>{words.version(bot.version)}</span> : null}
                    <span>{summarizeAccepts(bot.accepts)}</span>
                </p>
            </div>
            <div className="slot-level">
                <StrengthSelect bot={bot} level={level} onLevel={onLevel} />
            </div>
            <div className="slot-side">
                <span className="slot-rating">
                    <Rating value={bot.rating} provisional={bot.provisional} />
                </span>
                <span className="slot-tools">
                    <button type="button" className="btn btn-ghost btn-sm slot-change" aria-label={words.changeLabel(bot.name)} onClick={onChange}>
                        {words.change}
                    </button>
                    <button type="button" className="slot-remove" aria-label={words.remove(bot.name)} onClick={onRemove}>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                    </button>
                </span>
            </div>
            {warning === null ? null : <p className="slot-warn">{warning}</p>}
        </div>
    );
}

// A native select under its own face, so the face can tag the rated strength.
function StrengthSelect({ bot, level, onLevel }: { bot: BotListing; level: Level | null; onLevel: (id: string) => void }): ReactNode {
    const levels = bot.levels;
    if (levels === null || levels.list.length < 2) return <p className="note slot-one-level">{text.duels.slot.oneStrength}</p>;
    const picked = levels.list.find((entry) => entry.id === (level?.id ?? levels.default)) ?? levels.list[0];
    const facts = picked === undefined ? `` : levelFacts(picked);
    return (
        <label className="slot-select" title={facts === `` ? undefined : facts}>
            <span className="slot-select-label">{text.duels.slot.strength}</span>
            <span className="slot-select-value" aria-hidden="true">
                {picked?.label}
                {picked?.id === levels.default ? <span className="slot-select-rated">{text.duels.slot.rated}</span> : null}
            </span>
            <svg className="chevron" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2 4.5l4 4 4-4" />
            </svg>
            <select
                value={picked?.id}
                onChange={(event) => {
                    onLevel(event.target.value);
                }}
            >
                {levels.list.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                        {entry.id === levels.default ? text.duels.slot.ratedOption(entry.label) : entry.label}
                    </option>
                ))}
            </select>
        </label>
    );
}
