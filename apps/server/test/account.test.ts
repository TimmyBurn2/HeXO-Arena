import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountExportLimit, accountExportSchema, guestPath, meExportPath, mePath, meSchema } from '@hexo-arena/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findBot } from '../src/bots';
import { createQuery } from '../src/db';
import { insertBotGame, insertMove, recordFinish } from '../src/game-store';
import { createTestApp, FakeStreamSocket, loginAs, mintBot, signUpWithDiscord, type TestApp } from './helpers';

const accepts = { turnMs: [5_000, 600_000], match: true, unlimited: true };

describe('the account routes', () => {
    let world: TestApp;
    let dir: string;
    let journal: string;

    beforeEach(async () => {
        dir = mkdtempSync(join(tmpdir(), `hexo-arena-account-`));
        journal = join(dir, `erasures.jsonl`);
        world = await createTestApp({ logger: false, erasures: { path: journal, keepDays: 15 } });
    });

    afterEach(async () => {
        await world.app.close();
        rmSync(dir, { recursive: true, force: true });
    });

    const cookie = (session: string) => ({ cookies: { hexo_arena_session: session } });

    async function online(token: string, name: string): Promise<FakeStreamSocket> {
        await world.app.inject({ method: `PATCH`, url: `/api/bot/account`, headers: { authorization: `Bearer ${token}` }, payload: { accepts } });
        const stream = new FakeStreamSocket();
        world.presence.attach(findBot(createQuery(world.sqlite), name)?.id ?? ``, stream, true);
        return stream;
    }

    async function guest(): Promise<string> {
        const minted = await world.app.inject({ method: `POST`, url: guestPath });
        return minted.cookies.find((entry) => entry.name === `hexo_arena_session`)?.value ?? ``;
    }

    function erase(session: string | null, name?: string) {
        return world.app.inject({ method: `DELETE`, url: mePath, ...(session === null ? {} : cookie(session)), ...(name === undefined ? {} : { payload: { name } }) });
    }

    describe('DELETE /api/me', () => {
        it('refuses a signed-out caller and a guest with 401, deleting nothing', async () => {
            expect((await erase(null, `ann`)).statusCode).toBe(401);
            expect((await erase(await guest(), `ann`)).json()).toMatchObject({ code: `unauthorized` });
        });

        it('refuses a name that is not the account\'s, its case included, and a missing body', async () => {
            const ann = await loginAs(world.app, `ann`);
            expect((await erase(ann, `bob`)).json()).toMatchObject({ code: `name_mismatch` });
            expect((await erase(ann, `Ann`)).json()).toMatchObject({ code: `name_mismatch` });
            expect((await erase(ann)).json()).toMatchObject({ code: `bad_request` });
            expect(world.sqlite.prepare(`select count(*) as n from users where name = 'ann'`).get()).toEqual({ n: 1 });
        });

        it('refuses with 409 in_live_game while the person sits in a live game', async () => {
            await online(await mintBot(world.app, await loginAs(world.app, `bob`), `beta`), `beta`);
            const ann = await loginAs(world.app, `ann`);
            const created = await world.app.inject({ method: `POST`, url: `/api/games`, ...cookie(ann), payload: { bot: `beta`, timeControl: { mode: `unlimited` } } });
            expect(created.statusCode).toBe(201);
            const refused = await erase(ann, `ann`);
            expect(refused.statusCode).toBe(409);
            expect(refused.json()).toMatchObject({ code: `in_live_game` });
        });

        it('deletes the account as the operator would, audited as self, journaled, every session ended and the cookie cleared', async () => {
            const ann = await loginAs(world.app, `ann`);
            const other = await loginAs(world.app, `ann`);
            const stream = await online(await mintBot(world.app, ann, `alpha`), `alpha`);
            const bob = await loginAs(world.app, `bob`);
            const watched = await world.app.inject({ method: `POST`, url: `/api/games`, ...cookie(bob), payload: { bot: `alpha`, timeControl: { mode: `unlimited` } } });
            expect(watched.statusCode).toBe(201);
            const userId = (world.sqlite.prepare(`select id from users where name = 'ann'`).get() as { id: string }).id;

            const deleted = await erase(ann, `ann`);
            expect(deleted.statusCode).toBe(204);
            const cleared = deleted.cookies.find((entry) => entry.name === `hexo_arena_session`);
            expect(cleared?.value).toBe(``);
            for (const session of [ann, other]) {
                expect(meSchema.parse((await world.app.inject({ method: `GET`, url: mePath, ...cookie(session) })).json())).toBeNull();
            }
            expect(stream.ended).toBe(true);
            expect((await world.app.inject({ method: `GET`, url: mePath, ...cookie(bob) })).json()).toMatchObject({ liveGames: [] });
            // The bot had no game with a winner, so it went outright, its aborted game with it.
            expect((await world.app.inject({ method: `GET`, url: `/api/games/${watched.json<{ gameId: string }>().gameId}` })).statusCode).toBe(404);
            expect(world.sqlite.prepare(`select actor, action, target, reason from admin_actions`).all()).toEqual([
                { actor: `self`, action: `delete-user`, target: `deleted-1`, reason: `deleted their own account` },
            ]);
            expect(readFileSync(journal, `utf8`)).toContain(`"userId":"${userId}"`);
            expect((await loginAs(world.app, `ann`)).length).toBeGreaterThan(0);
        });
    });

    describe('GET /api/me/export', () => {
        it('refuses a signed-out caller and a guest with 401', async () => {
            expect((await world.app.inject({ method: `GET`, url: meExportPath })).statusCode).toBe(401);
            expect((await world.app.inject({ method: `GET`, url: meExportPath, ...cookie(await guest()) })).statusCode).toBe(401);
        });

        it('hands over every row tied to the account as an attachment, and never a token, its hash, or a sign-in state', async () => {
            const ann = await signUpWithDiscord(world.app, `ann`);
            const token = await mintBot(world.app, ann, `alpha`);
            await world.app.inject({ method: `PATCH`, url: `/api/bot/account`, headers: { authorization: `Bearer ${token}` }, payload: { accepts, about: `plays fast` } });
            const betaToken = await mintBot(world.app, await loginAs(world.app, `bob`), `beta`);
            const query = createQuery(world.sqlite);
            const alpha = findBot(query, `alpha`)?.id ?? ``;
            const beta = findBot(query, `beta`)?.id ?? ``;
            const gameId = insertBotGame(query, { challengerBotId: alpha, destBotId: beta, challengerSide: `x`, timeControl: { mode: `unlimited` }, opening: [{ x: 0, y: 0, player: 0 }] });
            insertMove(query, { gameId, seq: 1, side: `o`, cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }] });
            recordFinish(query, gameId, { winner: `o`, reason: `surrender` });
            world.admin({ op: `delist-bot`, name: `alpha`, reason: `name` });
            world.admin({ op: `delist-bot`, name: `beta`, reason: `someone else` });

            const answer = await world.app.inject({ method: `GET`, url: meExportPath, ...cookie(ann) });
            expect(answer.statusCode).toBe(200);
            expect(answer.headers[`content-disposition`]).toMatch(/^attachment; filename="hexo-arena-ann-\d{4}-\d{2}-\d{2}\.json"$/u);
            expect(answer.headers[`cache-control`]).toBe(`no-store`);
            const data = accountExportSchema.parse(answer.json());
            expect(data.account).toMatchObject({ name: `ann`, discordId: `1`, bannedAt: null });
            expect(data.sessions).toEqual([expect.objectContaining({ discordUsername: `tester` })]);
            expect(data.bots).toEqual([expect.objectContaining({ name: `alpha`, about: `plays fast`, accepts, delistedAt: expect.any(String) as string })]);
            expect(data.games).toEqual([
                expect.objectContaining({
                    id: gameId,
                    players: { x: { name: `alpha`, kind: `bot`, yours: true }, o: { name: `beta`, kind: `bot`, yours: false } },
                    moves: [{ side: `o`, cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }], at: expect.any(String) as string }],
                    winner: `o`,
                    reason: `surrender`,
                }),
            ]);
            expect(data.games[0]?.ratings.map((rating) => rating.side)).toEqual([`o`, `x`]);
            expect(data.moderation).toEqual([{ action: `delist-bot`, target: `alpha`, reason: `name`, at: expect.any(String) as string }]);
            const tokenHashes = world.sqlite.prepare(`select token_hash as hash from sessions union all select token_hash from bots`).all() as { hash: string }[];
            for (const secret of [ann, token, betaToken, ...tokenHashes.map((row) => row.hash)]) expect(answer.body).not.toContain(secret);
            expect(answer.body).not.toMatch(/token|nonce/iu);
        });

        it(`gives one account ${String(accountExportLimit.burst)} downloads at once`, async () => {
            const ann = await loginAs(world.app, `ann`);
            for (let n = 0; n < accountExportLimit.burst; n += 1) expect((await world.app.inject({ method: `GET`, url: meExportPath, ...cookie(ann) })).statusCode).toBe(200);
            const refused = await world.app.inject({ method: `GET`, url: meExportPath, ...cookie(ann) });
            expect(refused.statusCode).toBe(429);
            expect(refused.json()).toMatchObject({ code: `rate_limited` });
            expect((await world.app.inject({ method: `GET`, url: meExportPath, ...cookie(await loginAs(world.app, `bob`)) })).statusCode).toBe(200);
        });
    });
});
