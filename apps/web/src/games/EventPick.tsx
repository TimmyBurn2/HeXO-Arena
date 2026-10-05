import { useCallback, useState } from 'react';
import type { TournamentSummary } from '@hexo-arena/contract';
import { fetchTournament, fetchTournaments } from '../api/client';
import { useAsync } from '../api/use-async';
import { text } from '../text';
import { tournamentWhen } from '../tournaments/TournamentRow';
import { Choice, NameField } from './Fields';
import type { GameFilters } from './filters';

/** One tournament by its name, a duel's by its two bots and whether it is a test, and the rounds drawn for it. */
export interface NamedTournament {
    readonly name: string;
    readonly pair: { readonly first: string; readonly second: string; readonly test: boolean } | null;
    readonly rounds: number;
}

/**
 * The one tournament a list is narrowed to, as its chip and its picker
 * name it: null while it loads or when none is chosen, `gone` when its id
 * names none.
 */
export type EventName = NamedTournament | `gone` | null;

// A tournament as the picker and the chip name it: a duel by its pair, a test said so; any other by its name.
function nameOf(tournament: Pick<TournamentSummary, `name` | `test` | `pair`>): string {
    const pair = tournament.pair;
    return pair === undefined ? tournament.name : text.games.pick.pairName(pair.first.name, pair.second.name, tournament.test);
}

const readTournament = async (id: string): Promise<NamedTournament> => {
    const tournament = await fetchTournament(id);
    const [first, second] = tournament.entries;
    const pair = tournament.format === `duel` && first !== undefined && second !== undefined ? { first: first.bot, second: second.bot, test: tournament.test } : null;
    return { name: tournament.name, pair, rounds: tournament.rounds.length };
};

/** The name of the tournament the filters choose; a read keyed by its id, so a stale answer never names another. */
export function useEventName(filters: GameFilters): EventName {
    const id = filters.tournament ?? null;
    const load = useCallback(async () => (id === null ? null : readTournament(id)), [id]);
    const named = useAsync(load, { keep: false });
    return named.missing ? `gone` : named.data;
}

/** The chip's words for the tournament chosen, its kind until its name is known. */
export function tournamentWords(named: EventName): string {
    const chips = text.games.chips;
    if (named === `gone`) return chips.gone;
    if (named === null) return chips.events.tournament;
    return named.pair === null ? chips.tournament(named.name) : chips.duel(named.pair.first, named.pair.second, named.pair.test);
}

// Whether a search matches a tournament: its name or, for a duel, either bot's.
function matches(tournament: TournamentSummary, find: string): boolean {
    const names = [tournament.name, ...(tournament.pair === undefined ? [] : [tournament.pair.first.name, tournament.pair.second.name])];
    return names.some((name) => name.toLowerCase().includes(find.toLowerCase()));
}

/**
 * One tournament to narrow the list to, recent first: those live since
 * they began, then those over that played, when they ended; a duel by its
 * pair; tests among them while the list shows tests; searched by name or
 * by a duel's bot.
 * The tournament chosen stays an option whatever the search.
 */
export function TournamentPick({ value, named, tests, onChange }: { value: string | undefined; named: EventName; tests: boolean; onChange: (tournament: string | undefined) => void }) {
    const pick = text.games.pick;
    const read = useAsync(fetchTournaments);
    const [find, setFind] = useState<string | null>(null);
    const all = read.data === null ? [] : [...read.data.running, ...read.data.past.filter((tournament) => tournament.status !== `called_off`)].filter((tournament) => tests || !tournament.test);
    const listed = find === null ? all : all.filter((tournament) => matches(tournament, find));
    // A live one names when it began, so two of one pair or one creator read apart, as those over name when they ended.
    const options: (readonly [string, string])[] = listed.map(
        (tournament) =>
            [tournament.id, pick.tournamentOption(nameOf(tournament), tournament.status === `running` ? pick.live(tournamentWhen(tournament.startsAt)) : tournamentWhen(tournament.endedAt ?? tournament.startsAt))] as const,
    );
    if (value !== undefined && !listed.some((tournament) => tournament.id === value)) options.unshift([value, tournamentWords(named)]);
    const note = read.error ? pick.failed : read.data !== null && listed.length === 0 && find !== null ? pick.noTournament : null;
    return (
        <>
            <NameField
                id="games-tournament-find"
                label={pick.findTournament}
                value={find ?? undefined}
                wide
                onCommit={(name) => {
                    setFind(name ?? null);
                }}
            />
            <Choice id="games-tournament" label={pick.tournament} value={value} options={options} wide onChange={onChange} />
            <p className="note games-pick-note" role="status">
                {note}
            </p>
        </>
    );
}

/** One round of the tournament chosen, once its rounds are drawn. */
export function RoundPick({ value, rounds, onChange }: { value: string | undefined; rounds: number; onChange: (round: string | undefined) => void }) {
    const options = Array.from({ length: rounds }, (_, index) => [String(index + 1), text.games.pick.roundOption(index + 1)] as const);
    return <Choice id="games-round" label={text.games.pick.round} value={value} options={options} onChange={onChange} />;
}
