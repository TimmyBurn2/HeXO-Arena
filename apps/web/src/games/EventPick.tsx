import { useCallback, useEffect, useState } from 'react';
import type { DuelSummary } from '@hexo-arena/contract';
import { ApiError, fetchDuel, fetchDuels, fetchTournament, fetchTournaments } from '../api/client';
import { useAsync } from '../api/use-async';
import { scoreText } from '../duels/words';
import { text } from '../text';
import { Choice, NameField } from './Fields';
import type { GameFilters } from './filters';

/** One duel by its bots, and whether it is a test. */
export interface NamedDuel {
    readonly first: string;
    readonly second: string;
    readonly test: boolean;
}

/** One tournament by its name, and the rounds drawn for it. */
export interface NamedTournament {
    readonly name: string;
    readonly rounds: number;
}

/**
 * The one duel or tournament a list is narrowed to, as its chip and its
 * picker name it: null while it loads or when none is chosen, `gone` when
 * its id names none.
 */
export interface EventNames {
    readonly duel: NamedDuel | `gone` | null;
    readonly tournament: NamedTournament | `gone` | null;
}

// A read keyed by the id it answers, so a stale answer never names another event.
function useNamed<T>(id: string | null, read: (id: string) => Promise<T>): T | `gone` | null {
    const [held, setHeld] = useState<{ id: string; named: T | `gone` } | null>(null);
    useEffect(() => {
        if (id === null) return;
        let cancelled = false;
        read(id).then(
            (named) => {
                if (!cancelled) setHeld({ id, named });
            },
            (cause: unknown) => {
                if (!cancelled && cause instanceof ApiError && cause.status === 404) setHeld({ id, named: `gone` });
            },
        );
        return () => {
            cancelled = true;
        };
    }, [id, read]);
    return held !== null && held.id === id ? held.named : null;
}

const readDuel = async (id: string): Promise<NamedDuel> => {
    const duel = await fetchDuel(id);
    return { first: duel.first.name, second: duel.second.name, test: duel.kind === `test` };
};

const readTournament = async (id: string): Promise<NamedTournament> => {
    const tournament = await fetchTournament(id);
    return { name: tournament.name, rounds: tournament.rounds.length };
};

/** The names of the duel or the tournament the filters choose. */
export function useEventNames(filters: GameFilters): EventNames {
    return { duel: useNamed(filters.duel ?? null, readDuel), tournament: useNamed(filters.tournament ?? null, readTournament) };
}

/** The chip's words for the duel chosen, its kind until its bots are known. */
export function duelWords(named: EventNames[`duel`]): string {
    const chips = text.games.chips;
    if (named === `gone`) return chips.gone.duel;
    return named === null ? chips.events.duel : chips.duel(named.first, named.second, named.test);
}

/** The chip's words for the tournament chosen, its kind until its name is known. */
export function tournamentWords(named: EventNames[`tournament`]): string {
    const chips = text.games.chips;
    if (named === `gone`) return chips.gone.tournament;
    return named === null ? chips.events.tournament : chips.tournament(named.name);
}

type DuelsRead = { kind: `loading` } | { kind: `ready`; duels: readonly DuelSummary[] } | { kind: `unknown`; bot: string } | { kind: `failed` };

/**
 * One duel to narrow the list to, recent first: running ones, then those
 * over, of every bot or of the one searched for; tests among them while
 * the list shows tests.
 * The duel chosen stays an option whatever the search.
 */
export function DuelPick({ value, named, tests, onChange }: { value: string | undefined; named: EventNames[`duel`]; tests: boolean; onChange: (duel: string | undefined) => void }) {
    const pick = text.games.pick;
    const [bot, setBot] = useState<string | null>(null);
    const [read, setRead] = useState<DuelsRead>({ kind: `loading` });
    useEffect(() => {
        let cancelled = false;
        fetchDuels(bot === null ? {} : { bot }).then(
            (list) => {
                if (!cancelled) setRead({ kind: `ready`, duels: [...list.running, ...list.past] });
            },
            (cause: unknown) => {
                if (!cancelled) setRead(bot !== null && cause instanceof ApiError && cause.status === 404 ? { kind: `unknown`, bot } : { kind: `failed` });
            },
        );
        return () => {
            cancelled = true;
        };
    }, [bot]);
    const listed = read.kind === `ready` ? read.duels.filter((duel) => tests || duel.kind !== `test`) : [];
    const options: (readonly [string, string])[] = listed.map((duel) => [duel.id, pick.duelOption(duel.first.name, duel.second.name, scoreText(duel), duel.kind === `test`)] as const);
    if (value !== undefined && !listed.some((duel) => duel.id === value)) options.unshift([value, duelWords(named)]);
    const note = read.kind === `unknown` ? pick.noBot(read.bot) : read.kind === `failed` ? pick.failed : read.kind === `ready` && listed.length === 0 && bot !== null ? pick.noDuel : null;
    return (
        <>
            <NameField
                id="games-duel-find"
                label={pick.findDuel}
                value={bot ?? undefined}
                wide
                onCommit={(name) => {
                    setBot(name ?? null);
                }}
            />
            <Choice id="games-duel" label={pick.duel} value={value} options={options} wide onChange={onChange} />
            <p className="note games-pick-note" role="status">
                {note}
            </p>
        </>
    );
}

/**
 * One tournament to narrow the list to, recent first: the one live, then
 * those over that played; searched by name.
 * The tournament chosen stays an option whatever the search.
 */
export function TournamentPick({ value, named, onChange }: { value: string | undefined; named: EventNames[`tournament`]; onChange: (tournament: string | undefined) => void }) {
    const pick = text.games.pick;
    const read = useAsync(fetchTournaments);
    const [find, setFind] = useState<string | null>(null);
    const day = useCallback((iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: `medium` }).format(new Date(iso)), []);
    const all = read.data === null ? [] : [...(read.data.running === null ? [] : [read.data.running]), ...read.data.past.filter((tournament) => tournament.status !== `called_off`)];
    const listed = find === null ? all : all.filter((tournament) => tournament.name.toLowerCase().includes(find.toLowerCase()));
    const options: (readonly [string, string])[] = listed.map((tournament) => [tournament.id, pick.tournamentOption(tournament.name, day(tournament.startsAt))] as const);
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
