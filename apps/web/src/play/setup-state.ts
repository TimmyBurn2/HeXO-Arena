import type { BotListing, Level, OpeningPlies, TimeControl } from '@hexo-arena/contract';
import type { PickedBy } from './Roster';
import type { PickedLevel } from './setup';

/**
 * One visit's setup on Play, which a new visit starts over: the bot the
 * person picked, the one the page opened on, and the one that left the
 * list, named in a line until the person picks; the bots the card showed
 * while not ready, which keep their rows; how many picks the person made;
 * the clock, opening, and strength picked; and whether the bot sheet is
 * open.
 */
export interface SetupState {
    readonly picked: string | null;
    readonly opened: string | null;
    readonly lost: string | null;
    readonly shown: readonly string[];
    readonly choices: number;
    readonly clock: TimeControl | null;
    readonly opening: OpeningPlies;
    readonly strength: PickedLevel | null;
    readonly sheet: boolean;
}

/** What a visit opens on: the bot, clock, opening, and strength the address names. */
export interface Asked {
    readonly bot: string | null;
    readonly clock: TimeControl | null;
    readonly opening: OpeningPlies;
    readonly level: PickedLevel | null;
}

/** A visit's setup before any pick, on what the address asks for. */
export function firstSetup(asked: Asked): SetupState {
    return { picked: null, opened: null, lost: null, shown: [], choices: 0, clock: asked.clock, opening: asked.opening, strength: asked.level, sheet: false };
}

/**
 * What one read of the bot list tells the setup: the listed bot of a name,
 * whether a bot can start a game now, and the bot to open on, the one the
 * address names counted only while no bot was lost; null until the visitor
 * is known.
 */
export interface ListFacts {
    readonly find: (name: string) => BotListing | null;
    readonly ready: (bot: BotListing) => boolean;
    readonly open: (fromAddress: boolean) => BotListing | null;
}

/**
 * A change to the setup: a bot picked, from the list or its sheet; a clock
 * the person picked, or the clock picker's own adjustment, which is no
 * pick; a strength, an opening, or the Rated switch, which the page keeps
 * across visits and the setup only counts; the sheet opened or closed; or
 * a list read to settle on.
 */
export type SetupAction =
    | { readonly kind: `pick`; readonly bot: string; readonly from: PickedBy }
    | { readonly kind: `clock`; readonly clock: TimeControl }
    | { readonly kind: `adjust`; readonly clock: TimeControl }
    | { readonly kind: `level`; readonly level: PickedLevel }
    | { readonly kind: `opening`; readonly opening: OpeningPlies }
    | { readonly kind: `rated` }
    | { readonly kind: `sheet`; readonly open: boolean }
    | { readonly kind: `settle`; readonly facts: ListFacts };

/**
 * The setup after a list read: until the person picks, the page stays on
 * the bot it opened on, so a read after a refusal never swaps the card
 * under the line that explains it.
 * A bot picked or opened on that leaves the list gives way to a new bot to
 * open on, which the page then stays on, and its name stays in a line;
 * listed again before the person picks, it takes the card back.
 * A bot the card shows while not ready keeps its row for the visit, so
 * picking another never moves the list under the pointer.
 * Unchanged, the same setup comes back.
 */
export function settle(setup: SetupState, facts: ListFacts): SetupState {
    let next = setup;
    if (next.picked !== null) {
        if (facts.find(next.picked) === null) next = { ...next, picked: null, opened: null, lost: next.picked };
    } else if (next.opened !== null && facts.find(next.opened) === null) {
        next = { ...next, opened: null, lost: next.opened };
    } else if (next.lost !== null && facts.find(next.lost) !== null) {
        next = { ...next, opened: next.lost, lost: null };
    }
    if (next.picked === null && next.opened === null) {
        const open = facts.open(next.lost === null);
        if (open !== null) next = { ...next, opened: open.name };
    }
    const shows = shownBot(next, facts);
    if (shows !== null && !facts.ready(shows) && !next.shown.includes(shows.name)) next = { ...next, shown: [...next.shown, shows.name] };
    return next;
}

/** The bot the card shows: the one picked, else the one opened on; null while neither is listed. */
export function shownBot(setup: SetupState, facts: Pick<ListFacts, `find`>): BotListing | null {
    return (setup.picked === null ? null : facts.find(setup.picked)) ?? (setup.opened === null ? null : facts.find(setup.opened));
}

/** The setup after a change; a strength belongs to the bot it was picked for, so a pick opens on the new bot's default. */
export function setupReducer(setup: SetupState, action: SetupAction): SetupState {
    switch (action.kind) {
        case `pick`:
            return { ...setup, picked: action.bot, strength: null, lost: null, choices: setup.choices + 1, sheet: action.from === `pointer` ? false : setup.sheet };
        case `clock`:
            return { ...setup, clock: action.clock, choices: setup.choices + 1 };
        case `adjust`:
            return { ...setup, clock: action.clock };
        case `level`:
            return { ...setup, strength: action.level, choices: setup.choices + 1 };
        case `opening`:
            return { ...setup, opening: action.opening, choices: setup.choices + 1 };
        case `rated`:
            return { ...setup, choices: setup.choices + 1 };
        case `sheet`:
            return { ...setup, sheet: action.open };
        case `settle`:
            return settle(setup, action.facts);
    }
}

/**
 * The setup as the card shows it and a start sends it: the bot, its clock
 * and strength, null at its default, and the opening; whether the bot is
 * the person's own, which plays them unrated; the Rated switch, null for
 * anyone not signed in, and whether the game asked for is rated; the clock
 * last started in this browser; the setup's own address, where a sign-in
 * from the card returns; the line naming a bot no longer listed; and how
 * many picks the person made, so a line gives way to their next one and
 * not to the list's.
 */
export interface CardSetup {
    readonly bot: BotListing;
    readonly clock: TimeControl;
    readonly level: Level | null;
    readonly opening: OpeningPlies;
    readonly own: boolean;
    readonly switchOn: boolean | null;
    readonly rated: boolean;
    readonly last: TimeControl | null;
    readonly path: string;
    readonly notice: string | null;
    readonly choices: number;
}
