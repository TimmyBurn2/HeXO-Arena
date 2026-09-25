import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, FakeStreamSocket, loginAs, mintBot, type TestApp } from './helpers';
import { findBot } from '../src/bots';
import { createQuery } from '../src/db';
import { drainGraceMs } from '../src/drain';
import { orphanForfeitMs } from '../src/game-registry';
import { readRating } from '../src/rating-store';

interface World {
    app: TestApp;
    token: string;
    botId: string;
    stream: FakeStreamSocket;
    player: string;
}

// One bot online for every clock and one logged-in human, the smallest
// cast that can hold a live game.
async function world(): Promise<World> {
    const app = await createTestApp({ logger: false });
    const token = await mintBot(app.app, await loginAs(app.app, `owner`), `drainbot`);
    await app.app.inject({
        method: `PATCH`,
        url: `/api/bot/account`,
        headers: { authorization: `Bearer ${token}` },
        payload: { accepts: { turnMs: null, match: false, unlimited: true } },
    });
    const bot = findBot(createQuery(app.sqlite), `drainbot`);
    if (bot === undefined) throw new Error(`no bot`);
    const stream = new FakeStreamSocket();
    app.presence.attach(bot.id, stream, true);
    return { app, token, botId: bot.id, stream, player: await loginAs(app.app, `player`) };
}

async function startGame(w: World): Promise<string> {
    const created = await w.app.app.inject({
        method: `POST`,
        url: `/api/games`,
        cookies: { hexarena_session: w.player },
        payload: { bot: `drainbot`, timeControl: { mode: `unlimited` } },
    });
    if (created.statusCode !== 201) throw new Error(`game creation failed: ${created.body}`);
    return created.json<{ gameId: string }>().gameId;
}

async function gameState(w: World, gameId: string): Promise<{ status: string; winner?: unknown; reason?: string }> {
    const response = await w.app.app.inject({
        method: `GET`,
        url: `/api/games/${gameId}`,
        cookies: { hexarena_session: w.player },
    });
    return response.json();
}

function finishes(stream: FakeStreamSocket): unknown[] {
    return stream.writes
        .filter((line) => line.trim() !== ``)
        .map((line) => JSON.parse(line) as { type: string })
        .filter((event) => event.type === `gameFinish`);
}

describe('deploy drain', () => {
    let w: World;

    beforeEach(async () => {
        vi.useFakeTimers({ toFake: [`setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `Date`] });
        w = await world();
    });

    afterEach(async () => {
        w.app.presence.close(w.botId);
        await w.app.app.close();
        vi.useRealTimers();
    });

    it('refuses stream opens, game and challenge creation, and acceptance with the paused 503', async () => {
        const draining = w.app.drain(drainGraceMs);
        const bearer = { authorization: `Bearer ${w.token}` };
        const refused = [
            await w.app.app.inject({ method: `GET`, url: `/api/bot/stream`, headers: bearer }),
            await w.app.app.inject({
                method: `POST`,
                url: `/api/games`,
                cookies: { hexarena_session: w.player },
                payload: { bot: `drainbot`, timeControl: { mode: `unlimited` } },
            }),
            await w.app.app.inject({
                method: `POST`,
                url: `/api/bot/challenge/otherbot`,
                headers: bearer,
                payload: { timeControl: { mode: `unlimited` }, requestId: `r1` },
            }),
            await w.app.app.inject({ method: `POST`, url: `/api/bot/challenge/c_1/accept`, headers: bearer }),
        ];
        for (const response of refused) {
            expect(response.statusCode).toBe(503);
            expect(response.headers[`retry-after`]).toBe(`60`);
            expect(response.json()).toMatchObject({ code: `paused` });
        }
        expect((await w.app.app.inject({ method: `GET`, url: `/healthz` })).statusCode).toBe(503);
        expect(await draining).toBe(0);
    });

    it('lets a live game end on its own inside the grace and returns early', async () => {
        const gameId = await startGame(w);
        let aborted: number | null = null;
        void w.app.drain(drainGraceMs).then((count) => {
            aborted = count;
        });
        expect(w.stream.ended).toBe(false);
        const resigned = await w.app.app.inject({
            method: `POST`,
            url: `/api/games/${gameId}/resign`,
            cookies: { hexarena_session: w.player },
        });
        expect(resigned.json()).toMatchObject({ status: `finished`, reason: `surrender` });
        await vi.advanceTimersByTimeAsync(1_000);
        expect(aborted).toBe(0);
    });

    it('aborts what outlasts the grace, unrated, and tells the bot', async () => {
        const gameId = await startGame(w);
        const query = createQuery(w.app.sqlite);
        const before = readRating(query, { kind: `bot`, id: w.botId });
        const draining = w.app.drain(drainGraceMs);
        await vi.advanceTimersByTimeAsync(drainGraceMs - 1_000);
        expect(await gameState(w, gameId)).toMatchObject({ status: `in-progress` });
        await vi.advanceTimersByTimeAsync(1_000);
        expect(await draining).toBe(1);
        expect(await gameState(w, gameId)).toMatchObject({ status: `finished`, winner: null, reason: `aborted` });
        expect(finishes(w.stream)).toEqual([{ type: `gameFinish`, gameId, winner: null, reason: `aborted` }]);
        expect(readRating(query, { kind: `bot`, id: w.botId })).toEqual(before);
    });

    it('aborts instead of forfeiting when a stream drops during the drain', async () => {
        const gameId = await startGame(w);
        const draining = w.app.drain(drainGraceMs);
        w.stream.emitClose();
        await vi.advanceTimersByTimeAsync(orphanForfeitMs);
        expect(await gameState(w, gameId)).toMatchObject({ status: `finished`, winner: null, reason: `aborted` });
        await vi.advanceTimersByTimeAsync(1_000);
        expect(await draining).toBe(0);
    });
});
