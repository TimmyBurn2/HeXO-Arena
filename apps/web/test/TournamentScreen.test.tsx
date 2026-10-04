// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TournamentBot, TournamentDetail, TournamentGame, TournamentList } from '@hexo-arena/contract';
import { meStore } from '../src/me';
import { TournamentScreen } from '../src/screens/TournamentScreen';
import { TournamentsScreen } from '../src/screens/TournamentsScreen';
import { text } from '../src/text';
import { currentRound, meeting, roundStates } from '../src/tournaments/view';

const hour = 3_600_000;

// Each bot's number in its tournament, its place among the entries, which the pages key it by.
const keys: Readonly<Record<string, number>> = { hextide: 1, quietlake: 2, tern: 3, alpha: 1, beta: 2, gamma: 3, delta: 4 };
const key = (bot: string) => keys[bot] ?? 0;
const seat = (bot: string) => ({ key: key(bot), name: bot });

function game(x: string, outcome: TournamentGame[`outcome`], point: string | null = null, gameId: string | null = null, missing: string[] = []): TournamentGame {
    return { x: key(x), gameId, outcome, point: point === null ? null : key(point), missing: missing.map(key) };
}

const base: TournamentDetail = {
    id: `t_abcdefghijk2`,
    name: `Autumn round robin`,
    status: `scheduled`,
    startsAt: new Date(Date.now() + 2 * hour + 30_000).toISOString().replace(/\.\d{3}Z$/u, `Z`),
    startedAt: null,
    endedAt: null,
    timeControl: { mode: `turn`, turnTimeMs: 10_000 },
    openingPlies: 5,
    maxEntrants: 12,
    entries: [
        { key: 1, bot: `hextide`, ownerName: `ana`, online: true, ratingAtStart: null, state: `entered` },
        { key: 2, bot: `quietlake`, ownerName: `dmitri`, online: false, ratingAtStart: null, state: `entered` },
    ],
    rounds: [],
    standings: [],
    live: [],
};

const playing = (bot: string, owner: string, rating: number) => ({ key: key(bot), bot, ownerName: owner, online: true, ratingAtStart: rating, state: `playing` as const });

const running: TournamentDetail = {
    ...base,
    status: `running`,
    startedAt: `2026-10-01T18:00:00Z`,
    entries: [playing(`alpha`, `ann`, 1600), playing(`beta`, `bob`, 1550), playing(`gamma`, `cid`, 1500), { key: 4, bot: `delta`, ownerName: `dee`, online: false, ratingAtStart: null, state: `absent` }],
    rounds: [
        { round: 1, pairings: [{ first: seat(`alpha`), second: seat(`beta`), games: [game(`alpha`, `played`, `alpha`, `g_1`), game(`beta`, `played`, `beta`, `g_2`)] }], rest: seat(`gamma`) },
        { round: 2, pairings: [{ first: seat(`gamma`), second: seat(`alpha`), games: [game(`gamma`, `live`, null, `g_3`), game(`alpha`, `pending`)] }], rest: seat(`beta`) },
        { round: 3, pairings: [{ first: seat(`beta`), second: seat(`gamma`), games: [game(`beta`, `pending`), game(`gamma`, `pending`)] }], rest: seat(`alpha`) },
    ],
    standings: [
        { rank: 1, key: key(`alpha`), bot: `alpha`, ownerName: `ann`, points: 1, asX: 1, asO: 0, withdrawn: false },
        { rank: 1, key: key(`beta`), bot: `beta`, ownerName: `bob`, points: 1, asX: 1, asO: 0, withdrawn: false },
        { rank: 3, key: key(`gamma`), bot: `gamma`, ownerName: `cid`, points: 0, asX: 0, asO: 0, withdrawn: false },
    ],
};

