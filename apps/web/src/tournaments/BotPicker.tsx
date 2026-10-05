import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type Ref } from 'react';
import { levelFacts, nameKeyOf, tournamentBotsMax, type BotListing } from '@hexo-arena/contract';
import { hexPoints } from '../board/geometry';
import { BotBadge, PresenceDot, Rating, summarizeAccepts } from '../components/player';
import { useFootRoom } from '../duels/foot-room';
import { byRating, kindOf, type SlotKey } from '../duels/setup';
import { turnWindowOf } from '../play/accepts';
import { clockClashes, eventReadiness, notReadyNow, reasonText, type BotReason, type SetupReads } from '../play/readiness';
import { ownedBy } from '../play/setup';
import { text } from '../text';
import '../duels/Duels.css';
import './RoundRobin.css';

/**
 * How the list picks: one bot for a duel's slot, beside the bot in the
 * other, a press picking and a double press or Enter adding it; or several
 * at once for a field, each checked, one button adding them all.
 */
export type PickerMode =
    | {
          readonly kind: `one`;
          readonly slot: SlotKey;
          // The bot in the other slot, which stays listed, marked, and cannot be added again.
          readonly other: BotListing | null;
          // The bot this slot holds now, picked when the list opens.
          readonly current: BotListing | null;
          readonly onAdd: (bot: BotListing) => void;
      }
    | {
          readonly kind: `several`;
          // The bots the field holds now, listed and tagged, never picked again.
          readonly field: readonly BotListing[];
          readonly onAdd: (picked: readonly BotListing[]) => void;
      };

// A bot as the list shows it: why it cannot be added, if it cannot, already in place, and the bots its clocks clash with.
interface Row {
    readonly bot: BotListing;
    readonly reason: BotReason | `placed` | null;
    readonly clashes: readonly BotListing[];
    readonly hint: string | null;
}

// The keys that move between the rows, as in a list box: key names, not ui text.
const moves = new Set([`ArrowDown`, `ArrowUp`, `Home`, `End`]);

const has = (list: readonly BotListing[], bot: BotListing) => list.some((each) => nameKeyOf(each.name) === nameKeyOf(bot.name));

function reasonWords(row: Row, mode: PickerMode): string {
    if (row.reason === null) return ``;
    if (row.reason === `placed`) return mode.kind === `one` ? (mode.slot === `first` ? text.duels.slot.second : text.duels.slot.first) : text.roundRobins.picker.added;
    return reasonText(
        row.reason,
        row.clashes.map((bot) => bot.name),
        mode.kind === `one` ? (mode.other?.name ?? ``) : ``,
    );
}

/**
 * The bot list a duel or round robin picks from, in a dialog (a
 * full-window sheet on a phone): a search by name or owner, the Ready now,
 * Yours, and Has strengths filters, the viewer's own bots first, each bot
 * that cannot be added dimmed with the reason, and a foot: the picked
 * bot's strengths and clocks with its Add, or the picks counted beside the
 * room left with the one button that adds them. The rows are one stop for
 * Tab, the arrow keys moving between them.
 */
