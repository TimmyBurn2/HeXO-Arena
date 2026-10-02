import { playerRecordSchema, ratingHistorySchema, type Side } from '@hexo-arena/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBot, findBot } from '../src/bots';
import { createQuery, type Query } from '../src/db';
import { insertBotGame, insertGame, recordFinish, type OpeningCell } from '../src/game-store';
import { deleteUser, voidGames } from '../src/moderation';
import { createUserWithExactName } from '../src/users';
import { createTestApp, roomyLimits, type TestApp } from './helpers';

const unlimited = { mode: `unlimited` as const };
const origin: OpeningCell[] = [{ x: 0, y: 0, player: 0 }];

describe('the player reads', () => {
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
            [`bob`, [`beta`]],
            [`cid`, [`gamma`]],
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

    const id = (name: string) => ids.get(name) ?? ``;

    function bots(challenger: string, dest: string, challengerSide: Side, winner: Side | null, reason: Parameters<typeof recordFinish>[2][`reason`] = `six-in-a-row`): string {
        const gameId = insertBotGame(query, { challengerBotId: id(challenger), destBotId: id(dest), challengerSide, timeControl: unlimited, opening: origin });
        recordFinish(query, gameId, { winner, reason });
        return gameId;
    }

    function human(user: string, bot: string, userSide: Side, winner: Side | null): string {
        const gameId = insertGame(query, { userId: id(user), botId: id(bot), userSide, timeControl: unlimited, opening: origin });
        recordFinish(query, gameId, { winner, reason: winner === null ? `aborted` : `six-in-a-row` });
        return gameId;
    }

    async function record(name: string) {
        const answer = await world.app.inject({ method: `GET`, url: `/api/players/${name}` });
        return { status: answer.statusCode, body: answer.statusCode === 200 ? playerRecordSchema.parse(answer.json()) : null };
    }

    async function history(name: string, range?: string) {
        const answer = await world.app.inject({ method: `GET`, url: `/api/players/${name}/rating${range === undefined ? `` : `?range=${range}`}` });
        return { status: answer.statusCode, body: answer.statusCode === 200 ? ratingHistorySchema.parse(answer.json()) : null };
    }

    it('counts a bot\'s games won, lost, and without a winner, by side, its forfeits, and its most played opponents, aborted games left out', async () => {
        bots(`alpha`, `beta`, `x`, `x`);
        bots(`beta`, `alpha`, `x`, `x`);
        bots(`alpha`, `gamma`, `o`, `o`, `timeout`);
        bots(`alpha`, `beta`, `x`, `o`, `disconnect`);
        bots(`gamma`, `alpha`, `o`, `o`, `terminated`);
        bots(`alpha`, `gamma`, `x`, null, `terminated`);
        bots(`alpha`, `beta`, `x`, null, `aborted`);
        human(`cid`, `alpha`, `x`, `o`);
        const { status, body } = await record(`Alpha`);
        expect(status).toBe(200);
        expect(body).toMatchObject({
            name: `alpha`,
            kind: `bot`,
            games: 7,
            won: 3,
            lost: 3,
            undecided: 1,
            asX: { games: 4, won: 1 },
            asO: { games: 3, won: 2 },
            forfeits: { disconnect: 1, terminated: 1 },
            rank: null,
            placings: [],
        });
        expect(body?.opponents).toEqual([
            { name: `beta`, kind: `bot`, games: 3, won: 1, lost: 2 },
            { name: `gamma`, kind: `bot`, games: 3, won: 1, lost: 1 },
            { name: `cid`, kind: `human`, games: 1, won: 1, lost: 0 },
        ]);
        expect(body?.firstGameAt).toMatch(/Z$/u);
    });

    it('leaves a voided game out of the record and the opponents met, as the rating leaves it', async () => {
        bots(`alpha`, `beta`, `x`, `x`);
        const voided = bots(`alpha`, `beta`, `x`, `x`);
        human(`cid`, `alpha`, `o`, `o`);
        expect(voidGames(query, [voided, `cid`])).toMatchObject({ kind: `voided`, count: 2 });
        const { body } = await record(`alpha`);
        expect(body).toMatchObject({ games: 1, won: 1, lost: 0, undecided: 0, asX: { games: 1, won: 1 }, asO: { games: 0, won: 0 } });
        expect(body?.opponents).toEqual([{ name: `beta`, kind: `bot`, games: 1, won: 1, lost: 0 }]);
        expect((await record(`cid`)).body).toMatchObject({ games: 0, won: 0, lost: 0, firstGameAt: null });
    });

    it('reads a human\'s record too, with no placings', async () => {
        human(`ann`, `beta`, `x`, `x`);
        const { body } = await record(`ann`);
        expect(body).toMatchObject({ name: `ann`, kind: `human`, games: 1, won: 1, asX: { games: 1, won: 1 } });
        expect(body).not.toHaveProperty(`placings`);
    });

    it('answers 404 for an unknown name and for a deleted player\'s placeholder', async () => {
        bots(`alpha`, `beta`, `x`, `x`);
        expect((await record(`nobody`)).status).toBe(404);
        deleteUser(query, id(`bob`));
        // The bot was made just above and a deletion renames it in place, so its one row answers.
        const placeholder = (world.sqlite.prepare(`select name from bots where id = ?`).get(id(`beta`)) as { name: string }).name;
        expect(placeholder).toMatch(/^deleted-/u);
        expect((await record(placeholder)).status).toBe(404);
        expect((await history(placeholder)).status).toBe(404);
    });

    it('charts the rating after each rated game, oldest first, within the range', async () => {
        const first = bots(`alpha`, `beta`, `x`, `x`);
        world.sqlite.prepare(`update games set finished_at = ? where id = ?`).run(clock / 1000 - 60 * 86_400, first);
        const second = bots(`alpha`, `beta`, `x`, `o`);
        bots(`alpha`, `beta`, `x`, null, `aborted`);
        const all = (await history(`alpha`, `all`)).body ?? [];
        expect(all.map((point) => point.gameId)).toEqual([first, second]);
        expect(all[0]?.rating).toBeGreaterThan(1500);
        expect(all[0]?.provisional).toBe(true);
        expect(all[1]?.rating).toBeLessThan(all[0]?.rating ?? 0);
        expect(((await history(`alpha`, `30d`)).body ?? []).map((point) => point.gameId)).toEqual([second]);
        expect(((await history(`alpha`)).body ?? []).map((point) => point.gameId)).toEqual([first, second]);
        expect((await history(`alpha`, `week`)).status).toBe(400);
    });
});
