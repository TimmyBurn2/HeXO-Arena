// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TournamentDetail, TournamentGame, TournamentList } from '@hexo-arena/contract';
import { meStore } from '../src/me';
import { TournamentScreen } from '../src/screens/TournamentScreen';
import { TournamentsScreen } from '../src/screens/TournamentsScreen';
import { text } from '../src/text';
import { currentRound, meeting, roundStates } from '../src/tournaments/view';

const hour = 3_600_000;

function game(x: string, outcome: TournamentGame[`outcome`], point: string | null = null, gameId: string | null = null, missing: string[] = []): TournamentGame {
    return { x, gameId, outcome, point, missing };
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
        { bot: `hextide`, ownerName: `ana`, online: true, ratingAtStart: null, state: `entered` },
        { bot: `quietlake`, ownerName: `dmitri`, online: false, ratingAtStart: null, state: `entered` },
    ],
    rounds: [],
    standings: [],
    live: [],
};

const playing = (bot: string, owner: string, rating: number) => ({ bot, ownerName: owner, online: true, ratingAtStart: rating, state: `playing` as const });

const running: TournamentDetail = {
    ...base,
    status: `running`,
    startedAt: `2026-10-01T18:00:00Z`,
    entries: [playing(`alpha`, `ann`, 1600), playing(`beta`, `bob`, 1550), playing(`gamma`, `cid`, 1500), { bot: `delta`, ownerName: `dee`, online: false, ratingAtStart: null, state: `absent` }],
    rounds: [
        { round: 1, pairings: [{ first: `alpha`, second: `beta`, games: [game(`alpha`, `played`, `alpha`, `g_1`), game(`beta`, `played`, `beta`, `g_2`)] }], rest: `gamma` },
        { round: 2, pairings: [{ first: `gamma`, second: `alpha`, games: [game(`gamma`, `live`, null, `g_3`), game(`alpha`, `pending`)] }], rest: `beta` },
        { round: 3, pairings: [{ first: `beta`, second: `gamma`, games: [game(`beta`, `pending`), game(`gamma`, `pending`)] }], rest: `alpha` },
    ],
    standings: [
        { rank: 1, bot: `alpha`, ownerName: `ann`, points: 1, asX: 1, asO: 0, withdrawn: false },
        { rank: 1, bot: `beta`, ownerName: `bob`, points: 1, asX: 1, asO: 0, withdrawn: false },
        { rank: 3, bot: `gamma`, ownerName: `cid`, points: 0, asX: 0, asO: 0, withdrawn: false },
    ],
};

const finished: TournamentDetail = {
    ...running,
    status: `finished`,
    endedAt: `2026-10-01T19:00:00Z`,
    entries: [...running.entries.slice(0, 3), { bot: `delta`, ownerName: `dee`, online: false, ratingAtStart: null, state: `left_out`, reason: `daily_cap` }],
    rounds: running.rounds.map((round) => ({
        ...round,
        pairings: round.pairings.map((pairing) => ({ ...pairing, games: pairing.games.map((entry, index) => ({ ...entry, outcome: `played` as const, gameId: entry.gameId ?? `g_${String(round.round)}${String(index)}`, point: entry.point ?? pairing.first })) })),
    })),
    standings: [
        { rank: 1, bot: `alpha`, ownerName: `ann`, points: 3, asX: 2, asO: 1, withdrawn: false },
        { rank: 2, bot: `gamma`, ownerName: `cid`, points: 2, asX: 1, asO: 1, withdrawn: false },
        { rank: 3, bot: `beta`, ownerName: `bob`, points: 1, asX: 1, asO: 0, withdrawn: false },
    ],
};