const finished: TournamentDetail = {
    ...running,
    status: `finished`,
    endedAt: `2026-10-01T19:00:00Z`,
    entries: [...running.entries.slice(0, 3), { key: 4, bot: `delta`, ownerName: `dee`, online: false, ratingAtStart: null, state: `left_out`, reason: `daily_cap` }],
    rounds: running.rounds.map((round) => ({
        ...round,
        pairings: round.pairings.map((pairing) => ({ ...pairing, games: pairing.games.map((entry, index) => ({ ...entry, outcome: `played` as const, gameId: entry.gameId ?? `g_${String(round.round)}${String(index)}`, point: entry.point ?? pairing.first.key })) })),
    })),
    standings: [
        { rank: 1, key: key(`alpha`), bot: `alpha`, ownerName: `ann`, points: 3, asX: 2, asO: 1, withdrawn: false },
        { rank: 2, key: key(`gamma`), bot: `gamma`, ownerName: `cid`, points: 2, asX: 1, asO: 1, withdrawn: false },
        { rank: 3, key: key(`beta`), bot: `beta`, ownerName: `bob`, points: 1, asX: 1, asO: 0, withdrawn: false },
    ],
};

const ana = { kind: `user`, name: `ana`, rating: 1503, provisional: false, discord: null, liveGames: [], analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } };
const anaBots = [
    { name: `hextide`, ownerName: `ana`, online: true, openForChallenges: true, rating: 1690, provisional: false, liveGames: 0, levels: null, analyzer: null },
    { name: `pebble`, ownerName: `ana`, online: true, openForChallenges: true, rating: 1400, provisional: true, liveGames: 0, levels: null, analyzer: null },
    { name: `quietlake`, ownerName: `dmitri`, online: false, openForChallenges: false, rating: 1123, provisional: true, liveGames: 0, levels: null, analyzer: null },
];

interface Call {
    url: string;
    method: string;
    body: unknown;
}

function serve(detail: () => TournamentDetail | number, me: unknown = null, entry: () => Response = () => new Response(`{}`)): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal(
        `fetch`,
        vi.fn((url: string, init?: RequestInit) => {
            const method = init?.method ?? `GET`;
            calls.push({ url, method, body: typeof init?.body === `string` ? JSON.parse(init.body) : null });
            if (url === `/api/me`) return Promise.resolve(new Response(JSON.stringify(me)));
            if (url.startsWith(`/api/bots`)) return Promise.resolve(new Response(JSON.stringify(anaBots)));
            if (url.endsWith(`/entry`)) return Promise.resolve(entry());
            const answer = detail();
            return Promise.resolve(typeof answer === `number` ? new Response(`{"code":"not_found"}`, { status: answer }) : new Response(JSON.stringify(answer)));
        }),
    );
    meStore.reset();
    meStore.start();
    return calls;
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    meStore.reset();
});

