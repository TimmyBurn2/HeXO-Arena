import { finishedGamesPageSchema, finishedGamesPath, type FinishedGamesPage, type Side } from '@hexo-arena/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBot, findBot } from '../src/bots';
import { createQuery, type Query } from '../src/db';
import { insertBotGame, insertGame, insertMove, recordFinish, type OpeningCell } from '../src/game-store';
import { deleteUser, voidGames } from '../src/moderation';
import { explainFinishedGames } from '../src/finished-games';
import { createUserWithExactName } from '../src/users';
import { createTestApp, roomyLimits, type TestApp } from './helpers';

const turnClock = { mode: `turn` as const, turnTimeMs: 20_000 };
const unlimited = { mode: `unlimited` as const };
const match = { mode: `match` as const, mainTimeMs: 180_000, incrementMs: 2_000 };

// An opening of `plies` stones from the origin outward along one row.
function opening(plies: number): OpeningCell[] {
    return Array.from({ length: plies }, (_, index) => ({ x: index * 3, y: 0, player: index === 0 || index % 4 === 3 || index % 4 === 0 ? 0 : 1 }));
}

describe('GET /api/games/finished', () => {
    let world: TestApp;
    let query: Query;
    let clock: number;
    const ids = new Map<string, string>();

    beforeEach(async () => {
        clock = Date.UTC(2026, 9, 1, 12);
        world = await createTestApp({ limits: roomyLimits, now: () => clock });
        query = createQuery(world.sqlite);
        for (const [owner, botNames] of [
            [`ann`, [`alpha`]],
            [`bob`, [`beta`, `gamma`]],
        ] as const) {
            const user = createUserWithExactName(query, `dev:${owner}`, owner);
            if (user === `name_taken`) throw new Error(`seed name taken`);
            ids.set(owner, user.id);
            for (const name of botNames) {
                if (createBot(query, user.id, name).kind !== `created`) throw new Error(`seed failed`);
                ids.set(name, findBot(query, name)?.id ?? ``);
            }
        }
    });

    afterEach(async () => {
        await world.app.close();
    });

    function id(name: string): string {
        const found = ids.get(name);
        if (found === undefined) throw new Error(`no seed named ${name}`);
        return found;
    }

    function human(user: string, bot: string, userSide: Side, timeControl: typeof turnClock | typeof unlimited | typeof match = turnClock, plies = 1): string {
        return insertGame(query, { userId: id(user), botId: id(bot), userSide, timeControl, opening: opening(plies) });
    }

    function bots(challenger: string, dest: string, challengerSide: Side, timeControl: typeof turnClock | typeof unlimited | typeof match = turnClock, plies = 1): string {
        return insertBotGame(query, { challengerBotId: id(challenger), destBotId: id(dest), challengerSide, timeControl, opening: opening(plies) });
    }

    function finish(gameId: string, winner: Side | null, reason: Parameters<typeof recordFinish>[2][`reason`] = `six-in-a-row`, finishedAt?: number): string {
        recordFinish(query, gameId, { winner, reason });
        if (finishedAt !== undefined) world.sqlite.prepare(`update games set finished_at = ? where id = ?`).run(finishedAt, gameId);
        return gameId;
    }

    async function read(search: string): Promise<{ status: number; body: unknown }> {
        const response = await world.app.inject({ method: `GET`, url: `${finishedGamesPath}${search}` });
        return { status: response.statusCode, body: response.json() };
    }

    async function page(search = ``): Promise<FinishedGamesPage> {
        const answer = await read(search);
        expect(answer.status).toBe(200);
        return finishedGamesPageSchema.parse(answer.body);
    }

    async function gameIds(search: string): Promise<string[]> {
        return (await page(search)).games.map((game) => game.gameId);
    }

    it('lists finished games newest first, twenty a page, the cursor leading on', async () => {
        const finished: string[] = [];
        for (let n = 0; n < 45; n++) finished.push(finish(bots(`alpha`, `beta`, n % 2 === 0 ? `x` : `o`), `x`));
        human(`ann`, `beta`, `x`);
        const newest = [...finished].reverse();
        const first = await page();
        expect(first.page).toBe(1);
        expect(first.games.map((game) => game.gameId)).toEqual(newest.slice(0, 20));
        expect(first.next).not.toBeNull();
        const second = await page(`?cursor=${first.next ?? ``}`);
        expect(second.page).toBe(2);
        expect(second.games.map((game) => game.gameId)).toEqual(newest.slice(20, 40));
        const third = await page(`?cursor=${second.next ?? ``}`);
        expect(third).toMatchObject({ page: 3, next: null });
        expect(third.games.map((game) => game.gameId)).toEqual(newest.slice(40));
    });

    it('leads back from any page to the one before, a linked page included', async () => {
        for (let n = 0; n < 85; n++) finish(n % 2 === 0 ? bots(`alpha`, `beta`, `x`) : human(`ann`, `alpha`, `o`), `x`);
        for (const filter of [``, `player=alpha&`]) {
            const read: FinishedGamesPage[] = [await page(`?${filter}`)];
            for (let next = read.at(-1)?.next ?? null; next !== null; next = read.at(-1)?.next ?? null) read.push(await page(`?${filter}cursor=${next}`));
            expect(read).toHaveLength(5);
            expect(read.slice(0, 2).map((answer) => answer.previous)).toEqual([null, null]);
            for (const [at, answer] of read.entries()) {
                if (at < 2) continue;
                const back = await page(`?${filter}cursor=${answer.previous ?? ``}`);
                expect(back.page).toBe(at);
                expect(back.games.map((game) => game.gameId)).toEqual(read[at - 1]?.games.map((game) => game.gameId));
            }
        }
    });

    it('stops at ten pages for one set of filters', async () => {
        for (let n = 0; n < 205; n++) finish(bots(`alpha`, `beta`, `x`), `o`);
        const read: FinishedGamesPage[] = [await page()];
        for (let next = read.at(-1)?.next ?? null; next !== null; next = read.at(-1)?.next ?? null) read.push(await page(`?cursor=${next}`));
        expect(read.map((answer) => answer.page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        expect(read.flatMap((answer) => answer.games)).toHaveLength(200);
        expect(read.every((answer) => answer.record === undefined)).toBe(true);
    });

    it('counts the record of the player named over every game past the cap, on every page', async () => {
        for (let n = 0; n < 205; n++) finish(bots(`alpha`, `beta`, n % 5 === 0 ? `x` : `o`), n % 3 === 0 ? null : `x`, n % 3 === 0 ? `aborted` : `six-in-a-row`);
        const first = await page(`?player=beta`);
        const tenth = await page(`?player=beta&cursor=10.20`);
        // alpha sits x in 41 games, so beta sits x in the other 164, winning those it does not lose.
        const record = { games: 205, won: 109, lost: 27, undecided: 69, asX: { games: 164, won: 109, lost: 0 }, asO: { games: 41, won: 0, lost: 27 } };
        expect(first.record).toEqual(record);
        expect(tenth.page).toBe(10);
        expect(tenth.record).toEqual(record);
    });

    it('says who sat where at the rating each stood at before, and how the game went', async () => {
        const first = finish(human(`ann`, `alpha`, `o`, match, 3), `o`, `surrender`, Date.UTC(2026, 8, 30, 8, 49, 13) / 1000);
        const second = human(`ann`, `alpha`, `x`, turnClock, 5);
        insertMove(query, { gameId: second, seq: 1, side: `o`, cells: [{ x: 1, y: 1 }, { x: 2, y: 2 }] });
        insertMove(query, { gameId: second, seq: 2, side: `x`, cells: [{ x: 1, y: 2 }, { x: 2, y: 3 }] });
        finish(second, `x`);
        const [later, earlier] = (await page()).games;
        expect(earlier).toEqual({
            gameId: first,
            players: {
                x: { name: `alpha`, kind: `bot`, rating: 1500, provisional: true },
                o: { name: `ann`, kind: `user`, rating: 1000, provisional: true },
            },
            winner: `o`,
            reason: `surrender`,
            timeControl: match,
            openingPlies: 3,
            turns: 1,
            finishedAt: `2026-09-30T08:49:13Z`,
            rated: true,
            voided: false,
        });
        expect(later).toMatchObject({ gameId: second, openingPlies: 5, turns: 4, timeControl: turnClock });
        expect(later?.players.x.rating).toBeGreaterThan(1000);
        expect(later?.players.o.rating).toBe(1500);
    });

    it('marks games without a winner and voided games unrated', async () => {
        const aborted = finish(human(`ann`, `alpha`, `x`), null, `aborted`);
        const voided = finish(bots(`alpha`, `beta`, `x`), `x`);
        expect(voidGames(query, [voided])).toMatchObject({ kind: `voided`, count: 1 });
        const kept = finish(bots(`alpha`, `gamma`, `x`), `x`);
        const rated = new Map((await page()).games.map((game) => [game.gameId, game.rated]));
        expect([rated.get(aborted), rated.get(voided), rated.get(kept)]).toEqual([false, false, true]);
    });

    it('lists a voided game marked voided and counts it in no record, head to head included', async () => {
        const voided = finish(bots(`alpha`, `beta`, `x`), `x`);
        finish(bots(`alpha`, `beta`, `o`), `o`);
        finish(bots(`beta`, `alpha`, `x`), `x`);
        expect(voidGames(query, [voided])).toMatchObject({ kind: `voided`, count: 1 });
        const listed = await page(`?player=alpha`);
        expect(listed.games.map((game) => [game.gameId === voided, game.voided])).toEqual([
            [false, false],
            [false, false],
            [true, true],
        ]);
        const record = { games: 2, won: 1, lost: 1, undecided: 0, asX: { games: 0, won: 0, lost: 0 }, asO: { games: 2, won: 1, lost: 1 } };
        expect(listed.record).toEqual(record);
        expect((await page(`?player=alpha&vs=beta`)).record).toEqual(record);
    });

    describe('filters', () => {
        let games: Record<string, string>;

        beforeEach(() => {
            games = {
                annWinsX: finish(human(`ann`, `alpha`, `x`, turnClock, 1), `x`, `six-in-a-row`, Date.UTC(2026, 8, 28, 10) / 1000),
                annLosesO: finish(human(`ann`, `beta`, `o`, unlimited, 3), `x`, `timeout`, Date.UTC(2026, 8, 29, 10) / 1000),
                bobAborted: finish(human(`bob`, `alpha`, `o`, match, 5), null, `aborted`, Date.UTC(2026, 8, 30, 10) / 1000),
                alphaBeatsBeta: finish(bots(`alpha`, `beta`, `o`, turnClock, 5), `o`, `six-in-a-row`, Date.UTC(2026, 8, 30, 23, 59, 59) / 1000),
                gammaBeatsAlpha: finish(bots(`gamma`, `alpha`, `x`, unlimited, 7), `x`, `disconnect`, Date.UTC(2026, 9, 1, 0) / 1000),
                betaTerminated: finish(bots(`beta`, `gamma`, `x`, match, 9), null, `terminated`, Date.UTC(2026, 9, 1, 1) / 1000),
            };
        });

        function named(...keys: string[]): string[] {
            return keys.map((key) => games[key] ?? ``);
        }

        it.each([
            [`?player=ann`, [`annLosesO`, `annWinsX`]],
            [`?player=ANN`, [`annLosesO`, `annWinsX`]],
            [`?player=alpha`, [`gammaBeatsAlpha`, `alphaBeatsBeta`, `bobAborted`, `annWinsX`]],
            [`?player=alpha&vs=gamma`, [`gammaBeatsAlpha`]],
            [`?player=alpha&vs=bob`, [`bobAborted`]],
            [`?player=ann&vs=alpha`, [`annWinsX`]],
            [`?player=ann&vs=bob`, []],
            [`?kind=bot-bot`, [`betaTerminated`, `gammaBeatsAlpha`, `alphaBeatsBeta`]],
            [`?kind=human-bot`, [`bobAborted`, `annLosesO`, `annWinsX`]],
            [`?player=alpha&result=won`, [`alphaBeatsBeta`]],
            [`?player=alpha&result=lost`, [`gammaBeatsAlpha`, `annWinsX`]],
            [`?player=ann&result=won`, [`annWinsX`]],
            [`?player=beta&result=lost`, [`alphaBeatsBeta`]],
            [`?player=beta&result=won`, [`annLosesO`]],
            [`?result=none`, [`betaTerminated`, `bobAborted`]],
            [`?player=alpha&side=x`, [`bobAborted`]],
            [`?player=alpha&side=o`, [`gammaBeatsAlpha`, `alphaBeatsBeta`, `annWinsX`]],
            [`?player=ann&side=o`, [`annLosesO`]],
            [`?reason=timeout`, [`annLosesO`]],
            [`?clock=match`, [`betaTerminated`, `bobAborted`]],
            [`?clock=unlimited&kind=bot-bot`, [`gammaBeatsAlpha`]],
            [`?opening=5`, [`alphaBeatsBeta`, `bobAborted`]],
            [`?before=2026-10-01`, [`alphaBeatsBeta`, `bobAborted`, `annLosesO`, `annWinsX`]],
            [`?before=2026-09-29&player=ann`, [`annWinsX`]],
            [`?player=alpha&vs=beta&kind=bot-bot&result=won&side=o&reason=six-in-a-row&clock=turn&opening=5&before=2026-10-01`, [`alphaBeatsBeta`]],
        ])('%s', async (search, expected) => {
            expect(await gameIds(search)).toEqual(named(...expected));
        });

        it.each([
            [`?vs=alpha`],
            [`?result=won`],
            [`?side=x`],
            [`?player=alpha&vs=Alpha`],
            [`?opening=4`],
            [`?before=2026-02-30`],
            [`?cursor=11.4`],
            [`?analysed=1`],
            [`?player=ann&player=bob`],
        ])('refuses %s as a bad request', async (search) => {
            expect(await read(search)).toMatchObject({ status: 400, body: { code: `bad_request` } });
        });

        it.each([
            [`?player=alpha`, { games: 4, won: 1, lost: 2, undecided: 1, asX: { games: 1, won: 0, lost: 0 }, asO: { games: 3, won: 1, lost: 2 } }],
            [`?player=alpha&vs=gamma`, { games: 1, won: 0, lost: 1, undecided: 0, asX: { games: 0, won: 0, lost: 0 }, asO: { games: 1, won: 0, lost: 1 } }],
            [`?player=alpha&result=won`, { games: 1, won: 1, lost: 0, undecided: 0, asX: { games: 0, won: 0, lost: 0 }, asO: { games: 1, won: 1, lost: 0 } }],
            [`?player=ann&vs=bob`, { games: 0, won: 0, lost: 0, undecided: 0, asX: { games: 0, won: 0, lost: 0 }, asO: { games: 0, won: 0, lost: 0 } }],
            [`?player=alpha&before=2026-01-01`, { games: 0, won: 0, lost: 0, undecided: 0, asX: { games: 0, won: 0, lost: 0 }, asO: { games: 0, won: 0, lost: 0 } }],
        ])('counts the record for %s', async (search, record) => {
            expect((await page(search)).record).toEqual(record);
        });

        it('counts no record when no player is named', async () => {
            expect(await page(`?kind=bot-bot`)).not.toHaveProperty(`record`);
        });

        it.each([[`?player=nobody`], [`?player=ann&vs=nobody`], [`?player=not%20a%20name`]])('answers %s with not_found', async (search) => {
            expect(await read(search)).toMatchObject({ status: 404, body: { code: `not_found` } });
        });

        it('takes a deleted player\'s placeholder for an unknown name, and lists the games under it', async () => {
            deleteUser(query, id(`ann`));
            const listed = (await page()).games.find((game) => game.gameId === games.annWinsX);
            expect(listed?.players.x.name).toMatch(/^deleted-[0-9]+$/);
            expect(await read(`?player=${listed?.players.x.name ?? ``}`)).toMatchObject({ status: 404, body: { code: `not_found` } });
        });
    });

    it('answers an identical query from memory for five seconds', async () => {
        finish(bots(`alpha`, `beta`, `x`), `x`);
        const first = await page(`?player=alpha`);
        finish(bots(`alpha`, `gamma`, `x`), `x`);
        clock += 4_999;
        expect(await page(`?player=alpha`)).toEqual(first);
        expect((await page(`?player=Alpha`)).games).toHaveLength(1);
        expect((await page(`?player=beta`)).games).toHaveLength(1);
        clock += 1;
        expect((await page(`?player=alpha`)).games).toHaveLength(2);
    });

    it.each([
        [{}, [`games_finish_seq_idx`]],
        [{ cursor: `2.40` }, [`games_finish_seq_idx`]],
        [{ cursor: `5.40`, player: `alpha` }, [`games_bot_finish_idx`, `games_challenger_finish_idx`, `games_dest_finish_idx`]],
        [{ player: `ann` }, [`games_user_finish_idx`]],
        [{ player: `alpha` }, [`games_bot_finish_idx`, `games_challenger_finish_idx`, `games_dest_finish_idx`]],
        [{ player: `alpha`, vs: `beta` }, [`games_dest_finish_idx`]],
        [{ kind: `bot-bot` }, [`games_bots_finish_idx`]],
        [{ kind: `human-bot` }, [`games_human_finish_idx`]],
        [{ result: `none` }, [`games_undecided_finish_idx`]],
        [{ reason: `timeout` }, [`games_reason_finish_idx`]],
        [{ clock: `match` }, [`games_clock_finish_idx`]],
        [{ opening: `5` }, [`games_opening_finish_idx`]],
        [{ before: `2026-10-01` }, [`games_finished_at_idx`, `games_finish_seq_idx`]],
    ] as const)('reads %j through its index, sorting no more than a page per seat and nothing for the record', (filters, indexes) => {
        const plan = explainFinishedGames(query, filters);
        expect(plan.filter((line) => /(?:SCAN|SEARCH) games\b/u.test(line) && !line.includes(`USING`))).toEqual([]);
        // The seats' arms merge in finish order: each sorts the page or less its index read.
        for (const [at, line] of plan.entries()) {
            if (line.includes(`TEMP B-TREE`)) expect(plan[at - 1]).toMatch(/^SCAN \(subquery-\d+\)$/u);
        }
        for (const index of indexes) expect(plan.join(`\n`)).toContain(index);
    });
});
