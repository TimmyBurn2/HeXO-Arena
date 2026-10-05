import { tournamentMissesToWithdraw } from '@hexo-arena/contract';

/** One of the two bots of a pairing: first plays x in game 1, second in game 2. */
export type PairingSeat = `first` | `second`;

// Two bots who meet once in a round.
interface RoundPairing {
    readonly first: string;
    readonly second: string;
}

// One round: its pairings, and the bot that rests when the field is odd.
interface Round {
    readonly round: number;
    readonly pairings: readonly RoundPairing[];
    readonly rest: string | null;
}

/** Where one game of a pairing stands, and what it scored. */
export type SlotResult =
    | { readonly kind: `pending` }
    | { readonly kind: `live` }
    | { readonly kind: `played`; readonly winner: PairingSeat | null }
    | { readonly kind: `no_show`; readonly missing: PairingSeat | `both` }
    | { readonly kind: `forfeit`; readonly withdrawn: PairingSeat | `both` }
    | { readonly kind: `not_played` }
    | { readonly kind: `aborted` };

/**
 * A pairing with the results of its games, game 1 first: two, or one
 * where the pair plays a single game. A pair playing several openings
 * meets in one per opening, its leg, 1 when absent.
 */
export interface ScoredPairing extends RoundPairing {
    readonly round: number;
    readonly leg?: number;
    readonly games: readonly SlotResult[];
}

// A bot's line in the standings.
interface Standing {
    // Shared by bots tied on points, head-to-head points, and Sonneborn-Berger.
    readonly rank: number;
    readonly bot: string;
    readonly points: number;
    readonly asX: number;
    readonly asO: number;
}

function other(seat: PairingSeat): PairingSeat {
    return seat === `first` ? `second` : `first`;
}

/**
 * The circle method: every bot meets every other once, N - 1 rounds for an
 * even field and N for an odd one, where each bot rests once.
 * The first bot of the field stays put while the rest turn around it, and
 * who plays x first alternates round by round.
 */
export function roundRobin(field: readonly string[]): Round[] {
    const seats: (string | null)[] = field.length % 2 === 0 ? [...field] : [...field, null];
    const size = seats.length;
    const rounds: Round[] = [];
    for (let round = 0; round < size - 1; round++) {
        const pairings: RoundPairing[] = [];
        let rest: string | null = null;
        for (let index = 0; index < size / 2; index++) {
            const top = seats[index] ?? null;
            const bottom = seats[size - 1 - index] ?? null;
            if (top === null || bottom === null) {
                rest = top ?? bottom;
                continue;
            }
            const swap = index === 0 ? round % 2 === 1 : index % 2 === 1;
            pairings.push(swap ? { first: bottom, second: top } : { first: top, second: bottom });
        }
        rounds.push({ round: round + 1, pairings, rest });
        // The first seat stays; the others turn one place.
        const last = seats.pop() ?? null;
        seats.splice(1, 0, last);
    }
    return rounds;
}

/**
 * A slot as the pairing row stores it: the state, and the seat it names,
 * the winner of a played game, the bot that missed a no-show, or the bot
 * withdrawn from a forfeit, both for the last two when neither came.
 */
export function storedSlot(state: string, seat: string | null): SlotResult {
    const named = seat === `first` || seat === `second` ? seat : null;
    switch (state) {
        case `played`:
            return { kind: `played`, winner: named };
        case `no_show`:
            return { kind: `no_show`, missing: named ?? `both` };
        case `forfeit`:
            return { kind: `forfeit`, withdrawn: named ?? `both` };
        case `live`:
        case `not_played`:
        case `aborted`:
            return { kind: state };
        default:
            return { kind: `pending` };
    }
}

/** A pairing row's slots as results: both, or game 1 alone where its second slot is none. */
export function storedSlots(row: { readonly game1: string; readonly game1Seat: string | null; readonly game2: string; readonly game2Seat: string | null }): SlotResult[] {
    const first = storedSlot(row.game1, row.game1Seat);
    return row.game2 === `none` ? [first] : [first, storedSlot(row.game2, row.game2Seat)];
}

/** The seat a slot's point went to, if any: a no-show or a withdrawal scores for the bot that remained. */
export function pointOf(result: SlotResult): PairingSeat | null {
    switch (result.kind) {
        case `played`:
            return result.winner;
        case `no_show`:
            return result.missing === `both` ? null : other(result.missing);
        case `forfeit`:
            return result.withdrawn === `both` ? null : other(result.withdrawn);
        case `pending`:
        case `live`:
        case `not_played`:
        case `aborted`:
            return null;
    }
}