describe('TournamentScreen', () => {
    it('say when a waiting tournament starts, list its entries with presence, and offer a signed-out reader the sign-in', async () => {
        serve(() => base);
        render(<TournamentScreen id={base.id} />);
        expect(await screen.findByRole(`heading`, { level: 1, name: `Autumn round robin` })).toBeTruthy();
        expect(screen.getByText(/^Starts .*\(\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\), in 2 hours\.$/u)).toBeTruthy();
        expect(screen.getByText(/2 bots, one per owner; turn clock 10 s; 5-stone openings; rated\./u)).toBeTruthy();
        expect(screen.getByText(/Each pair draws one opening, the origin and 4 random stones near it, and plays it twice, sides swapped, one game after the other\.$/u)).toBeTruthy();
        const entries = screen.getByRole(`heading`, { name: `Entered (2 of 12)` }).closest(`section`) as HTMLElement;
        expect(within(entries).getAllByRole(`listitem`).map((item) => item.textContent)).toEqual([`hextideBOTby ana`, `quietlakeBOTby dmitri`]);
        expect(within(entries).getByRole(`link`, { name: `ana` }).getAttribute(`href`)).toBe(`/players/ana`);
        expect(entries.querySelectorAll(`.dot`)).toHaveLength(2);
        expect(await screen.findByText(`Sign in to enter a bot.`)).toBeTruthy();
    });

    it('let an owner enter another of their bots in place of the entered one, and withdraw it', async () => {
        let current = base;
        const calls = serve(() => current, ana, () => new Response(JSON.stringify({ key: 1, bot: `pebble`, ownerName: `ana`, online: true, ratingAtStart: null, state: `entered` })));
        render(<TournamentScreen id={base.id} />);
        expect(await screen.findByText(`hextide is entered.`)).toBeTruthy();
        const select = await screen.findByLabelText(`Your bot`);
        expect([...select.querySelectorAll(`option`)].map((option) => option.textContent)).toEqual([`pebble`]);
        current = { ...base, entries: [{ ...base.entries[0], bot: `pebble` } as TournamentDetail[`entries`][number], base.entries[1] as TournamentDetail[`entries`][number]] };
        fireEvent.click(screen.getByRole(`button`, { name: `Enter instead` }));
        await screen.findByText(`pebble is entered.`);
        expect(calls.find((call) => call.method === `PUT`)).toMatchObject({ url: `/api/tournaments/${base.id}/entry`, body: { bot: `pebble` } });
        fireEvent.click(screen.getByRole(`button`, { name: `Withdraw` }));
        await waitFor(() => {
            expect(calls.some((call) => call.method === `DELETE`)).toBe(true);
        });
    });

    it('say why an entry was refused', async () => {
        serve(
            () => ({ ...base, entries: [] }),
            ana,
            () => new Response(JSON.stringify({ error: `no`, code: `clock_not_accepted` }), { status: 400 }),
        );
        render(<TournamentScreen id={base.id} />);
        await screen.findByLabelText(`Your bot`);
        fireEvent.click(screen.getByRole(`button`, { name: `Enter` }));
        expect(await screen.findByText(`hextide does not accept this clock; change what it accepts first`)).toBeTruthy();
    });

    it('show a running tournament by its live round, standings, and crosstable, each played game linking to it', async () => {
        serve(() => running);
        render(<TournamentScreen id={running.id} />);
        expect(await screen.findByText(`Round 2 of 3 is live.`)).toBeTruthy();
        expect(screen.getByRole(`list`, { name: `Round progress` }).querySelectorAll(`li`)).toHaveLength(3);
        expect(screen.getByRole(`listitem`, { name: `Round 1, done` })).toBeTruthy();
        expect(screen.getByRole(`listitem`, { name: `Round 2, live` })).toBeTruthy();
        const standings = screen.getByRole(`heading`, { name: `Standings` }).closest(`section`) as HTMLElement;
        expect([...standings.querySelectorAll(`tbody tr`)].map((row) => [...row.querySelectorAll(`td`)].map((cell) => cell.textContent))).toEqual([
            [`1`, `alphaBOTby ann`, `1600`, `1`, `1, 0`],
            [`1`, `betaBOTby bob`, `1550`, `1`, `1, 0`],
            [`3`, `gammaBOTby cid`, `1500`, `0`, `0, 0`],
        ]);
        expect(within(standings).getAllByRole(`link`, { name: /^(ann|bob|cid)$/u }).map((link) => link.getAttribute(`href`))).toEqual([`/players/ann`, `/players/bob`, `/players/cid`]);
        expect(screen.getByRole(`link`, { name: `alpha as x against beta: won` }).getAttribute(`href`)).toBe(`/game/g_1`);
        expect(screen.getByRole(`link`, { name: `alpha as o against beta: lost` }).getAttribute(`href`)).toBe(`/game/g_2`);
        expect(screen.getByRole(`link`, { name: `gamma as x against alpha: live` }).getAttribute(`href`)).toBe(`/game/g_3`);
        expect(screen.getByRole(`img`, { name: `alpha as x against gamma: to play` })).toBeTruthy();
        expect(screen.getByText(`delta`).closest(`li`)?.textContent).toBe(`deltaBOTby deenot online at the start`);
    });

    it('offer the games over so far as one download once a game is over, and nothing to download before', async () => {
        serve(() => running);
        render(<TournamentScreen id={running.id} />);
        const exported = await screen.findByRole(`link`, { name: `Export games` });
        expect(exported.getAttribute(`href`)).toBe(`/api/tournaments/${running.id}/export`);
        expect(exported.hasAttribute(`download`)).toBe(true);
        cleanup();
        const begun = { ...running, rounds: running.rounds.map((round) => ({ ...round, pairings: round.pairings.map((pairing) => ({ ...pairing, games: pairing.games.map((entry) => ({ ...entry, outcome: `pending` as const, gameId: null })) })) })) };
        serve(() => begun);
        render(<TournamentScreen id={running.id} />);
        await screen.findByRole(`heading`, { level: 1, name: `Autumn round robin` });
        expect(screen.queryByRole(`link`, { name: `Export games` })).toBe(null);
    });

    it('stand a finished tournament\'s top three on the podium with their points', async () => {
        serve(() => finished);
        render(<TournamentScreen id={finished.id} />);
        expect(await screen.findByText(/^Finished /u)).toBeTruthy();
        // One board for a wide window, one for a phone.
        expect(screen.getAllByRole(`img`, { name: `Podium: first alpha, 3 points; second gamma, 2 points; third beta, 1 point` })).toHaveLength(2);
        expect(screen.getByText(`too few bot games left that day`)).toBeTruthy();
    });

    it('name a shared second on both plates it holds', async () => {
        const tied = { ...finished, standings: finished.standings.map((line) => (line.bot === `beta` ? { ...line, rank: 2, points: 2 } : line)) };
        serve(() => tied);
        render(<TournamentScreen id={tied.id} />);
        expect(await screen.findAllByRole(`img`, { name: `Podium: first alpha, 3 points; second gamma, 2 points; second beta, 2 points` })).toHaveLength(2);
        const podium = screen.getByRole(`region`, { name: `Podium` });
        expect(within(podium).getAllByText(`2`, { selector: `.podium-rank` })).toHaveLength(2);
    });

    it('say a called-off tournament could not start, with the counts', async () => {
        serve(() => ({ ...base, status: `called_off`, endedAt: base.startsAt, entries: [base.entries[0], { ...base.entries[1], state: `absent` }, { key: 3, bot: `tern`, ownerName: `fern`, online: true, ratingAtStart: null, state: `entered` }] as TournamentDetail[`entries`] }));
        render(<TournamentScreen id={base.id} />);
        expect(await screen.findByText(`Called off: 2 of 3 entered bots could play at the start; 3 are needed.`)).toBeTruthy();
        // Today's presence says nothing of a tournament that is over.
        expect(screen.getByRole(`heading`, { name: /^Entered/u }).closest(`section`)?.querySelectorAll(`.dot`)).toHaveLength(0);
    });

    it('list a bot withdrawn after it played under Withdrawn, apart from those that never played', async () => {
        const withdrawn = { ...running.entries[1], state: `withdrawn`, reason: `missed` } as TournamentDetail[`entries`][number];
        serve(() => ({ ...running, entries: [running.entries[0], withdrawn, running.entries[2], running.entries[3]] as TournamentDetail[`entries`] }));
        render(<TournamentScreen id={running.id} />);
        const withdrew = (await screen.findByRole(`heading`, { name: `Withdrawn` })).closest(`section`);
        expect(withdrew?.querySelector(`li`)?.textContent).toBe(`betaBOTby bobmissed two pairings in a row`);
        const never = screen.getByRole(`heading`, { name: `Did not play` }).closest(`section`);
        expect([...(never?.querySelectorAll(`li`) ?? [])].map((item) => item.textContent)).toEqual([`deltaBOTby deenot online at the start`]);
    });

    it('open a standings row on a phone to its bot\'s pairings, newest round first', async () => {
        serve(() => running);
        render(<TournamentScreen id={running.id} />);
        const open = await screen.findByRole(`button`, { name: `Pairings of alpha` });
        expect(open.getAttribute(`aria-expanded`)).toBe(`false`);
        fireEvent.click(open);
        expect(open.getAttribute(`aria-expanded`)).toBe(`true`);
        const list = document.getElementById(open.getAttribute(`aria-controls`) ?? ``);
        expect([...(list?.querySelectorAll(`li`) ?? [])].map((item) => item.querySelector(`.round-of`)?.textContent)).toEqual([`Round 2`, `Round 1`]);
        expect(within(list ?? document.body).getByRole(`link`, { name: `Game 1: alpha won` }).getAttribute(`href`)).toBe(`/game/g_1`);
        fireEvent.click(open);
        expect(open.getAttribute(`aria-expanded`)).toBe(`false`);
        expect(list?.isConnected).toBe(false);
    });

    it('leave a deleted owner\'s label as plain text, a name with no page to lead to', async () => {
        serve(() => ({ ...base, entries: [base.entries[0], { ...base.entries[1], ownerName: `deleted player` }] as TournamentDetail[`entries`] }));
        render(<TournamentScreen id={base.id} />);
        const entries = (await screen.findByRole(`heading`, { name: `Entered (2 of 12)` })).closest(`section`) as HTMLElement;
        expect(within(entries).getAllByRole(`listitem`).map((item) => item.textContent)).toEqual([`hextideBOTby ana`, `quietlakeBOTby deleted player`]);
        expect(within(entries).queryByRole(`link`, { name: `deleted player` })).toBe(null);
        expect(within(entries).getByText(`deleted player`).classList.contains(`deleted-name`)).toBe(true);
        expect(within(entries).getByRole(`link`, { name: `ana` })).toBeTruthy();
    });

    it('read every deleted bot by the plain label, set apart on the podium, in the standings, and on the round lines', async () => {
        const gone = new Set([key(`alpha`), key(`beta`)]);
        const label = (bot: TournamentBot): TournamentBot => (gone.has(bot.key) ? { ...bot, name: `deleted bot`, deleted: true } : bot);
        const deleted: TournamentDetail = {
            ...finished,
            entries: finished.entries.map((entry) => (gone.has(entry.key) ? { ...entry, bot: `deleted bot`, ownerName: `deleted player`, deleted: true } : entry)),
            rounds: finished.rounds.map((round) => ({
                ...round,
                pairings: round.pairings.map((pairing) => ({ ...pairing, first: label(pairing.first), second: label(pairing.second) })),
                rest: round.rest === null ? null : label(round.rest),
            })),
            standings: finished.standings.map((line) => (gone.has(line.key) ? { ...line, bot: `deleted bot`, ownerName: `deleted player`, deleted: true } : line)),
        };
        serve(() => deleted);
        render(<TournamentScreen id={deleted.id} />);
        expect(await screen.findAllByRole(`img`, { name: `Podium: first deleted bot, 3 points; second gamma, 2 points; third deleted bot, 1 point` })).toHaveLength(2);
        const podium = screen.getByRole(`region`, { name: `Podium` });
        expect(within(podium).getAllByText(`deleted bot`).map((name) => name.classList.contains(`deleted-name`))).toEqual([true, true]);
        const standings = screen.getByRole(`heading`, { name: `Standings` }).closest(`section`) as HTMLElement;
        expect([...standings.querySelectorAll(`tbody tr`)].map((row) => [...row.querySelectorAll(`td`)].map((cell) => cell.textContent))).toEqual([
            [`1`, `deleted botBOTby deleted player`, `1600`, `3`, `2, 1`],
            [`2`, `gammaBOTby cid`, `1500`, `2`, `1, 1`],
            [`3`, `deleted botBOTby deleted player`, `1550`, `1`, `1, 0`],
        ]);
        const rounds = screen.getByRole(`heading`, { name: `Rounds` }).closest(`section`) as HTMLElement;
        expect([...rounds.querySelectorAll(`.round-names`)].map((line) => line.textContent)).toEqual([`deleted bot vs gamma`, `gamma vs deleted bot`, `deleted bot vs deleted bot`]);
        expect([...rounds.querySelectorAll(`.round-rest`)].map((line) => line.textContent)).toEqual([`deleted bot rests`, `deleted bot rests`, `gamma rests`]);
        expect(rounds.querySelectorAll(`:is(.round-names, .round-rest) .deleted-name`)).toHaveLength(6);
    });

    it('say when no tournament has the id', async () => {
        serve(() => 404);
        render(<TournamentScreen id="t_aaaaaaaaaaaa" />);
        expect(await screen.findByRole(`heading`, { name: `No tournament here` })).toBeTruthy();
    });
});

