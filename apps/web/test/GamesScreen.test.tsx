// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FinishedGameEntry, FinishedGamesPage, GamePlayer, TournamentDetail, TournamentList, TournamentSummary } from '@hexo-arena/contract';
import { navigate } from '../src/router/use-route';
import { GamesScreen } from '../src/screens/GamesScreen';

const hextide: GamePlayer = { name: `hextide`, rating: 1712, provisional: false, kind: `bot` };
const quietlake: GamePlayer = { name: `quietlake`, rating: 1690, provisional: true, kind: `bot` };

function game(index: number, overrides: Partial<FinishedGameEntry> = {}): FinishedGameEntry {
    return {
        gameId: `g-${String(index)}`,
        players: { x: hextide, o: quietlake },
        winner: `x`,
        reason: `six-in-a-row`,
        timeControl: { mode: `turn`, turnTimeMs: 10_000 },
        openingPlies: 5,
        turns: 38,
        finishedAt: new Date(Date.now() - 3 * 3_600_000 - index * 60_000).toISOString(),
        rated: true,
        voided: false,
        analyses: 0,
        ...overrides,
    };
}

const record = { games: 41, won: 24, lost: 15, undecided: 2, voided: 0, asX: { games: 21, won: 14, lost: 6 }, asO: { games: 20, won: 10, lost: 9 } };

type Answer = FinishedGamesPage | number;

// Each finished-games read answers by its query string; the live list is empty.
function serve(answer: (search: string) => Answer): ReturnType<typeof vi.fn> {
    const fetch = vi.fn((url: string) => {
        const [path = ``, search = ``] = url.split(`?`);
        if (path !== `/api/games/finished`) return Promise.resolve(new Response(`[]`));
        const reply = answer(search);
        if (typeof reply === `number`) return Promise.resolve(new Response(JSON.stringify({ error: `no`, code: `not_found` }), { status: reply }));
        return Promise.resolve(new Response(JSON.stringify(reply)));
    });
    vi.stubGlobal(`fetch`, fetch);
    return fetch;
}

// A finished duel between two bots, as the tournaments list holds it: by its pair, a test when one person owns both.
function duelOf(id: string, first: string, second: string, test = false, status: TournamentSummary[`status`] = `finished`): TournamentSummary {
    return {
        id,
        name: `Duel by bruno`,
        origin: `person`,
        format: `duel`,
        createdBy: `bruno`,
        rated: false,
        test,
        gamesPerPair: 2,
        status,
        startsAt: `2026-10-01T12:00:00Z`,
        ...(status === `running` ? {} : { endedAt: `2026-10-01T12:20:00Z` }),
        timeControl: { mode: `turn`, turnTimeMs: 10_000 },
        openingPlies: 5,
        maxEntrants: 2,
        entrants: 2,
        winner: null,
        round: status === `running` ? { current: 1, of: 1 } : null,
        pair: {
            first: { key: 1, name: first, points: 2 },
            second: { key: 2, name: second, points: 0 },
            games: [
                { x: 1, gameId: `g-1`, outcome: `played`, point: 1, missing: [] },
                { x: 2, gameId: `g-2`, outcome: `played`, point: 1, missing: [] },
            ],
        },
    };
}

const autumn: TournamentDetail = {
    id: `t_autumnrobin1`,
    name: `Autumn round robin`,
    origin: `operator`,
    format: `round_robin`,
    createdBy: null,
    rated: true,
    test: false,
    gamesPerPair: 2,
    status: `finished`,
    startsAt: `2026-10-01T18:00:00Z`,
    startedAt: `2026-10-01T18:00:00Z`,
    waiting: [],
    nextRoundAt: null,
    endedAt: `2026-10-01T19:00:00Z`,
    timeControl: { mode: `turn`, turnTimeMs: 10_000 },
    openingPlies: 5,
    maxEntrants: 12,
    entries: [],
    rounds: [1, 2, 3].map((round) => ({ round, pairings: [], rest: null })),
    standings: [],
    live: [],
};

// The finished games by query, and the tournaments a picker lists, by their paths.
function serveEvents(events: Record<string, unknown>): ReturnType<typeof vi.fn> {
    const fetch = vi.fn((url: string) => {
        if (url.startsWith(`/api/games/finished`)) return Promise.resolve(new Response(JSON.stringify({ games: [game(0)], page: 1, pages: 1, total: 1 })));
        const body = events[url];
        return Promise.resolve(body === undefined ? new Response(JSON.stringify({ error: `no`, code: `not_found` }), { status: 404 }) : new Response(JSON.stringify(body)));
    });
    vi.stubGlobal(`fetch`, fetch);
    return fetch;
}

