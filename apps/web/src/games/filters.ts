import { finishedGamesQuerySchema, nameKeyOf, type FinishedGamesQuery } from '@hexo-arena/contract';

/** The filters a list of finished games can carry, as its address holds them. */
export type GameFilters = Omit<FinishedGamesQuery, `cursor`>;

/** One filter's name. */
export type FilterKey = keyof GameFilters;

/** The filters in the order an address, the chips, and a sentence name them. */
export const filterKeys = [`player`, `vs`, `result`, `side`, `reason`, `clock`, `kind`, `opening`, `before`] as const satisfies readonly FilterKey[];

/** The filters that mean nothing without a player. */
const needPlayer = [`vs`, `side`] as const satisfies readonly FilterKey[];

/** Where a list of finished games stands: its filters and the page its cursor names. */
export interface GamesView {
    readonly filters: GameFilters;
    readonly cursor: string | null;
}

const fields = finishedGamesQuerySchema.shape;

function field<K extends FilterKey | `cursor`>(key: K, raw: string | null): FinishedGamesQuery[K] | undefined {
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
    return { filters: withoutOrphans(filters), cursor: field(`cursor`, params.get(`cursor`)) ?? null };
}

// The filters under the keys given, in their order.
function pick(filters: GameFilters, keys: readonly FilterKey[]): { -readonly [K in FilterKey]?: GameFilters[K] } {
    const kept: { -readonly [K in FilterKey]?: GameFilters[K] } = {};
    for (const key of keys) if (filters[key] !== undefined) Object.assign(kept, { [key]: filters[key] });
    return kept;
}

/** The filters with those that need a player dropped while none is set, and a second name equal to the first dropped. */
export function withoutOrphans(filters: GameFilters): GameFilters {
    const dropped: FilterKey[] = [];
    if (filters.player === undefined) {
        dropped.push(...needPlayer);
        if (filters.result === `won` || filters.result === `lost`) dropped.push(`result`);
    } else if (filters.vs !== undefined && nameKeyOf(filters.vs) === nameKeyOf(filters.player)) {
        dropped.push(`vs`);
    }
    return pick(filters, filterKeys.filter((key) => !dropped.includes(key)));
}

/** The address of a list: its filters in a fixed order, then the cursor. */
export function searchOf(view: GamesView): string {
    const params = new URLSearchParams();
    for (const key of filterKeys) {
        const value = view.filters[key];
        if (value !== undefined) params.set(key, value);
    }
    if (view.cursor !== null) params.set(`cursor`, view.cursor);
    return params.size === 0 ? `` : `?${params.toString()}`;
}

/** The list's address with one filter set or cleared, back on the first page. */
export function withFilter<K extends FilterKey>(filters: GameFilters, key: K, value: GameFilters[K] | undefined): string {
    const next = pick(filters, filterKeys.filter((other) => other !== key));
    if (value !== undefined) Object.assign(next, { [key]: value });
    return `/games${searchOf({ filters: withoutOrphans(next), cursor: null })}`;
}

/** The filters set, in their order. */
export function activeKeys(filters: GameFilters): FilterKey[] {
    return filterKeys.filter((key) => filters[key] !== undefined);
}

/** The address of the games one player sat in, against another when named. */
export function gamesPathOf(player: string, vs?: string): string {
    return `/games${searchOf({ filters: vs === undefined ? { player } : { player, vs }, cursor: null })}`;
}