const ana = { kind: `user`, name: `ana`, rating: 1503, provisional: false, discord: null, liveGames: [] };
const anaBots = [
    { name: `hextide`, ownerName: `ana`, online: true, openForChallenges: true, rating: 1690, provisional: false, liveGames: 0 },
    { name: `pebble`, ownerName: `ana`, online: true, openForChallenges: true, rating: 1400, provisional: true, liveGames: 0 },
    { name: `quietlake`, ownerName: `dmitri`, online: false, openForChallenges: false, rating: 1123, provisional: true, liveGames: 0 },
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
        const entries = screen.getByRole(`heading`, { name: `Entered (2 of 12)` }).closest(`section`) as HTMLElement;
        expect(within(entries).getAllByRole(`listitem`).map((item) => item.textContent)).toEqual([`hextideBOTby ana`, `quietlakeBOTby dmitri`]);
        expect(within(entries).getByRole(`link`, { name: `ana` }).getAttribute(`href`)).toBe(`/players/ana`);
        expect(entries.querySelectorAll(`.dot`)).toHaveLength(2);
        expect(await screen.findByText(`Sign in to enter a bot.`)).toBeTruthy();
    });

    it('let an owner enter another of their bots in place of the entered one, and withdraw it', async () => {
        let current = base;
        const calls = serve(() => current, ana, () => new Response(JSON.stringify({ bot: `pebble`, ownerName: `ana`, online: true, ratingAtStart: null, state: `entered` })));
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
        serve(() => ({ ...base, status: `called_off`, endedAt: base.startsAt, entries: [base.entries[0], { ...base.entries[1], state: `absent` }, { bot: `tern`, ownerName: `fern`, online: true, ratingAtStart: null, state: `entered` }] as TournamentDetail[`entries`] }));
        render(<TournamentScreen id={base.id} />);
        expect(await screen.findByText(`Called off: 2 of 3 entered bots could play at the start; 3 are needed.`)).toBeTruthy();
        // Today's presence says nothing of a tournament that is over.
        expect(screen.getByRole(`heading`, { name: /^Entered/u }).closest(`section`)?.querySelectorAll(`.dot`)).toHaveLength(0);
    });

    it('list a bot withdrawn after it played under Withdrew, apart from those that never played', async () => {
        const withdrawn = { ...running.entries[1], state: `withdrawn`, reason: `missed` } as TournamentDetail[`entries`][number];
        serve(() => ({ ...running, entries: [running.entries[0], withdrawn, running.entries[2], running.entries[3]] as TournamentDetail[`entries`] }));
        render(<TournamentScreen id={running.id} />);
        const withdrew = (await screen.findByRole(`heading`, { name: `Withdrew` })).closest(`section`);
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

    it('leave a deleted owner\'s placeholder as plain text, a name with no page to lead to', async () => {
        serve(() => ({ ...base, entries: [base.entries[0], { ...base.entries[1], ownerName: `deleted-7` }] as TournamentDetail[`entries`] }));
        render(<TournamentScreen id={base.id} />);
        const entries = (await screen.findByRole(`heading`, { name: `Entered (2 of 12)` })).closest(`section`) as HTMLElement;
        expect(within(entries).getAllByRole(`listitem`).map((item) => item.textContent)).toEqual([`hextideBOTby ana`, `quietlakeBOTby deleted-7`]);
        expect(within(entries).queryByRole(`link`, { name: `deleted-7` })).toBe(null);
        expect(within(entries).getByRole(`link`, { name: `ana` })).toBeTruthy();
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
        const won = screen.getByRole(`link`, { name: `ana` }).parentElement;
        expect(won?.textContent).toMatch(/hextide by ana won$/u);
        expect(within(won ?? document.body).getByRole(`link`, { name: `hextide` }).getAttribute(`href`)).toBe(`/bots/hextide`);
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
        expect(meeting(running, `beta`, `alpha`)).toEqual({ x: { state: `won`, gameId: `g_2` }, o: { state: `lost`, gameId: `g_1` } });
        expect(meeting(running, `alpha`, `gamma`)).toEqual({ x: { state: `pending`, gameId: null }, o: { state: `live`, gameId: `g_3` } });
        expect(meeting(running, `alpha`, `alpha`)).toBeNull();
    });

    it('dash a no-show in the absent bot\'s row alone, the scorer\'s cell won', () => {
        const noShow: TournamentDetail = {
            ...running,
            rounds: [{ round: 1, pairings: [{ first: `alpha`, second: `beta`, games: [game(`alpha`, `no_show`, `alpha`, null, [`beta`]), game(`beta`, `not_played`, null, null, [`alpha`, `beta`])] }], rest: null }],
        };
        expect(meeting(noShow, `alpha`, `beta`)).toEqual({ x: { state: `won`, gameId: null }, o: { state: `missing`, gameId: null } });
        expect(meeting(noShow, `beta`, `alpha`)).toEqual({ x: { state: `missing`, gameId: null }, o: { state: `missing`, gameId: null } });
    });

    it('spell a wait out in prose to the minute, hours and days in words', () => {
        expect([30, 60, 2 * 60, 3_600, 3_600 + 60, 2 * 3_600 + 59 * 60, 86_400, 3 * 86_400].map(text.time.untilInProse)).toEqual([
            `under a minute`,
            `1 minute`,
            `2 minutes`,
            `1 hour`,
            `1 hour 1 minute`,
            `2 hours 59 minutes`,
            `1 day`,
            `3 days`,
        ]);
    });
});
