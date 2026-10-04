import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type Ref } from 'react';
import { levelFacts, nameKeyOf, type BotListing } from '@hexo-arena/contract';
import { BotBadge, PresenceDot, Rating, summarizeAccepts } from '../components/player';
import { turnWindowOf } from '../play/accepts';
import { ownedBy } from '../play/setup';
import { text } from '../text';
import { useFootRoom } from './foot-room';
import { byRating, kindOf, notReady, pickReason, type DuelReads, type PickReason, type SlotKey } from './setup';
import './Duels.css';

/** A bot as the picker lists it: why it cannot be added, if it cannot, and a hint once the other slot holds the viewer's bot. */
interface PickRow {
    readonly bot: BotListing;
    readonly reason: PickReason | `other` | null;
    readonly hint: string | null;
}

function reasonWords(reason: PickReason | `other`, other: BotListing | null, slot: SlotKey): string {
    const words = text.duels.picker.reasons;
    switch (reason) {
        case `other`:
            return slot === `first` ? text.duels.slot.second : text.duels.slot.first;
        case `pair`:
            return words.pair(other?.name ?? ``);
        case `clock`:
            return words.clock(other?.name ?? ``);
        default:
            return words[reason];
    }
}

// The keys that move the pick through the rows, as in a list box: key names, not ui text.
const moves = new Set([`ArrowDown`, `ArrowUp`, `Home`, `End`]);

/**
 * The bot list for one slot, in a dialog (a full-window sheet on a phone):
 * a search by name or owner, the Ready now, Yours, and Has strengths
 * filters, the viewer's own bots first, each bot that cannot be added
 * dimmed with the reason, and a foot on the picked bot with its strengths
 * and clocks. A press picks a bot, a double press or Enter adds it; the
 * rows are one stop for Tab, the arrow keys moving the pick between them.
 */
