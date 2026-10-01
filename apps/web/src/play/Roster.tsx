import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { nameKeyOf, type BotListing } from '@hexo-arena/contract';
import { BotBadge, Rating, summarizeAccepts } from '../components/player';
import { Link } from '../router/Link';
import { text } from '../text';
import { readinessOf, type Readiness, type Roster } from './setup';

/** How a bot was picked: by a pointer, or by keys still moving through the list. */
export type PickedBy = `pointer` | `keys`;

/**
 * The bots as one radio group: named bots that are not ready first with
 * their reasons, the ready bots, then the busy ones dimmed and not selectable.
 */
export function RosterList({
    roster,
    chosen,
    name,
    labelledBy,
    onChoose,
    reserved,
}: {
    roster: Roster;
    // The bots the running tournament holds, listed busy with their own reason.
    reserved: ReadonlySet<string>;
    chosen: BotListing;
    name: string;
    labelledBy: string;
    onChoose: (bot: BotListing, from: PickedBy) => void;
}) {
    // Arrow keys pick as they move,
    // so a pick says whether it came from the keys, which are still walking,
    // or from a pointer, which is done.
    const from = useRef<PickedBy>(`pointer`);
    const rows: { bot: BotListing; state: Readiness }[] = [
        ...roster.named.map((bot) => ({ bot, state: readinessOf(bot) })),
        ...roster.ready.map((bot) => ({ bot, state: `ready` as const })),
        ...roster.busy.map((bot) => ({ bot, state: reserved.has(bot.name) ? (`tournament` as const) : (`busy` as const) })),
    ];
    return (
        <>
            <div
                className="roster"
                role="radiogroup"
                aria-labelledby={labelledBy}
                onKeyDown={() => {
                    from.current = `keys`;
                }}
                onPointerDown={() => {
                    from.current = `pointer`;
                }}
            >
                {rows.map(({ bot, state }) => {
                    const checked = nameKeyOf(bot.name) === nameKeyOf(chosen.name);
                    // A busy bot cannot be picked; one the link named stays picked with its reason.
                    const disabled = (state === `busy` || state === `tournament`) && !checked;
                    return (
                        <label key={bot.name} className="roster-row" aria-disabled={disabled ? `true` : undefined}>
                            <input
                                type="radio"
                                name={name}
                                value={bot.name}
                                checked={checked}
                                disabled={disabled}
                                onChange={() => {
                                    onChoose(bot, from.current);
                                }}
                                onClick={() => {
                                    // A press on the bot already picked is still the person's pick, and closes the sheet.
                                    if (checked) onChoose(bot, from.current);
                                }}
                                onKeyUp={(event) => {
                                    // Space on a radio already checked fires no click.
                                    if (event.key === ` ` && checked) onChoose(bot, `keys`);
                                }}
                            />
                            <span className="roster-name">
                                <span className="player-name">{bot.name}</span>
                                <BotBadge />
                            </span>
                            <span className="roster-meta">
                                {state === `ready` ? (
                                    <>
                                        {bot.ownerName === null ? null : <span>{text.play.by(bot.ownerName)}</span>}
                                        <span>{summarizeAccepts(bot.accepts)}</span>
                                    </>
                                ) : (
                                    <span className="roster-reason">{state === `busy` ? text.play.busy : state === `tournament` ? text.play.inTournament : text.play.reasons[state]}</span>
                                )}
                            </span>
                            <span className="roster-rating">
                                <Rating value={bot.rating} provisional={bot.provisional} />
                            </span>
                        </label>
                    );
                })}
            </div>
            {roster.others === 0 ? null : <p className="note roster-foot">{text.play.others(roster.others, (words) => <Link to="/bots">{words}</Link>)}</p>}
        </>
    );
}

// Where the roster gives way to the chooser and its sheet, as the Play sheet's phone rules do.
const phoneQuery = `(max-width: 44rem)`;

/**
 * The phone's list of bots, a modal sheet from the foot of the window;
 * Enter on a bot closes it, as a tap does.
 */
export function OpponentSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
    const ref = useRef<HTMLDialogElement>(null);
    const [opener] = useState(() => document.activeElement);
    useLayoutEffect(() => {
        const dialog = ref.current;
        if (dialog === null || dialog.open) return;
        dialog.showModal();
        dialog.querySelector<HTMLInputElement>(`input:checked`)?.focus();
    }, []);
    // A list read that drops the focused bot leaves focus on the page behind the modal,
    // so it comes back to the bot picked.
    useEffect(() => {
        const dialog = ref.current;
        if (dialog?.open === true && !dialog.contains(document.activeElement)) dialog.querySelector<HTMLInputElement>(`input:checked`)?.focus();
    });
    // A window widened past the phone shows the roster the sheet stands in for.
    useEffect(() => {
        const phone = window.matchMedia(phoneQuery);
        function onChange() {
            if (!phone.matches) onClose();
        }
        phone.addEventListener(`change`, onChange);
        return () => {
            phone.removeEventListener(`change`, onChange);
        };
    }, [onClose]);
    // The sheet leaves the page rather than closing,
    // so focus goes back by hand to what opened it, once the modal is gone and the page can take it;
    // when that is gone or hidden, as after the window widens or Back, it goes to the bot picked in the roster,
    // or to the new card's Change.
    useEffect(
        () => () => {
            const shown = (element: Element | null): element is HTMLElement =>
                element instanceof HTMLElement && element.isConnected && element.getClientRects().length > 0;
            const candidates = [opener, ...document.querySelectorAll(`.play-roster input:checked, .bot-choice-side button`)];
            candidates.find(shown)?.focus();
        },
        [opener],
    );
    return (
        <dialog
            ref={ref}
            className="topbar-panel play-sheet"
            data-mode="sheet"
            aria-labelledby="sheet-title"
            onClose={onClose}
            onClick={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
            onKeyDown={(event) => {
                if (event.key !== `Enter` || !(event.target instanceof HTMLInputElement)) return;
                event.preventDefault();
                // Enter on the bot shown picks it, as a tap does, before the sheet goes.
                event.target.click();
                onClose();
            }}
        >
            <div className="topbar-panel-body">
                <div className="topbar-panel-head">
                    <h2 id="sheet-title" className="play-sheet-title">
                        {text.play.opponent}
                    </h2>
                    <button type="button" className="topbar-panel-close" aria-label={text.play.closeSheet} onClick={onClose}>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                    </button>
                </div>
                {children}
            </div>
        </dialog>
    );
}