export function BotPicker({ bots, reads, mode, onClose }: { bots: readonly BotListing[]; reads: SetupReads; mode: PickerMode; onClose: () => void }) {
    const ref = useRef<HTMLDialogElement>(null);
    const list = useRef<HTMLDivElement>(null);
    const body = useRef<HTMLDivElement>(null);
    const foot = useRef<HTMLDivElement>(null);
    useFootRoom(body, foot);
    const [opener] = useState(() => document.activeElement);
    const [search, setSearch] = useState(``);
    const [readyOnly, setReadyOnly] = useState(true);
    const [yoursOnly, setYoursOnly] = useState(false);
    const [strengthsOnly, setStrengthsOnly] = useState(false);
    // One bot picked, or several checked.
    const [picked, setPicked] = useState<string | null>(mode.kind === `one` ? (mode.current?.name ?? null) : null);
    const [checked, setChecked] = useState<readonly string[]>([]);
    const [focused, setFocused] = useState<string | null>(null);
    // The row the first press of a double press picked: the foot grows with the pick and may cover that row before the second press lands.
    const pressed = useRef<string | null>(null);
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

    const checkedBots = useMemo(() => checked.flatMap((name) => bots.filter((bot) => bot.name === name)), [checked, bots]);
    const rows = useMemo((): Row[] => {
        const needle = search.trim().toLowerCase();
        const other = mode.kind === `one` ? mode.other : null;
        const placed = mode.kind === `one` ? (other === null ? [] : [other]) : mode.field;
        // Beside the viewer's own bot, a pick says whether the duel would be a test or may be rated.
        const yourOther = other !== null && ownedBy(other, viewer) ? other : null;
        return bots
            .filter((bot) => needle === `` || bot.name.toLowerCase().includes(needle) || (bot.ownerName ?? ``).toLowerCase().includes(needle))
            .filter((bot) => !yoursOnly || ownedBy(bot, viewer))
            .filter((bot) => !strengthsOnly || (bot.levels !== null && bot.levels.list.length > 1))
            .map((bot): Row => {
                if (has(placed, bot)) return { bot, reason: `placed`, clashes: [], hint: null };
                // A checked bot is asked beside the field and the other picks; an unchecked one beside all of them.
                const beside = mode.kind === `one` ? placed : [...placed, ...checkedBots.filter((each) => each.name !== bot.name)];
                const reason = eventReadiness(bot, beside, reads, mode.kind === `one`);
                const hint = yourOther === null || reason !== null ? null : kindOf(yourOther, bot) === `test` ? words.bothYours : words.mayBeRated;
                return { bot, reason, clashes: clockClashes(bot, beside), hint };
            })
            .sort((a, b) => byRating(a.bot, b.bot));
    }, [bots, search, yoursOnly, strengthsOnly, mode, checkedBots, reads, viewer, words]);
    const shown = rows.filter((row) => !readyOnly || row.reason === null || row.reason === `placed` || checked.includes(row.bot.name) || !notReadyNow.has(row.reason));
    const hidden = rows.length - shown.length;
    const groups = owner
        ? [
              { title: words.groupYours, rows: shown.filter((row) => ownedBy(row.bot, viewer)), all: rows.filter((row) => ownedBy(row.bot, viewer)) },
              { title: words.groupOthers, rows: shown.filter((row) => !ownedBy(row.bot, viewer)), all: rows.filter((row) => !ownedBy(row.bot, viewer)) },
          ]
        : [{ title: null, rows: shown, all: rows }];
    const order = groups.flatMap((group) => group.rows);
    const selected = mode.kind === `one` ? (shown.find((row) => row.bot.name === picked) ?? shown.find((row) => row.reason === null) ?? null) : null;
    const tabbable = (mode.kind === `one` ? selected : order.find((row) => row.bot.name === focused)) ?? order[0] ?? null;

    useLayoutEffect(() => {
        const box = foot.current;
        if (box === null || mode.kind !== `one`) return;
        tallest.current = Math.max(tallest.current, box.offsetHeight);
        box.style.minHeight = `${String(tallest.current)}px`;
    });

    function press(row: Row, event: MouseEvent<HTMLButtonElement>) {
        if (mode.kind === `several`) {
            const on = checked.includes(row.bot.name);
            if (!on && row.reason !== null) return;
            setFocused(row.bot.name);
            setChecked(on ? checked.filter((name) => name !== row.bot.name) : [...checked, row.bot.name]);
            return;
        }
        // The second press of a double press picks nothing: the list may have moved under it, and the double press adds only the row already picked.
        if (event.detail > 1) return;
        // A press from the keyboard comes with no pointer detail, and adds at once, as Enter does.
        if (event.detail === 0 && row.reason === null) {
            mode.onAdd(row.bot);
            return;
        }
        pressed.current = row.bot.name;
        setPicked(row.bot.name);
    }

    function focusRow(row: Row | undefined) {
        if (row === undefined) return;
        if (mode.kind === `one`) setPicked(row.bot.name);
        else setFocused(row.bot.name);
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

    const several = mode.kind === `several`;
    const titleId = several ? `rr-picker-title` : `picker-title`;
    return (
        <dialog
            ref={ref}
            className={several ? `duel-picker rr-picker` : `duel-picker`}
            aria-labelledby={titleId}
            onClose={onClose}
            onClick={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
            onClickCapture={(event) => {
                // Each first press begins a new double press; a row's own press then names its row.
                if (event.detail === 1) pressed.current = null;
            }}
            onDoubleClick={() => {
                // Wherever the second press lands, a double press adds only the row its first press picked.
                if (mode.kind === `one` && selected !== null && selected.bot.name === pressed.current && selected.reason === null) mode.onAdd(selected.bot);
            }}
        >
            <div ref={body} className="duel-picker-body">
                <div className="duel-picker-head">
                    <h2 id={titleId}>{mode.kind === `several` ? text.roundRobins.picker.title : mode.slot === `first` ? words.first : words.second}</h2>
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
                                            <PickRow
                                                row={row}
                                                mode={mode}
                                                viewer={viewer}
                                                on={several ? checked.includes(row.bot.name) : selected?.bot.name === row.bot.name}
                                                tabbable={tabbable?.bot.name === row.bot.name}
                                                onPress={press}
                                            />
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ),
                    )}
                </div>
                {readyOnly && hidden > 0 ? <p className="note picker-foot">{words.more(hidden)}</p> : null}
                {mode.kind === `several` ? (
                    <div ref={foot} className="rr-picker-foot">
                        <p>
                            <strong>{text.roundRobins.picker.picked(checked.length)}</strong>
                            <span className="note">{text.roundRobins.picker.fit(tournamentBotsMax - mode.field.length - checked.length)}</span>
                        </p>
                        <button
                            type="button"
                            className="btn btn-primary"
                            disabled={checkedBots.length === 0}
                            onClick={() => {
                                mode.onAdd(checkedBots);
                            }}
                        >
                            {text.roundRobins.picker.add(checkedBots.length)}
                        </button>
                    </div>
                ) : selected === null ? null : (
                    <PickDetail ref={foot} row={selected} viewer={viewer} onAdd={mode.onAdd} />
                )}
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

function PickRow({
    row,
    mode,
    viewer,
    on,
    tabbable,
    onPress,
}: {
    row: Row;
    mode: PickerMode;
    viewer: string | null;
    on: boolean;
    tabbable: boolean;
    onPress: (row: Row, event: MouseEvent<HTMLButtonElement>) => void;
}) {
    const { bot, reason, hint } = row;
    const words = text.duels.picker;
    const strengths = bot.levels === null ? 0 : bot.levels.list.length;
    const several = mode.kind === `several`;
    // A checked bot stays checked, which unchecks it, whatever the list now says of it.
    const blocked = reason !== null && !(several && on);
    return (
        <button
            type="button"
            className={several ? `pick rr-pick` : `pick`}
            data-bot={bot.name}
            tabIndex={tabbable ? 0 : -1}
            aria-pressed={on}
            aria-disabled={blocked ? `true` : undefined}
            onClick={(event) => {
                onPress(row, event);
            }}
        >
            <span className="pick-presence" aria-hidden="true">
                {several && !blocked ? <Check on={on} /> : <PresenceDot online={bot.online} />}
            </span>
            <span className="pick-name">
                {bot.name}
                <BotBadge />
                {reason === `placed` ? <span className="pick-hint">{reasonWords(row, mode)}</span> : null}
                {hint === null ? null : <span className="pick-hint">{hint}</span>}
            </span>
            <span className="pick-meta">
                {ownedBy(bot, viewer) || bot.ownerName === null ? null : <span>{words.by(bot.ownerName)}</span>}
                {bot.accepts === undefined ? null : <span>{summarizeAccepts(bot.accepts)}</span>}
                {strengths > 1 ? <span>{words.strengthCount(strengths)}</span> : null}
                {blocked && reason !== `placed` ? <span className="pick-reason">{reasonWords(row, mode)}</span> : null}
            </span>
            <span className="pick-rating">
                <Rating value={bot.rating} provisional={bot.provisional} />
            </span>
        </button>
    );
}

function PickDetail({ ref, row, viewer, onAdd }: { ref: Ref<HTMLDivElement>; row: Row; viewer: string | null; onAdd: (bot: BotListing) => void }) {
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