function open(path: string): void {
    window.history.replaceState(null, ``, path);
    render(<GamesScreen />);
}

// The filters past Player live in the panel the Filters button opens.
function openFilters(): HTMLElement {
    fireEvent.click(screen.getByRole(`button`, { name: /^Filters/u }));
    return screen.getByRole(`dialog`, { name: `Filters` });
}

function reads(fetch: ReturnType<typeof vi.fn>): string[] {
    return fetch.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith(`/api/games/finished`));
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState(null, ``, `/`);
    window.localStorage.clear();
});

describe('GamesScreen', () => {
    it('list the newest games: both seats at their rating before, the result in words, the clock, opening, length, and when', async () => {
        serve(() => ({ games: [game(0), game(1, { winner: null, reason: `aborted`, openingPlies: 1, turns: 1, timeControl: { mode: `unlimited` } })], page: 1, pages: 1, total: 2 }));
        open(`/games`);
        const rows = await screen.findAllByRole(`link`, { name: /hextide/u });
        expect(rows.map((row) => row.getAttribute(`href`))).toEqual([`/game/g-0`, `/game/g-1`]);
        const [won, aborted] = rows as [HTMLElement, HTMLElement];
        expect(won.textContent).toBe(`hextideBOT1712vsquietlakeBOT1690?hextide won with six in a rowturn clock 10 s5 stones38 turns3 h ago`);
        expect(aborted.textContent).toContain(`No winner; the game was aborted`);
        expect(aborted.textContent).toContain(`unlimitedOrigin only1 turn`);
        expect(screen.getByText(`Newest first; a guest's games show under the guest's label, unrated. Tests show while Show tests is on.`)).toBeTruthy();
        expect(screen.getByText(`2 games`)).toBeTruthy();
    });

    it('keep a voided game in the list, tagged voided beside its result', async () => {
        serve(() => ({ games: [game(0, { voided: true, rated: false }), game(1)], page: 1, pages: 1, total: 2 }));
        open(`/games`);
        const rows = await screen.findAllByRole(`link`, { name: /hextide/u });
        const [voided, kept] = rows as [HTMLElement, HTMLElement];
        expect(voided.querySelector(`.game-row-result`)?.textContent).toBe(`hextide won with six in a rowvoided`);
        expect(voided.querySelector(`.game-row-result .tag`)?.textContent).toBe(`voided`);
        expect(kept.querySelector(`.tag`)).toBe(null);
    });

    it('name a deleted seat by its label, set apart, the row still leading to the game', async () => {
        const gone: GamePlayer = { name: `deleted player`, rating: 1400, provisional: false, kind: `user`, deleted: true };
        serve(() => ({ games: [game(0, { players: { x: hextide, o: gone } })], page: 1, pages: 1, total: 1 }));
        open(`/games`);
        const [row] = await screen.findAllByRole(`link`, { name: /deleted player/u });
        expect(row?.getAttribute(`href`)).toBe(`/game/g-0`);
        expect(row?.querySelector(`.deleted-name`)?.textContent).toBe(`deleted player`);
    });

    it('list a guest\'s game under its label, tagged unrated, and offer Guest vs bot under Who played', async () => {
        const guest: GamePlayer = { name: `Guest k3f9`, rating: null, provisional: false, kind: `guest` };
        const fetch = serve(() => ({ games: [game(0, { players: { x: hextide, o: guest }, rated: false })], page: 1, pages: 1, total: 1 }));
        open(`/games`);
        const [row] = await screen.findAllByRole(`link`, { name: /Guest k3f9/u });
        expect(row?.querySelector(`.tag`)?.textContent).toBe(`unrated`);
        const panel = openFilters();
        const kind = within(panel).getByLabelText<HTMLSelectElement>(`Who played`);
        expect([...kind.options].map((option) => option.textContent)).toEqual([`Any`, `Bot vs bot`, `Human vs bot`, `Guest vs bot`]);
        fireEvent.change(kind, { target: { value: `guest-bot` } });
        await waitFor(() => {
            expect(reads(fetch).at(-1)).toBe(`/api/games/finished?kind=guest-bot`);
        });
        expect(within(screen.getByRole(`group`, { name: `Active filters` })).getAllByRole(`button`)[0]?.getAttribute(`aria-label`)).toBe(`Remove guest vs bot`);
    });

    it('name a game\'s tournament, a duel\'s among them, on a line of its own under the row, a link to its page beside the game\'s', async () => {
        serve(() => ({
            games: [
                game(0, { tournament: { id: `t_autumnrobin1`, name: `Autumn round robin`, format: `round_robin`, round: 2, game: 1, of: 2 } }),
                game(1, { tournament: { id: `d_abcdefabcdef`, name: `Duel by bruno`, format: `duel`, round: 1, game: 3, of: 10, createdBy: `bruno` }, rated: false, unratedByChoice: true }),
                game(2, { tournament: { id: `t_testtesttest`, name: `Duel by quinn`, format: `duel`, round: 1, game: 22, of: 50, createdBy: `quinn` }, rated: false, unratedByChoice: true, test: true }),
                game(3),
            ],
            page: 1,
            pages: 1,
            total: 4,
        }));
        open(`/games`);
        const rows = await screen.findAllByRole(`link`, { name: /hextide/u });
        expect(rows.map((row) => row.getAttribute(`href`))).toEqual([`/game/g-0`, `/game/g-1`, `/game/g-2`, `/game/g-3`]);
        // The row keeps unseen room for its caption, out of what a reader hears of the row.
        const room = rows[0]?.querySelector(`.game-row-event-space`);
        expect([room?.getAttribute(`aria-hidden`), room?.textContent]).toEqual([`true`, `Autumn round robin, round 2, game 1 of 2`]);
        expect(screen.getByRole(`link`, { name: `Autumn round robin, round 2, game 1 of 2` }).getAttribute(`href`)).toBe(`/tournaments/t_autumnrobin1`);
        expect(screen.getByRole(`link`, { name: `Duel, game 3 of 10` }).getAttribute(`href`)).toBe(`/tournaments/d_abcdefabcdef`);
        expect(screen.getByRole(`link`, { name: `Test, game 22 of 50` }).getAttribute(`href`)).toBe(`/tournaments/t_testtesttest`);
        const items = [...document.querySelectorAll(`.game-rows > li:not(.game-rows-head)`)];
        expect(items.map((item) => item.classList.contains(`game-row-evented`))).toEqual([true, true, true, false]);
        expect(items.every((item) => item.querySelectorAll(`a a`).length === 0)).toBe(true);
    });

    it('narrow the list to a tournament\'s games or those of none under Played in, its chip naming it', async () => {
        const fetch = serve(() => ({ games: [game(0)], page: 1, pages: 1, total: 1 }));
        open(`/games`);
        await screen.findAllByRole(`link`, { name: /hextide/u });
        const panel = openFilters();
        const event = within(panel).getByLabelText<HTMLSelectElement>(`Played in`);
        expect([...event.options].map((option) => option.textContent)).toEqual([`Any`, `A tournament`, `None`]);
        fireEvent.change(event, { target: { value: `tournament` } });
        expect(window.location.search).toBe(`?event=tournament`);
        await waitFor(() => {
            expect(reads(fetch).at(-1)).toBe(`/api/games/finished?event=tournament`);
        });
        expect(within(screen.getByRole(`group`, { name: `Active filters` })).getAllByRole(`button`)[0]?.getAttribute(`aria-label`)).toBe(`Remove in a tournament`);
    });

    it('pick one duel among the tournaments by its pair, found by a bot\'s name, each dated or live, its chip naming it and clearing back to every tournament', async () => {
        const one = duelOf(`d_sealhextide1`, `sealbot`, `hextide`);
        const test = duelOf(`d_sealmarsh001`, `sealbot`, `marsh`, true);
        const running = duelOf(`d_ternmarsh001`, `tern`, `marsh`, false, `running`);
        const when = new Intl.DateTimeFormat(undefined, { dateStyle: `medium`, timeStyle: `short` }).format(new Date(`2026-10-01T12:20:00Z`));
        const detail: TournamentDetail = { ...autumn, id: one.id, name: one.name, origin: `person`, format: `duel`, createdBy: `bruno`, rated: false, maxEntrants: 2, entries: [
            { key: 1, bot: `sealbot`, ownerName: `quinn`, online: true, ratingAtStart: 1500, state: `playing` },
            { key: 2, bot: `hextide`, ownerName: `ana`, online: true, ratingAtStart: 1500, state: `playing` },
        ], rounds: [{ round: 1, pairings: [], rest: null }] };
        const fetch = serveEvents({ '/api/tournaments': { running: [running], scheduled: [], past: [one, test, duelOf(`d_otherother01`, `pebble`, `cinder`)] }, [`/api/tournaments/${one.id}`]: detail });
        open(`/games?event=tournament`);
        await screen.findAllByRole(`link`, { name: /hextide/u });
        const panel = openFilters();
        const pick = await within(panel).findByLabelText<HTMLSelectElement>(`Tournament`);
        await waitFor(() => {
            expect([...pick.options].map((option) => option.textContent)).toEqual([`Any`, `Duel tern vs marsh, live`, `Duel sealbot vs hextide, ${when}`, `Duel pebble vs cinder, ${when}`]);
        });
        fireEvent.change(within(panel).getByLabelText(`Find a tournament: name or bot`), { target: { value: `sealbot` } });
        fireEvent.keyDown(within(panel).getByLabelText(`Find a tournament: name or bot`), { key: `Enter` });
        await waitFor(() => {
            expect([...pick.options].map((option) => option.textContent)).toEqual([`Any`, `Duel sealbot vs hextide, ${when}`]);
        });
        fireEvent.change(pick, { target: { value: one.id } });
        expect(window.location.search).toBe(`?event=tournament&tournament=d_sealhextide1`);
        await waitFor(() => {
            expect(reads(fetch).at(-1)).toBe(`/api/games/finished?event=tournament&tournament=d_sealhextide1`);
        });
        const chips = screen.getByRole(`group`, { name: `Active filters` });
        await waitFor(() => {
            expect(within(chips).getAllByRole(`button`).map((chip) => chip.getAttribute(`aria-label`) ?? chip.textContent)).toEqual([`Remove duel sealbot vs hextide`, `Clear filters`]);
        });
        expect(screen.getByRole(`button`, { name: `Filters (1)` })).toBeTruthy();
        expect(within(screen.getByRole(`dialog`, { name: `Filters` })).queryByLabelText(`Round`)).toBe(null);
        fireEvent.click(within(chips).getByRole(`button`, { name: `Remove duel sealbot vs hextide` }));
        expect(window.location.search).toBe(`?event=tournament`);
        expect(within(screen.getByRole(`group`, { name: `Active filters` })).getAllByRole(`button`)[0]?.getAttribute(`aria-label`)).toBe(`Remove in a tournament`);
    });

    it('read an older link to a duel\'s games as the games of the tournament that duel is', async () => {
        const fetch = serveEvents({ '/api/tournaments': { running: [], scheduled: [], past: [] } });
        open(`/games?event=duel&duel=d_sealhextide1&clock=turn`);
        await screen.findAllByRole(`link`, { name: /hextide/u });
        expect(window.location.search).toBe(`?clock=turn&event=tournament&tournament=d_sealhextide1`);
        expect(reads(fetch)).toContain(`/api/games/finished?clock=turn&event=tournament&tournament=d_sealhextide1`);
    });

    it('tell repeats of a tournament apart by the date and time the tournaments list gives them, the live one said live', async () => {
        const summary = (id: string, status: TournamentSummary[`status`], endedAt?: string): TournamentSummary => ({
            id,
            name: `Dev round robin`,
            origin: `person`,
            format: `round_robin`,
            createdBy: `devowner-a`,
            rated: false,
            test: false,
            gamesPerPair: 2,
            status,
            startsAt: `2026-10-03T09:00:00Z`,
            ...(endedAt === undefined ? {} : { endedAt }),
            timeControl: { mode: `turn`, turnTimeMs: 10_000 },
            openingPlies: 5,
            maxEntrants: 3,
            entrants: 3,
            winner: null,
            round: status === `running` ? { current: 1, of: 3 } : null,
        });
        const list: TournamentList = { running: [summary(`t_devrobin0001`, `running`)], scheduled: [], past: [summary(`t_devrobin0002`, `finished`, `2026-10-03T10:15:00Z`), summary(`t_devrobin0003`, `finished`, `2026-10-03T14:40:00Z`)] };
        serveEvents({ '/api/tournaments': list });
        open(`/games?event=tournament`);
        await screen.findAllByRole(`link`, { name: /hextide/u });
        const panel = openFilters();
        const pick = await within(panel).findByLabelText<HTMLSelectElement>(`Tournament`);
        const when = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: `medium`, timeStyle: `short` }).format(new Date(iso));
        await waitFor(() => {
            expect([...pick.options].map((option) => option.textContent)).toEqual([`Any`, `Dev round robin, live`, `Dev round robin, ${when(`2026-10-03T10:15:00Z`)}`, `Dev round robin, ${when(`2026-10-03T14:40:00Z`)}`]);
        });
    });

    it('offer a test among the tournaments to pick only while Show tests is on', async () => {
        const summary = (id: string, test: boolean): TournamentSummary => ({
            id,
            name: test ? `Round robin by ana` : `Round robin by bruno`,
            origin: `person`,
            format: `round_robin`,
            createdBy: test ? `ana` : `bruno`,
            rated: false,
            test,
            gamesPerPair: 2,
            status: `finished`,
            startsAt: `2026-10-03T09:00:00Z`,
            endedAt: `2026-10-03T10:15:00Z`,
            timeControl: { mode: `turn`, turnTimeMs: 10_000 },
            openingPlies: 5,
            maxEntrants: 3,
            entrants: 3,
            winner: null,
            round: null,
        });
        serveEvents({ '/api/tournaments': { running: [], scheduled: [], past: [summary(`t_brunorobin02`, false), summary(`t_anatest00001`, true)] } });
        open(`/games?event=tournament`);
        await screen.findAllByRole(`link`, { name: /hextide/u });
        const panel = openFilters();
        const pick = await within(panel).findByLabelText<HTMLSelectElement>(`Tournament`);
        const names = () => [...pick.options].map((option) => option.textContent.split(`,`)[0]);
        await waitFor(() => {
            expect(names()).toEqual([`Any`, `Round robin by bruno`]);
        });
        fireEvent.click(screen.getByRole(`switch`, { name: `Show tests` }));
        await waitFor(() => {
            expect(names()).toEqual([`Any`, `Round robin by bruno`, `Round robin by ana`]);
        });
    });

    it('take one tournament and its round from a link, a round picked among those drawn, and the chip clearing the round with the tournament', async () => {
        const list: TournamentList = { running: [], scheduled: [], past: [] };
        const fetch = serveEvents({ '/api/tournaments': list, [`/api/tournaments/${autumn.id}`]: autumn });
        open(`/games?tournament=t_autumnrobin1&round=2`);
        await screen.findAllByRole(`link`, { name: /hextide/u });
        expect(window.location.search).toBe(`?event=tournament&tournament=t_autumnrobin1&round=2`);
        expect(reads(fetch)).toContain(`/api/games/finished?event=tournament&tournament=t_autumnrobin1&round=2`);
        const chips = screen.getByRole(`group`, { name: `Active filters` });
        await waitFor(() => {
            expect(within(chips).getAllByRole(`button`).map((chip) => chip.getAttribute(`aria-label`) ?? chip.textContent)).toEqual([`Remove Autumn round robin`, `Remove round 2`, `Clear filters`]);
        });
        const panel = openFilters();
        const round = await within(panel).findByLabelText<HTMLSelectElement>(`Round`);
        expect([...round.options].map((option) => option.textContent)).toEqual([`Any`, `Round 1`, `Round 2`, `Round 3`]);
        expect(within(panel).getByLabelText<HTMLSelectElement>(`Tournament`).value).toBe(`t_autumnrobin1`);
        fireEvent.change(round, { target: { value: `3` } });
        expect(window.location.search).toBe(`?event=tournament&tournament=t_autumnrobin1&round=3`);
        fireEvent.click(within(screen.getByRole(`group`, { name: `Active filters` })).getByRole(`button`, { name: `Remove Autumn round robin` }));
        expect(window.location.search).toBe(`?event=tournament`);
    });

    it('tag a game its player started unrated, aborted or decided, and leave a rated one untagged', async () => {
        const quinn: GamePlayer = { name: `quinn`, rating: null, provisional: false, kind: `user` };
        const chosen = { players: { x: hextide, o: quinn }, rated: false, unratedByChoice: true } as const;
        serve(() => ({
            games: [game(0, chosen), game(1, { ...chosen, winner: null, reason: `aborted` }), game(2, { players: { x: hextide, o: { ...quinn, rating: 1503 } } })],
            page: 1,
            pages: 1,
            total: 3,
        }));
        open(`/games`);
        const rows = await screen.findAllByRole(`link`, { name: /quinn/u });
        expect(rows.map((row) => row.querySelector(`.tag`)?.textContent ?? null)).toEqual([`unrated`, `unrated`, null]);
    });

    it('hold Player beside one Filters button, Against and Side waiting in its panel for a player and Result offering No winner alone', async () => {
        const fetch = serve(() => ({ games: [game(0)], page: 1, pages: 1, total: 1 }));
        open(`/games`);
        await screen.findAllByRole(`link`, { name: /hextide/u });
        expect(screen.getByRole(`search`).querySelectorAll(`input, select`)).toHaveLength(1);
        expect(screen.queryByLabelText(`Against`)).toBe(null);
        const panel = openFilters();
        expect(within(panel).getByText(`Against, Side, Won, and Lost wait for a name in Player.`)).toBeTruthy();
        expect([...panel.querySelectorAll(`label`)].map((label) => label.textContent)).toEqual([`Against`, `Result`, `Side`, `Ending`, `Clock`, `Opening`, `Who played`, `Played in`, `Analysis`, `Before`]);
        expect(within(panel).getByLabelText(`Opening`).getAttribute(`aria-describedby`)).toBe(`games-opening-note`);
        expect(document.getElementById(`games-opening-note`)?.textContent).toBe(`Opening counts the stones on the board before the first turn, the origin and random ones near it.`);
        for (const name of [`Against`, `Side`]) expect(within(panel).getByLabelText<HTMLInputElement>(name).disabled).toBe(true);
        const result = within(panel).getByLabelText<HTMLSelectElement>(`Result`);
        expect(result.disabled).toBe(false);
        expect([...result.options].map((option) => option.textContent)).toEqual([`Any`, `No winner`]);
        const player = screen.getByLabelText(`Player`);
        fireEvent.change(player, { target: { value: `hextide` } });
        expect(window.location.search).toBe(``);
        fireEvent.keyDown(player, { key: `Enter` });
        expect(window.location.search).toBe(`?player=hextide`);
        await waitFor(() => {
            expect(within(panel).getByLabelText<HTMLSelectElement>(`Side`).disabled).toBe(false);
        });
        expect(within(panel).queryByText(`Against, Side, Won, and Lost wait for a name in Player.`)).toBe(null);
        expect([...within(panel).getByLabelText<HTMLSelectElement>(`Result`).options].map((option) => option.textContent)).toEqual([`Any`, `Won`, `Lost`, `No winner`]);
        fireEvent.change(within(panel).getByLabelText(`Clock`), { target: { value: `turn` } });
        fireEvent.change(within(panel).getByLabelText(`Side`), { target: { value: `o` } });
        expect(window.location.search).toBe(`?player=hextide&side=o&clock=turn`);
        await waitFor(() => {
            expect(reads(fetch).at(-1)).toBe(`/api/games/finished?player=hextide&side=o&clock=turn`);
        });
        expect(screen.getByRole(`button`, { name: `Filters (2)` }).getAttribute(`aria-expanded`)).toBe(`true`);
        const chips = screen.getByRole(`group`, { name: `Active filters` });
        expect(within(chips).getAllByRole(`button`).map((chip) => chip.getAttribute(`aria-label`) ?? chip.textContent)).toEqual([
            `Remove hextide`,
            `Remove as o`,
            `Remove turn clock`,
            `Clear filters`,
        ]);
        fireEvent.click(within(panel).getByRole(`button`, { name: `Show games` }));
        expect(screen.queryByRole(`dialog`, { name: `Filters` })).toBe(null);
    });

    it('filter games without a winner with no player named', async () => {
        serve(() => ({ games: [game(0, { winner: null, reason: `aborted` })], page: 1, pages: 1, total: 1 }));
        open(`/games`);
        await screen.findAllByRole(`link`, { name: /hextide/u });
        fireEvent.change(within(openFilters()).getByLabelText(`Result`), { target: { value: `none` } });
        expect(window.location.search).toBe(`?result=none`);
        expect(screen.getByRole(`button`, { name: `Filters (1)` })).toBeTruthy();
    });

    it('take a chip away with whatever needed it, and clear every filter at once', async () => {
        serve(() => ({ games: [game(0)], page: 1, pages: 1, total: 1 }));
        open(`/games?player=hextide&vs=quietlake&side=x&clock=match`);
        await screen.findAllByRole(`link`, { name: /hextide/u });
        fireEvent.click(screen.getByRole(`button`, { name: `Remove hextide` }));
        expect(window.location.search).toBe(`?clock=match`);
        await waitFor(() => {
            expect(document.activeElement?.getAttribute(`aria-label`)).toBe(`Remove match clock`);
        });
        fireEvent.click(screen.getByRole(`button`, { name: `Clear filters` }));
        expect(window.location.pathname + window.location.search).toBe(`/games`);
        expect(screen.queryByRole(`group`, { name: `Active filters` })).toBe(null);
    });

    it('head two players\' meetings with three figures and the split by side', async () => {
        serve(() => ({ games: [game(0)], page: 1, pages: 1, total: 41, record }));
        open(`/games?player=HexTide&vs=quietlake`);
        const head = await screen.findByRole(`heading`, { level: 2, name: /against/u });
        expect(head.textContent).toBe(`hextideBOT against quietlakeBOT`);
        const section = head.closest(`section`) as HTMLElement;
        expect([...section.querySelectorAll(`li`)].map((item) => item.textContent)).toEqual([`24hextide won`, `15quietlake won`, `2No winner`]);
        expect(within(section).getByText(`41 games; hextide won 14 and lost 6 as x, and won 10 and lost 9 as o.`)).toBeTruthy();
    });

    it('say under two players\' meetings how many voided games their figures leave out', async () => {
        serve(() => ({ games: [game(0)], page: 1, pages: 1, total: 43, record: { ...record, voided: 2 } }));
        open(`/games?player=hextide&vs=quietlake`);
        const head = await screen.findByRole(`heading`, { level: 2, name: /against/u });
        const section = head.closest(`section`) as HTMLElement;
        expect(section.querySelector(`.games-h2h-split`)?.textContent).toBe(`41 games; hextide won 14 and lost 6 as x, and won 10 and lost 9 as o. 2 voided games are left out.`);
    });

    it('name the one of two names no player holds', async () => {
        const fetch = serve((search) => (search === `player=hextide` ? { games: [game(0)], page: 1, pages: 1, total: 1 } : 404));
        open(`/games?player=hextide&vs=nobody`);
        expect(await screen.findByRole(`heading`, { name: `No player named nobody` })).toBeTruthy();
        expect(reads(fetch)).toEqual([`/api/games/finished?player=hextide&vs=nobody`, `/api/games/finished?player=hextide`]);
        expect(screen.getByRole(`link`, { name: `All games of hextide` }).getAttribute(`href`)).toBe(`/games?player=hextide`);
    });

    it('clear every filter when the first of two names is the unknown one', async () => {
        serve(() => 404);
        open(`/games?player=nobody&vs=hextide&reason=timeout`);
        expect(await screen.findByRole(`heading`, { name: `No player named nobody` })).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Clear filters` }).getAttribute(`href`)).toBe(`/games`);
    });

    it('greet day one with the way to a live game and to a bot of your own', async () => {
        serve(() => ({ games: [], page: 1, pages: 0, total: 0 }));
        open(`/games`);
        expect(await screen.findByRole(`heading`, { name: `No finished games yet` })).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Watch a live game` }).getAttribute(`href`)).toBe(`/games/live`);
        expect(screen.getByRole(`link`, { name: `Build a bot` }).getAttribute(`href`)).toBe(`/connect`);
    });

    it('name the filters nothing matches, and offer to clear them', async () => {
        serve(() => ({ games: [], page: 1, pages: 0, total: 0, record: { ...record, games: 0, won: 0, lost: 0, undecided: 0 } }));
        open(`/games?player=hextide&reason=timeout&opening=1`);
        expect(await screen.findByRole(`heading`, { name: `No games match these filters` })).toBeTruthy();
        expect(screen.getByText(`No finished game matches hextide, on time, origin only.`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Clear filters` })).toBeTruthy();
    });

    it('say where the page stands, link every page between Previous and Next, and take the keyboard to the page turned to', async () => {
        serve((search) => {
            const page = Number(new URLSearchParams(search).get(`page`) ?? `1`);
            return { games: [game(page * 20)], page, pages: 7, total: 134 };
        });
        open(`/games?page=3`);
        await screen.findByText(`Page 3 of 7; 134 games`);
        const nav = screen.getByRole(`navigation`, { name: `Pages` });
        expect(within(nav).getAllByRole(`link`).map((link) => link.textContent)).toEqual([`Previous`, `1`, `2`, `3`, `4`, `5`, `6`, `7`, `Next`]);
        expect(within(nav).getByRole(`link`, { name: `Page 3` }).getAttribute(`aria-current`)).toBe(`page`);
        expect(within(nav).getByRole(`link`, { name: `Next` }).getAttribute(`href`)).toBe(`/games?page=4`);
        fireEvent.click(within(nav).getByRole(`link`, { name: `Page 5` }));
        expect(window.location.search).toBe(`?page=5`);
        await screen.findByText(`Page 5 of 7; 134 games`);
        await waitFor(() => {
            expect(document.activeElement).toBe(screen.getByRole(`list`, { name: `Games, page 5` }));
        });
        fireEvent.click(within(screen.getByRole(`navigation`, { name: `Pages` })).getByRole(`link`, { name: `Page 1` }));
        expect(window.location.pathname + window.location.search).toBe(`/games`);
        await screen.findByText(`Page 1 of 7; 134 games`);
        const first = screen.getByRole(`navigation`, { name: `Pages` });
        expect(within(first).queryByRole(`link`, { name: `Previous` })).toBe(null);
        expect(within(first).getByText(`Previous`).getAttribute(`aria-disabled`)).toBe(`true`);
    });

    it('end at the last page, Next standing without a link, and take a page past it there', async () => {
        serve((search) => {
            const page = Number(new URLSearchParams(search).get(`page`) ?? `1`);
            return { games: page > 3 ? [] : [game(page * 20)], page, pages: 3, total: 55 };
        });
        open(`/games?clock=turn&page=9`);
        await screen.findByText(`Page 3 of 3; 55 games`);
        expect(window.location.search).toBe(`?clock=turn&page=3`);
        expect(within(screen.getByRole(`navigation`, { name: `Pages` })).queryByRole(`link`, { name: `Next` })).toBe(null);
    });

    it('say past 200 games that an earlier date reaches older ones, and open Before in Filters', async () => {
        serve(() => ({ games: Array.from({ length: 20 }, (_, index) => game(index)), page: 10, pages: 10, total: 1234 }));
        open(`/games?player=hextide&page=10`);
        expect(await screen.findByText(`Showing the newest 200 of 1,234; pick an earlier date in Filters for older games.`)).toBeTruthy();
        expect(screen.getByText(`Page 10 of 10; 1,234 games`)).toBeTruthy();
        expect(screen.queryByLabelText(`Before`)).toBe(null);
        fireEvent.click(screen.getByRole(`button`, { name: `Pick a date` }));
        await waitFor(() => {
            expect(document.activeElement).toBe(screen.getByLabelText(`Before`));
        });
        expect(screen.getByRole(`button`, { name: /^Filters/u }).getAttribute(`aria-expanded`)).toBe(`true`);
        fireEvent.change(screen.getByLabelText(`Before`), { target: { value: `2026-09-01` } });
        expect(window.location.search).toBe(`?player=hextide&before=2026-09-01`);
    });

    it('tidy an address the list cannot take, in place', async () => {
        serve(() => ({ games: [game(0)], page: 1, pages: 1, total: 1 }));
        open(`/games?vs=quietlake&clock=blitz&reason=timeout`);
        await screen.findAllByRole(`link`, { name: /hextide/u });
        expect(window.location.search).toBe(`?reason=timeout`);
    });

    it('offer a retry when the games do not load', async () => {
        serve(() => 500);
        open(`/games`);
        expect(await screen.findByRole(`heading`, { name: `The games did not load` })).toBeTruthy();
        expect(screen.getByRole(`button`, { name: `Try again` })).toBeTruthy();
    });

    it('follow the address when Back returns to an earlier filter', async () => {
        const fetch = serve(() => ({ games: [game(0)], page: 1, pages: 1, total: 1 }));
        open(`/games`);
        await screen.findAllByRole(`link`, { name: /hextide/u });
        const panel = openFilters();
        act(() => {
            navigate(`/games?clock=unlimited`);
        });
        expect(within(panel).getByLabelText<HTMLSelectElement>(`Clock`).value).toBe(`unlimited`);
        await waitFor(() => {
            expect(reads(fetch).at(-1)).toBe(`/api/games/finished?clock=unlimited`);
        });
    });
});