/** The seat that plays x in a pairing's game: first in game 1, second in game 2. */
export function xSeatOf(game: number): PairingSeat {
    return game === 1 ? `first` : `second`;
}

function botAt(pairing: RoundPairing, seat: PairingSeat): string {
    return seat === `first` ? pairing.first : pairing.second;
}

/** Whether a slot is over, so the pairing can move on. */
export function slotDone(result: SlotResult): boolean {
    return result.kind !== `pending` && result.kind !== `live`;
}

// Points each bot scored against each opponent.
function scoreTable(pairings: readonly ScoredPairing[]): Map<string, Map<string, number>> {
    const table = new Map<string, Map<string, number>>();
    const add = (bot: string, opponent: string) => {
        const row = table.get(bot) ?? new Map<string, number>();
        row.set(opponent, (row.get(opponent) ?? 0) + 1);
        table.set(bot, row);
    };
    for (const pairing of pairings) {
        for (const result of pairing.games) {
            const seat = pointOf(result);
            if (seat !== null) add(botAt(pairing, seat), botAt(pairing, other(seat)));
        }
    }
    return table;
}

/**
 * The standings: one point per game won, a no-show or a withdrawal scoring
 * for the opponent; ties broken by the points among the tied bots, then by
 * Sonneborn-Berger (each opponent's total, times the points taken from
 * that opponent), and otherwise shared.
 */
export function standingsOf(field: readonly string[], pairings: readonly ScoredPairing[]): Standing[] {
    const table = scoreTable(pairings);
    const points = new Map(field.map((bot) => [bot, 0]));
    const asX = new Map(field.map((bot) => [bot, 0]));
    const asO = new Map(field.map((bot) => [bot, 0]));
    for (const pairing of pairings) {
        for (const [index, result] of pairing.games.entries()) {
            const seat = pointOf(result);
            if (seat === null) continue;
            const bot = botAt(pairing, seat);
            points.set(bot, (points.get(bot) ?? 0) + 1);
            const sides = seat === xSeatOf(index + 1) ? asX : asO;
            sides.set(bot, (sides.get(bot) ?? 0) + 1);
        }
    }
    const total = (bot: string) => points.get(bot) ?? 0;
    const against = (bot: string, opponent: string) => table.get(bot)?.get(opponent) ?? 0;
    const sonnebornBerger = (bot: string) => field.reduce((sum, opponent) => sum + against(bot, opponent) * total(opponent), 0);
    const tiedWith = (bot: string) => field.filter((candidate) => total(candidate) === total(bot));
    const headToHead = (bot: string) => tiedWith(bot).reduce((sum, opponent) => sum + against(bot, opponent), 0);
    const key = (bot: string) => [total(bot), headToHead(bot), sonnebornBerger(bot)] as const;
    const order = [...field].sort((one, two) => {
        const [a, b] = [key(one), key(two)];
        return b[0] - a[0] || b[1] - a[1] || b[2] - a[2] || one.localeCompare(two);
    });
    return order.map((bot) => {
        const mine = key(bot);
        const rank = 1 + order.findIndex((candidate) => key(candidate).every((value, index) => value === mine[index]));
        return { rank, bot, points: total(bot), asX: asX.get(bot) ?? 0, asO: asO.get(bot) ?? 0 };
    });
}

/**
 * Whether a bot missed {@link tournamentMissesToWithdraw} pairings in a row: it
 * showed for none of the games it was due in any of them, so it is withdrawn.
 * Pairings are taken in round order and a pair's openings in theirs, rests
 * skipped; the count stops at the first pairing still running.
 */
export function missedTooManyInARow(bot: string, pairings: readonly ScoredPairing[]): boolean {
    const own = pairings
        .filter((pairing) => pairing.first === bot || pairing.second === bot)
        .sort((one, two) => one.round - two.round || (one.leg ?? 1) - (two.leg ?? 1));
    let streak = 0;
    for (const pairing of own) {
        if (!pairing.games.every(slotDone)) break;
        const seat: PairingSeat = pairing.first === bot ? `first` : `second`;
        const missed = pairing.games.every((result) => result.kind === `no_show` && (result.missing === seat || result.missing === `both`));
        streak = missed ? streak + 1 : 0;
        if (streak >= tournamentMissesToWithdraw) return true;
    }
    return false;
}
