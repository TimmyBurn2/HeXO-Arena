import { finishedGamesQuerySchema, nameKeyOf, type FinishedGamesQuery } from '@hexo-arena/contract';

/** The filters a list of finished games can carry, as its address holds them; whether tests show is the browser's, not the address's. */
export type GameFilters = Omit<FinishedGamesQuery, `page` | `tests`>;

/** One filter's name. */
export type FilterKey = keyof GameFilters;

// The filters in the order an address, the chips, and a sentence name them.
const filterKeys = [`player`, `vs`, `result`, `side`, `reason`, `clock`, `kind`, `event`, `duel`, `tournament`, `round`, `opening`, `analyzed`, `before`] as const satisfies readonly FilterKey[];

/** The filters that mean nothing without a player. */
const needPlayer = [`vs`, `side`] as const satisfies readonly FilterKey[];

/** Where a list of finished games stands: its filters and its page, from 1. */
export interface GamesView {
    readonly filters: GameFilters;
    readonly page: number;
}

const fields = finishedGamesQuerySchema.shape;

function field<K extends keyof FinishedGamesQuery>(key: K, raw: string | null): FinishedGamesQuery[K] | undefined {
    if (raw === null) return undefined;
    const parsed = fields[key].safeParse(raw);
    // Each field's schema parses exactly its own key's values.
    return parsed.success ? (parsed.data as FinishedGamesQuery[K]) : undefined;
}

/**
 * The filters an address holds: each value its field does not take is
 * dropped, and so is any filter its player is missing for, so a hand-made
 * or stale link still opens a list rather than a refusal.
 */
export function viewOf(search: string): GamesView {
    const params = new URLSearchParams(search);
    const filters: { -readonly [K in FilterKey]?: GameFilters[K] } = {};
    for (const key of filterKeys) {
        const value = field(key, params.get(key));
        if (value !== undefined) Object.assign(filters, { [key]: value });
    }
    // A hand-made address naming one duel or one tournament alone means its kind.
    if (filters.event === undefined && filters.duel !== undefined) filters.event = `duel`;
    if (filters.event === undefined && filters.tournament !== undefined) filters.event = `tournament`;
    const page = field(`page`, params.get(`page`));
    return { filters: withoutOrphans(filters), page: page === undefined ? 1 : Number(page) };
}

// The filters under the keys given, in their order.
function pick(filters: GameFilters, keys: readonly FilterKey[]): { -readonly [K in FilterKey]?: GameFilters[K] } {
    const kept: { -readonly [K in FilterKey]?: GameFilters[K] } = {};
    for (const key of keys) if (filters[key] !== undefined) Object.assign(kept, { [key]: filters[key] });
    return kept;
}

// The filters with those that need a player dropped while none is set, a
// second name equal to the first dropped, a duel or a tournament dropped
// under another kind of event, and a round dropped with its tournament.
function withoutOrphans(filters: GameFilters): GameFilters {
    const dropped: FilterKey[] = [];
    if (filters.player === undefined) {
        dropped.push(...needPlayer);
        if (filters.result === `won` || filters.result === `lost`) dropped.push(`result`);
    } else if (filters.vs !== undefined && nameKeyOf(filters.vs) === nameKeyOf(filters.player)) {
        dropped.push(`vs`);
    }
    if (filters.event !== `duel`) dropped.push(`duel`);
    if (filters.event !== `tournament`) dropped.push(`tournament`, `round`);
    if (filters.tournament === undefined) dropped.push(`round`);
    return pick(filters, filterKeys.filter((key) => !dropped.includes(key)));
}

/** The address of a list: its filters in a fixed order, then the page past the first. */
export function searchOf(view: GamesView): string {
    const params = new URLSearchParams();
    for (const key of filterKeys) {
        const value = view.filters[key];
        if (value !== undefined) params.set(key, value);
    }
    if (view.page > 1) params.set(`page`, String(view.page));
    return params.size === 0 ? `` : `?${params.toString()}`;
}

/** The address of one page of a list. */
export function pagePathOf(filters: GameFilters, page: number): string {
    return `/games${searchOf({ filters, page })}`;
}

/** The list's address with one filter set or cleared, back on the first page; another tournament leaves the last one's round behind. */
export function withFilter<K extends FilterKey>(filters: GameFilters, key: K, value: GameFilters[K] | undefined): string {
    const next = pick(filters, filterKeys.filter((other) => other !== key && !(key === `tournament` && other === `round`)));
    if (value !== undefined) Object.assign(next, { [key]: value });
    return pagePathOf(withoutOrphans(next), 1);
}

/** The filters set, in their order. */
export function activeKeys(filters: GameFilters): FilterKey[] {
    return filterKeys.filter((key) => filters[key] !== undefined);
}

/** The filters a chip and a sentence name: the kind of event stands behind the one event chosen. */
export function shownKeys(filters: GameFilters): FilterKey[] {
    const chosen = filters.duel !== undefined || filters.tournament !== undefined;
    return activeKeys(filters).filter((key) => key !== `event` || !chosen);
}

/** The finished games of one duel. */
export function duelGamesPath(duel: string): string {
    return pagePathOf({ event: `duel`, duel }, 1);
}

/** The finished games of one tournament, or of one of its rounds. */
export function tournamentGamesPath(tournament: string, round?: number): string {
    return pagePathOf(round === undefined ? { event: `tournament`, tournament } : { event: `tournament`, tournament, round: String(round) }, 1);
}

/** The address of the games one player sat in, against another when named. */
export function gamesPathOf(player: string, vs?: string): string {
    return pagePathOf(vs === undefined ? { player } : { player, vs }, 1);
}
