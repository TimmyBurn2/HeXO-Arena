import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { nameKeyOf, roundRobinMaxBots, type BotListing } from '@hexo-arena/contract';
import { hexPoints } from '../board/geometry';
import { BotBadge, PresenceDot, Rating, summarizeAccepts } from '../components/player';
import { byRating, type DuelReads } from '../duels/setup';
import { ownedBy } from '../play/setup';
import { text } from '../text';
import { clockClashes, joinReason, notReadyToJoin, type JoinReason } from './round-robin';
import '../duels/Duels.css';
import './RoundRobin.css';

/** A bot as the list shows it: in the field already, or why it cannot be picked, if it cannot. */
interface Row {
    readonly bot: BotListing;
    readonly reason: JoinReason | `added` | null;
    readonly clashes: readonly BotListing[];
}

// The keys that move between the rows, as in a list box: key names, not ui text.
const moves = new Set([`ArrowDown`, `ArrowUp`, `Home`, `End`]);

const has = (list: readonly BotListing[], bot: BotListing) => list.some((each) => nameKeyOf(each.name) === nameKeyOf(bot.name));

function reasonWords(row: Row): string {
    const words = text.roundRobins.picker;
    if (row.reason === null) return ``;
    if (row.reason === `added`) return words.added;
    if (row.reason === `clock`) return words.reasons.clock(row.clashes.map((bot) => bot.name));
    return words.reasons[row.reason];
}

/**
 * The bot list for a round robin, in a dialog (a full-window sheet on a
 * phone), several bots checked at once: a search by name or owner, the
 * Ready now, Yours, and Has strengths filters, the viewer's own bots
 * first, each bot that cannot join dimmed with the reason and each one in
 * the field already tagged, and a foot counting the picks and the room
 * left, with the one button that adds them all. The rows are one stop for
 * Tab, the arrow keys moving between them, Space or Enter checking one.
 */