describe('TournamentsScreen', () => {
    it('list the running tournament, those coming up, and the past ones with their winner', async () => {
        const summary = { id: base.id, name: `Autumn round robin`, status: `running` as const, startsAt: base.startsAt, timeControl: base.timeControl, openingPlies: 5 as const, entrants: 3, maxEntrants: 12, winner: null, round: null };
        const list: TournamentList = {
            running: { ...summary, round: { current: 2, of: 3 } },
            scheduled: [{ ...summary, id: `t_bcdefghijk23`, name: `Winter cup`, status: `scheduled`, entrants: 4 }],
            past: [{ ...summary, id: `t_cdefghijk234`, name: `Summer cup`, status: `finished`, winner: { name: `hextide`, ownerName: `ana` } }, { ...summary, id: `t_defghijk2345`, name: `Rain cup`, status: `called_off` }],
        };
        vi.stubGlobal(
            `fetch`,
            vi.fn(() => Promise.resolve(new Response(JSON.stringify(list)))),
        );
        render(<TournamentsScreen />);
        const sections = await screen.findAllByRole(`heading`, { level: 2 });
        expect(sections.map((heading) => heading.textContent)).toEqual([`Running now`, `Coming up`, `Past`]);
        expect(screen.getByRole(`link`, { name: `Autumn round robin` }).getAttribute(`href`)).toBe(`/tournaments/${base.id}`);
        expect(screen.getByText(/4 of 12 entered; turn clock 10 s$/u)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Autumn round robin` }).closest(`li`)?.querySelector(`.tournament-row-facts`)?.textContent).toBe(`Round 2 of 3; 3 bots; turn clock 10 s`);
        const won = screen.getByRole(`link`, { name: `Summer cup` }).closest(`li`)?.querySelector(`.tournament-row-facts`);
        expect(won?.textContent).toMatch(/; winner hextideBOT by ana$/u);
        expect(within(won as HTMLElement).getByRole(`link`, { name: `hextide` }).getAttribute(`href`)).toBe(`/bots/hextide`);
        // The owner takes the dim line's color, so the bot reads as the winner.
        expect(screen.getByRole(`link`, { name: `ana` }).closest(`.tournament-owner`)?.textContent).toBe(`by ana`);
        expect(screen.getByRole(`link`, { name: `ana` }).getAttribute(`href`)).toBe(`/players/ana`);
        expect(screen.getByText(/Called off$/u)).toBeTruthy();
    });
});

describe('the tournament views', () => {
    it('tell each round done, live, or to come, and the round under way', () => {
        expect(roundStates(running)).toEqual([
            { round: 1, state: `done` },
            { round: 2, state: `live` },
            { round: 3, state: `next` },
        ]);
        expect(currentRound(running)).toBe(2);
        expect(currentRound(finished)).toBeNull();
    });

    it('read two bots\' meeting from either side, and nothing on the diagonal', () => {
        expect(meeting(running, key(`beta`), key(`alpha`))).toEqual({ x: { state: `won`, gameId: `g_2` }, o: { state: `lost`, gameId: `g_1` } });
        expect(meeting(running, key(`alpha`), key(`gamma`))).toEqual({ x: { state: `pending`, gameId: null }, o: { state: `live`, gameId: `g_3` } });
        expect(meeting(running, key(`alpha`), key(`alpha`))).toBeNull();
    });

    it('dash a no-show in the absent bot\'s row alone, the scorer\'s cell won', () => {
        const noShow: TournamentDetail = {
            ...running,
            rounds: [{ round: 1, pairings: [{ first: seat(`alpha`), second: seat(`beta`), games: [game(`alpha`, `no_show`, `alpha`, null, [`beta`]), game(`beta`, `not_played`, null, null, [`alpha`, `beta`])] }], rest: null }],
        };
        expect(meeting(noShow, key(`alpha`), key(`beta`))).toEqual({ x: { state: `won`, gameId: null }, o: { state: `missing`, gameId: null } });
        expect(meeting(noShow, key(`beta`), key(`alpha`))).toEqual({ x: { state: `missing`, gameId: null }, o: { state: `missing`, gameId: null } });
    });

    it('spell a wait out in prose to the minute, then in days and hours past a day', () => {
        expect([30, 60, 2 * 60, 3_600, 3_600 + 60, 2 * 3_600 + 59 * 60, 86_400, 86_400 + 3_600 + 59 * 60, 47 * 3_600, 3 * 86_400].map(text.time.untilInProse)).toEqual([
            `under a minute`,
            `1 minute`,
            `2 minutes`,
            `1 hour`,
            `1 hour 1 minute`,
            `2 hours 59 minutes`,
            `1 day`,
            `1 day 1 hour`,
            `1 day 23 hours`,
            `3 days`,
        ]);
    });

    it('write a short wait in days and hours past a day', () => {
        expect([59 * 60, 3_600 + 60, 86_400, 47 * 3_600 + 59 * 60, 3 * 86_400 + 3_600].map(text.time.until)).toEqual([`59 min`, `1 h 1 min`, `1 day`, `1 day 23 h`, `3 days 1 h`]);
    });
});