export function Picker({
    slot,
    bots,
    reads,
    other,
    current,
    onAdd,
    onClose,
}: {
    slot: SlotKey;
    bots: readonly BotListing[];
    reads: DuelReads;
    // The bot in the other slot, which stays listed, marked, and cannot be added again.
    other: BotListing | null;
    // The bot this slot holds now, picked when the list opens.
    current: BotListing | null;
    onAdd: (bot: BotListing) => void;
    onClose: () => void;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    const [opener] = useState(() => document.activeElement);
    const [search, setSearch] = useState(``);
    const [readyOnly, setReadyOnly] = useState(true);
    const [yoursOnly, setYoursOnly] = useState(false);
    const [strengthsOnly, setStrengthsOnly] = useState(false);
    const [picked, setPicked] = useState<string | null>(current?.name ?? null);
    const list = useRef<HTMLDivElement>(null);
    const foot = useRef<HTMLDivElement>(null);
    const body = useRef<HTMLDivElement>(null);
    useFootRoom(body, foot);
    // The foot's tallest height while the list is open: a shorter pick would let the list grow and move its rows under a second press.
    const tallest = useRef(0);
    const words = text.duels.picker;
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

    const rows = useMemo((): PickRow[] => {
        const needle = search.trim().toLowerCase();
        const otherYours = other !== null && ownedBy(other, viewer);
        return bots
            .filter((bot) => needle === `` || bot.name.toLowerCase().includes(needle) || (bot.ownerName ?? ``).toLowerCase().includes(needle))
            .filter((bot) => !yoursOnly || ownedBy(bot, viewer))
            .filter((bot) => !strengthsOnly || (bot.levels !== null && bot.levels.list.length > 1))
            .map((bot): PickRow => {
                const isOther = other !== null && nameKeyOf(other.name) === nameKeyOf(bot.name);
                const reason = isOther ? (`other` as const) : pickReason(bot, other, reads);
                const hint = !otherYours || reason !== null ? null : kindOf(other, bot) === `test` ? words.bothYours : words.mayBeRated;
                return { bot, reason, hint };
            })
            .sort((a, b) => byRating(a.bot, b.bot));
    }, [bots, search, yoursOnly, strengthsOnly, other, reads, viewer, words]);
    const shown = rows.filter((row) => !readyOnly || row.reason === null || row.reason === `other` || !notReady.has(row.reason));
    const hidden = rows.length - shown.length;
    const groups = owner
        ? [
              { title: words.groupYours, rows: shown.filter((row) => ownedBy(row.bot, viewer)), all: rows.filter((row) => ownedBy(row.bot, viewer)) },
              { title: words.groupOthers, rows: shown.filter((row) => !ownedBy(row.bot, viewer)), all: rows.filter((row) => !ownedBy(row.bot, viewer)) },
          ]
        : [{ title: null, rows: shown, all: rows }];
    const selected = shown.find((row) => row.bot.name === picked) ?? shown.find((row) => row.reason === null) ?? null;
    const order = groups.flatMap((group) => group.rows);
    const tabbable = selected ?? order[0] ?? null;

    useLayoutEffect(() => {
        const box = foot.current;
        if (box === null) return;
        tallest.current = Math.max(tallest.current, box.offsetHeight);
        box.style.minHeight = `${String(tallest.current)}px`;
    });

    function choose(row: PickRow, event: MouseEvent<HTMLButtonElement>) {
        // The second press of a double press picks nothing: the list may have moved under it, and the double press adds only the row already picked.
        if (event.detail > 1) return;
        // A press from the keyboard comes with no pointer detail, and adds at once, as Enter does.
        if (event.detail === 0 && row.reason === null) {
            onAdd(row.bot);
            return;
        }
        setPicked(row.bot.name);
    }

    function focusRow(row: PickRow | undefined) {
        if (row === undefined) return;
        setPicked(row.bot.name);
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
            className="duel-picker"
            aria-labelledby="picker-title"
            onClose={onClose}
            onClick={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div ref={body} className="duel-picker-body">
                <div className="duel-picker-head">
                    <h2 id="picker-title">{slot === `first` ? words.first : words.second}</h2>
                    <button type="button" className="topbar-panel-close" aria-label={words.close} onClick={onClose}>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                    </button>
                </div>
                <div className="picker-tools">
                    <input
                        className="picker-search"
                        type="search"
                        aria-label={words.search}
                        placeholder={words.search}
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
                    <div className="pills" role="group" aria-label={words.filters}>
                        <button type="button" className={readyOnly ? `pill active` : `pill`} aria-pressed={readyOnly} onClick={() => { setReadyOnly(!readyOnly); }}>
                            {words.ready}
                        </button>
                        {owner ? (
                            <button type="button" className={yoursOnly ? `pill active` : `pill`} aria-pressed={yoursOnly} onClick={() => { setYoursOnly(!yoursOnly); }}>
                                {words.yours}
                            </button>
                        ) : null}
                        <button type="button" className={strengthsOnly ? `pill active` : `pill`} aria-pressed={strengthsOnly} onClick={() => { setStrengthsOnly(!strengthsOnly); }}>
                            {words.strengths}
                        </button>
                    </div>
                </div>
                <div ref={list} className="picker-list" onKeyDown={move}>
                    {shown.length === 0 ? <p className="note">{words.none}</p> : null}
                    {groups.map((group) =>
                        group.rows.length === 0 ? null : (
                            <div key={group.title ?? `all`}>
                                {group.title === null ? null : (
                                    <p className="picker-group-title">
                                        <span>{group.title}</span>
                                        <span>{words.readyOf(group.all.filter((row) => row.reason === null).length, group.all.length)}</span>
                                    </p>
                                )}
                                <ul className="picker-group">
                                    {group.rows.map((row) => (
                                        <li key={row.bot.name}>
                                            <PickButton
                                                row={row}
                                                other={other}
                                                slot={slot}
                                                viewer={viewer}
                                                selected={selected?.bot.name === row.bot.name}
                                                tabbable={tabbable?.bot.name === row.bot.name}
                                                onChoose={choose}
                                                onAdd={onAdd}
                                            />
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ),
                    )}
                </div>
                {readyOnly && hidden > 0 ? <p className="note picker-foot">{words.more(hidden)}</p> : null}
                {selected === null ? null : <PickDetail ref={foot} row={selected} viewer={viewer} onAdd={onAdd} />}
            </div>
        </dialog>
    );
}

function PickButton({
    row,
    other,
    slot,
    viewer,
    selected,
    tabbable,
    onChoose,
    onAdd,
}: {
    row: PickRow;
    other: BotListing | null;
    slot: SlotKey;
    viewer: string | null;
    selected: boolean;
    tabbable: boolean;
    onChoose: (row: PickRow, event: MouseEvent<HTMLButtonElement>) => void;
    onAdd: (bot: BotListing) => void;
}) {
    const { bot, reason, hint } = row;
    const words = text.duels.picker;
    const strengths = bot.levels === null ? 0 : bot.levels.list.length;
    return (
        <button
            type="button"
            className="pick"
            data-bot={bot.name}
            tabIndex={tabbable ? 0 : -1}
            aria-pressed={selected}
            aria-disabled={reason === null ? undefined : `true`}
            onClick={(event) => {
                onChoose(row, event);
            }}
            onDoubleClick={() => {
                // Only the row its first press picked, so a list that moved between the presses adds nothing it was not pressed for.
                if (selected && reason === null) onAdd(bot);
            }}
        >
            <span className="pick-presence" aria-hidden="true">
                <PresenceDot online={bot.online} />
            </span>
            <span className="pick-name">
                {bot.name}
                <BotBadge />
                {reason === `other` ? <span className="pick-hint">{reasonWords(reason, other, slot)}</span> : null}
                {hint === null ? null : <span className="pick-hint">{hint}</span>}
            </span>
            <span className="pick-meta">
                {ownedBy(bot, viewer) || bot.ownerName === null ? null : <span>{words.by(bot.ownerName)}</span>}
                {bot.accepts === undefined ? null : <span>{summarizeAccepts(bot.accepts)}</span>}
                {strengths > 1 ? <span>{words.strengthCount(strengths)}</span> : null}
                {reason === null || reason === `other` ? null : <span className="pick-reason">{reasonWords(reason, other, slot)}</span>}
            </span>
            <span className="pick-rating">
                <Rating value={bot.rating} provisional={bot.provisional} />
            </span>
        </button>
    );
}

function PickDetail({ ref, row, viewer, onAdd }: { ref: Ref<HTMLDivElement>; row: PickRow; viewer: string | null; onAdd: (bot: BotListing) => void }) {
    const { bot } = row;
    const words = text.duels.picker;
    const rating = <Rating value={bot.rating} provisional={bot.provisional} />;
    const window = turnWindowOf(bot.accepts);
    return (
        <div ref={ref} className="pick-detail">
            <div className="pick-detail-text">
                <p className="pick-detail-name">
                    {bot.name}
                    <BotBadge />
                    <span className="pick-detail-owner">{ownedBy(bot, viewer) || bot.ownerName === null ? words.detailYours(rating) : words.detailOwner(bot.ownerName, rating)}</span>
                </p>
                {bot.about === undefined ? null : <p className="note">{bot.about}</p>}
                {bot.levels === null || bot.levels.list.length < 2 ? null : (
                    <p className="pick-detail-levels">
                        <span>{words.strengthsTitle}</span>
                        {bot.levels.list.map((level) => (
                            <span key={level.id}>
                                <strong>{level.label}</strong> {levelFacts(level)}
                            </span>
                        ))}
                    </p>
                )}
                {bot.accepts === undefined ? null : (
                    <p className="pick-detail-levels">
                        {text.play.acceptsLine(bot.name, { turn: window === null ? null : [window[0] / 1000, window[1] / 1000], match: bot.accepts.match, unlimited: bot.accepts.unlimited })}
                    </p>
                )}
            </div>
            <button
                type="button"
                className="btn btn-primary"
                disabled={row.reason !== null}
                onClick={() => {
                    onAdd(bot);
                }}
            >
                {words.add(bot.name)}
            </button>
        </div>
    );
}
