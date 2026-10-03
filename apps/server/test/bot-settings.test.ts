import { accountExportSchema, botAccountSchema, botListingSchema, botSettingsSchema, type BotListing } from '@hexo-arena/contract';
import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findBot } from '../src/bots';
import { createQuery } from '../src/db';
import { insertBotGame, recordFinish } from '../src/game-store';
import { deleteBotByPolicy } from '../src/moderation';
import { createTestApp, loginAs, mintBot, type TestApp } from './helpers';

describe('a bot\'s settings and what its pages show', () => {
    let world: TestApp;
    let owner: string;
    let token: string;
    let address: string | null;
    const opened: http.ClientRequest[] = [];

    beforeEach(async () => {
        world = await createTestApp({ logger: false });
        owner = await loginAs(world.app, `ann`);
        token = await mintBot(world.app, owner, `alpha`);
        address = null;
    });

    afterEach(async () => {
        for (const request of opened.splice(0)) request.destroy();
        world.app.server.closeAllConnections();
        await world.app.close();
        world.sqlite.close();
    });

    const declare = (payload: Record<string, unknown>) =>
        world.app.inject({ method: `PATCH`, url: `/api/bot/account`, headers: { authorization: `Bearer ${token}` }, payload });

    const settings = async (person = owner, payload?: Record<string, unknown>) =>
        world.app.inject({ method: payload === undefined ? `GET` : `PATCH`, url: `/api/bots/alpha/settings`, cookies: { hexo_arena_session: person }, ...(payload === undefined ? {} : { payload }) });

    const listing = async (): Promise<BotListing | undefined> =>
        botListingSchema
            .array()
            .parse((await world.app.inject({ method: `GET`, url: `/api/bots` })).json())
            .find((bot) => bot.name === `alpha`);

    // Opens the bot's stream over the network with the User-Agent given, answering once the headers arrive.
    async function openStream(userAgent: string | null): Promise<number> {
        address ??= await world.app.listen({ host: `127.0.0.1`, port: 0 });
        const headers: Record<string, string> = { authorization: `Bearer ${token}` };
        if (userAgent !== null) headers[`user-agent`] = userAgent;
        return new Promise((resolve, reject) => {
            const request = http.get(`${address ?? ``}/api/bot/stream`, { headers }, (response) => {
                resolve(response.statusCode ?? 0);
            });
            opened.push(request);
            request.on(`error`, reject);
        });
    }

    function storedClient(): unknown {
        return world.sqlite.prepare(`select client_kind as kind, client_version as version from bots where name = 'alpha'`).get();
    }

    it('shows the owner\'s text and link in place of the declared ones, and the declared ones again once cleared', async () => {
        expect((await declare({ about: `Declared text`, repoUrl: `https://example.org/declared` })).statusCode).toBe(200);
        expect(await listing()).toMatchObject({ about: `Declared text`, repoUrl: `https://example.org/declared` });
        const set = await settings(owner, { about: `  Owner\ttext\u200b `, repoUrl: ` https://example.org/owner ` });
        expect(set.statusCode).toBe(200);
        expect(botSettingsSchema.parse(set.json())).toEqual({
            name: `alpha`,
            duelsByOthers: true,
            about: `Owner text`,
            repoUrl: `https://example.org/owner`,
            declaredAbout: `Declared text`,
            declaredRepoUrl: `https://example.org/declared`,
        });
        expect(await listing()).toMatchObject({ about: `Owner text`, repoUrl: `https://example.org/owner` });
        const account = botAccountSchema.parse((await world.app.inject({ method: `GET`, url: `/api/bot/account`, headers: { authorization: `Bearer ${token}` } })).json());
        expect(account).toMatchObject({ about: `Owner text`, repoUrl: `https://example.org/owner` });
        expect(botAccountSchema.parse((await declare({ about: `Declared again` })).json())).toMatchObject({ about: `Owner text` });
        expect((await settings(owner, { about: ``, repoUrl: `` })).json()).toEqual({
            name: `alpha`,
            duelsByOthers: true,
            declaredAbout: `Declared again`,
            declaredRepoUrl: `https://example.org/declared`,
        });
        expect(await listing()).toMatchObject({ about: `Declared again`, repoUrl: `https://example.org/declared` });
    });

    it('shows the owner\'s text for a bot that declares none, and nothing until either sets one', async () => {
        expect(await listing()).not.toHaveProperty(`about`);
        await settings(owner, { about: `Only the owner's` });
        expect(await listing()).toMatchObject({ about: `Only the owner's` });
        expect(await listing()).not.toHaveProperty(`repoUrl`);
    });

    it('refuses a link that is not http or https, or text past the cap once cleaned, and keeps what was there', async () => {
        await settings(owner, { about: `Kept` });
        for (const payload of [{ repoUrl: `ftp://example.org` }, { repoUrl: `https:example.org` }, { repoUrl: `javascript:alert(1)` }, { about: `x`.repeat(281) }, { open: true }]) {
            const answer = await settings(owner, payload);
            expect(answer.statusCode, JSON.stringify(payload)).toBe(400);
            expect(answer.json()).toMatchObject({ code: `bad_request` });
        }
        expect((await settings(owner, { about: `${`y`.repeat(280)}\n\n` })).statusCode).toBe(200);
        expect(world.sqlite.prepare(`select length(owner_about) as n from bots where name = 'alpha'`).get()).toEqual({ n: 280 });
    });

    it('lets no one but the owner read or change the settings', async () => {
        const other = await loginAs(world.app, `bob`);
        expect((await settings(other)).statusCode).toBe(404);
        expect((await settings(other, { about: `Not yours` })).statusCode).toBe(404);
        const signedOut = await world.app.inject({ method: `GET`, url: `/api/bots/alpha/settings` });
        expect(signedOut.statusCode).toBe(401);
        expect(await listing()).not.toHaveProperty(`about`);
    });

    it('keeps hexo-bridge and its release from the stream\'s User-Agent, never the header itself, and shows it to the owner', async () => {
        expect(botSettingsSchema.parse((await settings()).json())).not.toHaveProperty(`client`);
        expect(await openStream(`hexo-bridge/0.3.0 (uamarker)`)).toBe(200);
        expect(storedClient()).toEqual({ kind: `hexo-bridge`, version: `0.3.0` });
        expect(botSettingsSchema.parse((await settings()).json()).client).toEqual({ kind: `hexo-bridge`, version: `0.3.0` });
        expect(await listing()).not.toHaveProperty(`client`);
        expect(world.sqlite.serialize().includes(`uamarker`)).toBe(false);
    });

    it('counts any other User-Agent, or none, as another client', async () => {
        for (const userAgent of [`Mozilla/5.0 hexo-bridge/0.3.0`, `hexo-bridge/0.4.0rc1`, `hexo-bridge/unknown`, `python-urllib/3.12`, null]) {
            expect(await openStream(userAgent)).toBe(200);
            expect(storedClient(), String(userAgent)).toEqual({ kind: `other`, version: null });
        }
        expect(botSettingsSchema.parse((await settings()).json()).client).toEqual({ kind: `other` });
    });

    it('gives the operator a bot\'s client, and a census of the clients connected in the last two weeks', async () => {
        expect(world.admin({ op: `bot`, name: `alpha` })).toMatchObject({ kind: `bot`, bot: { name: `alpha`, owner: `ann`, client: null, clientAt: null } });
        await openStream(`hexo-bridge/0.3.0`);
        const view = world.admin({ op: `bot`, name: `alpha` });
        expect(view).toMatchObject({ kind: `bot`, bot: { online: true, open: false, client: { kind: `hexo-bridge`, version: `0.3.0` } } });
        expect(view.kind === `bot` ? view.bot.clientAt : null).toEqual(expect.any(Number));
        await mintBot(world.app, owner, `beta`);
        await mintBot(world.app, owner, `gamma`);
        world.sqlite.prepare(`update bots set client_kind = 'other', client_at = ? where name = 'beta'`).run(Math.floor(Date.now() / 1000) - 15 * 86_400);
        const status = world.admin({ op: `status` });
        expect(status.kind === `status` ? status.status.clients : null).toEqual([{ client: `hexo-bridge/0.3.0`, bots: 1 }]);
        expect(world.admin({ op: `bot`, name: `nobody` })).toMatchObject({ kind: `error`, code: `not_found` });
    });

    it('hands the owner\'s text, link, and the client over in the data export, and clears them when the bot is kept anonymized', async () => {
        await settings(owner, { about: `Owner text`, repoUrl: `https://example.org/owner` });
        await openStream(`hexo-bridge/0.3.0`);
        const exported = accountExportSchema.parse((await world.app.inject({ method: `GET`, url: `/api/me/export`, cookies: { hexo_arena_session: owner } })).json());
        expect(exported.bots[0]).toMatchObject({ ownerAbout: `Owner text`, ownerRepoUrl: `https://example.org/owner`, client: { kind: `hexo-bridge`, version: `0.3.0` } });
        const query = createQuery(world.sqlite);
        await mintBot(world.app, await loginAs(world.app, `bob`), `beta`);
        const id = findBot(query, `alpha`)?.id ?? ``;
        const decided = insertBotGame(query, { challengerBotId: id, destBotId: findBot(query, `beta`)?.id ?? ``, challengerSide: `x`, timeControl: { mode: `unlimited` }, opening: [{ x: 0, y: 0, player: 0 }] });
        recordFinish(query, decided, { winner: `x`, reason: `surrender` });
        expect(deleteBotByPolicy(query, id).kind).toBe(`anonymized`);
        expect(world.sqlite.prepare(`select owner_about as about, owner_repo_url as repo, client_kind as kind, client_version as version, client_at as at from bots where id = ?`).get(id)).toEqual({
            about: null,
            repo: null,
            kind: null,
            version: null,
            at: null,
        });
    });
});