export function RoundRobinPicker({
    bots,
    reads,
    field,
    onAdd,
    onClose,
}: {
    bots: readonly BotListing[];
    reads: DuelReads;
    // The bots the round robin holds now, listed and tagged, never picked again.
    field: readonly BotListing[];
    onAdd: (picked: readonly BotListing[]) => void;
    onClose: () => void;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    const list = useRef<HTMLDivElement>(null);
    const [opener] = useState(() => document.activeElement);
    const [search, setSearch] = useState(``);
    const [readyOnly, setReadyOnly] = useState(true);
    const [yoursOnly, setYoursOnly] = useState(false);
    const [strengthsOnly, setStrengthsOnly] = useState(false);
    const [checked, setChecked] = useState<readonly string[]>([]);
    const [focused, setFocused] = useState<string | null>(null);
    const words = text.roundRobins.picker;
    const duelWords = text.duels.picker;
    const viewer = reads.viewer;
    const owner = viewer !== null && bots.some((bot) => ownedBy(bot, viewer));

    useLayoutEffect(() => {
        const dialog = ref.current;
        if (dialog === null || dialog.open) return;
        dialog.showModal();
        dialog.querySelector<HTMLInputElement>(`input[type='search']`)?.focus();
    }, []);
    // Focus goes back to what opened the list, once the modal is gone and the page can take it.
    useEffect(
        () => () => {
            if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
        },
        [opener],
    );

    const picked = useMemo(() => checked.flatMap((name) => bots.filter((bot) => bot.name === name)), [checked, bots]);
    const rows = useMemo((): Row[] => {
        const needle = search.trim().toLowerCase();
        return bots
            .filter((bot) => needle === `` || bot.name.toLowerCase().includes(needle) || (bot.ownerName ?? ``).toLowerCase().includes(needle))
            .filter((bot) => !yoursOnly || ownedBy(bot, viewer))
            .filter((bot) => !strengthsOnly || (bot.levels !== null && bot.levels.list.length > 1))
            .map((bot): Row => {
                if (has(field, bot)) return { bot, reason: `added`, clashes: [] };
                // A checked bot is asked beside the field and the other picks; an unchecked one beside all of them.
                const beside = [...field, ...picked.filter((each) => each.name !== bot.name)];
                return { bot, reason: joinReason(bot, beside, reads), clashes: clockClashes(bot, beside) };
            })
            .sort((a, b) => byRating(a.bot, b.bot));
    }, [bots, search, yoursOnly, strengthsOnly, field, picked, reads, viewer]);
    const shown = rows.filter((row) => !readyOnly || row.reason === null || row.reason === `added` || checked.includes(row.bot.name) || !notReadyToJoin.has(row.reason));
    const hidden = rows.length - shown.length;
    const groups = owner
        ? [
              { title: duelWords.groupYours, rows: shown.filter((row) => ownedBy(row.bot, viewer)), all: rows.filter((row) => ownedBy(row.bot, viewer)) },
              { title: duelWords.groupOthers, rows: shown.filter((row) => !ownedBy(row.bot, viewer)), all: rows.filter((row) => !ownedBy(row.bot, viewer)) },
          ]
        : [{ title: null, rows: shown, all: rows }];
    const order = groups.flatMap((group) => group.rows);
    const tabbable = order.find((row) => row.bot.name === focused) ?? order[0] ?? null;
    const room = roundRobinMaxBots - field.length - checked.length;

    function toggle(row: Row) {
        const on = checked.includes(row.bot.name);
        if (!on && row.reason !== null) return;
        setFocused(row.bot.name);
        setChecked(on ? checked.filter((name) => name !== row.bot.name) : [...checked, row.bot.name]);
    }

    function focusRow(row: Row | undefined) {
        if (row === undefined) return;
        setFocused(row.bot.name);
        [...(list.current?.querySelectorAll<HTMLElement>(`.pick`) ?? [])].find((each) => each.dataset.bot === row.bot.name)?.focus();
    }

    function move(event: KeyboardEvent) {
        if (!moves.has(event.key) || order.length === 0) return;
        const at = order.findIndex((row) => row.bot.name === tabbable?.bot.name);
        const last = order.length - 1;
        const next = event.key === `Home` ? 0 : event.key === `End` ? last : event.key === `ArrowDown` ? Math.min(last, at + 1) : Math.max(0, at - 1);
        event.preventDefault();
        focusRow(order[next]);
    }

    return (
        <dialog
            ref={ref}
            className="duel-picker rr-picker"
            aria-labelledby="rr-picker-title"
            onClose={onClose}
            onClick={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div className="duel-picker-body">
                <div className="duel-picker-head">
                    <h2 id="rr-picker-title">{words.title}</h2>
                    <button type="button" className="topbar-panel-close" aria-label={duelWords.close} onClick={onClose}>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                    </button>
                </div>
                <div className="picker-tools">
                    <input
                        className="picker-search"
                        type="search"
                        aria-label={duelWords.search}
                        placeholder={duelWords.search}
                        value={search}
                        onChange={(event) => {
                            setSearch(event.target.value);
                        }}
                        onKeyDown={(event) => {
                            if (event.key !== `ArrowDown`) return;
                            event.preventDefault();
                            focusRow(tabbable ?? undefined);
                        }}
                    />
                    <div className="pills" role="group" aria-label={duelWords.filters}>
                        <button type="button" className={readyOnly ? `pill active` : `pill`} aria-pressed={readyOnly} onClick={() => { setReadyOnly(!readyOnly); }}>
                            {duelWords.ready}
                        </button>
                        {owner ? (
                            <button type="button" className={yoursOnly ? `pill active` : `pill`} aria-pressed={yoursOnly} onClick={() => { setYoursOnly(!yoursOnly); }}>
                                {duelWords.yours}
                            </button>
                        ) : null}
                        <button type="button" className={strengthsOnly ? `pill active` : `pill`} aria-pressed={strengthsOnly} onClick={() => { setStrengthsOnly(!strengthsOnly); }}>
                            {duelWords.strengths}
                        </button>
                    </div>
                </div>
                <div ref={list} className="picker-list" onKeyDown={move}>
                    {shown.length === 0 ? <p className="note">{duelWords.none}</p> : null}
                    {groups.map((group) =>
                        group.rows.length === 0 ? null : (
                            <div key={group.title ?? `all`}>
                                {group.title === null ? null : (
                                    <p className="picker-group-title">
                                        <span>{group.title}</span>
                                        <span>{duelWords.readyOf(group.all.filter((row) => row.reason === null).length, group.all.length)}</span>
                                    </p>
                                )}
                                <ul className="picker-group">
                                    {group.rows.map((row) => (
                                        <li key={row.bot.name}>
                                            <PickRow
                                                row={row}
                                                viewer={viewer}
                                                on={checked.includes(row.bot.name)}
                                                tabbable={tabbable?.bot.name === row.bot.name}
                                                onToggle={toggle}
                                            />
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ),
                    )}
                </div>
                {readyOnly && hidden > 0 ? <p className="note picker-foot">{duelWords.more(hidden)}</p> : null}
                <div className="rr-picker-foot">
                    <p>
                        <strong>{words.picked(checked.length)}</strong>
                        <span className="note">{words.fit(room)}</span>
                    </p>
                    <button
                        type="button"
                        className="btn btn-primary"
                        disabled={picked.length === 0}
                        onClick={() => {
                            onAdd(picked);
                        }}
                    >
                        {words.add(picked.length)}
                    </button>
                </div>
            </div>
        </dialog>
    );
}

// A framed cell, filled in the accent with a check once the bot is picked.
function Check({ on }: { on: boolean }) {
    return (
        <svg className={on ? `rr-check rr-check-on` : `rr-check`} viewBox="-26 -30 52 60" aria-hidden="true">
            <polygon className="rr-check-cell" points={hexPoints(24)} />
            {on ? <path className="rr-check-mark" d="M-10 0l7 7 13-14" /> : null}
        </svg>
    );
}

function PickRow({ row, viewer, on, tabbable, onToggle }: { row: Row; viewer: string | null; on: boolean; tabbable: boolean; onToggle: (row: Row) => void }) {
    const { bot, reason } = row;
    const words = text.duels.picker;
    const strengths = bot.levels === null ? 0 : bot.levels.list.length;
    const blocked = !on && reason !== null;
    return (
        <button
            type="button"
            className="pick rr-pick"
            data-bot={bot.name}
            tabIndex={tabbable ? 0 : -1}
            aria-pressed={on}
            aria-disabled={blocked ? `true` : undefined}
            onClick={() => {
                onToggle(row);
            }}
        >
            <span className="pick-presence" aria-hidden="true">
                {reason === `added` || blocked ? <PresenceDot online={bot.online} /> : <Check on={on} />}
            </span>
            <span className="pick-name">
                {bot.name}
                <BotBadge />
                {reason === `added` ? <span className="pick-hint">{text.roundRobins.picker.added}</span> : null}
            </span>
            <span className="pick-meta">
                {ownedBy(bot, viewer) || bot.ownerName === null ? null : <span>{words.by(bot.ownerName)}</span>}
                {bot.accepts === undefined ? null : <span>{summarizeAccepts(bot.accepts)}</span>}
                {strengths > 1 ? <span>{words.strengthCount(strengths)}</span> : null}
                {blocked && reason !== `added` ? <span className="pick-reason">{reasonWords(row)}</span> : null}
            </span>
            <span className="pick-rating">
                <Rating value={bot.rating} provisional={bot.provisional} />
            </span>
        </button>
    );
}
