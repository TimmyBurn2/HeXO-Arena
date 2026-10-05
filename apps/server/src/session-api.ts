import {
    accountExportSchema,
    deleteAccountRequestSchema,
    meUpdateRequestSchema,
    guestPath,
    guestRetryAfterSeconds,
    logoutPath,
    meExportPath,
    mePath,
    sessionCookieNameFor,
    sessionMaxAgeSeconds,
    type GuestMe,
    type Me,
    type UserMe,
} from '@hexo-arena/contract';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { accountExport } from './account-export';
import type { AnalysisService } from './analysis-service';
import { userOptedOut } from './analysis-store';
import { recordAdminAction } from './admin-store';
import type { Query } from './db';
import { eraseUser, type ErasureDeps, type ErasureJournal } from './erasure';
import type { GameRegistry, Person } from './game-registry';
import type { GuestSessions } from './guests';
import type { Ladder } from './ladder';
import { refuseRate, type ClientLimits, type CredentialLimits } from './request-limits';
import { streamPlayerOf } from './rating-store';
import { deleteSession, findSessionUser, sessionUser, type SessionUser } from './sessions';

interface SessionApiDeps {
    query: Query;
    guests: GuestSessions;
    games: GameRegistry;
    secureCookies: boolean;
    limits: ClientLimits & CredentialLimits;
    // What a person's own deletion ends and withdraws, as the operator's does.
    erasure: Omit<ErasureDeps, `games`>;
    erasures: Pick<ErasureJournal, `record`> | null;
    ladder: Pick<Ladder, `clear`>;
    analysis: Pick<AnalysisService, `setOptOut` | `positionsLeft` | `gamesLeft`>;
    now: () => number;
}

// The audit actor of a deletion the person asked for themselves.
const selfActor = `self`;

function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
    reply.clearCookie(sessionCookieNameFor(secure), { path: `/`, httpOnly: true, sameSite: `lax`, secure });
}

// An account session outlives the browser; a guest session ends with it,
// since nothing of a guest survives anyway.
type CookieLife = `account` | `guest`;

declare module 'fastify' {
    interface FastifyRequest {
        // The session cookie's value under the one name this deployment sets.
        sessionToken: string | undefined;
    }
}

export function setSessionCookie(reply: FastifyReply, token: string, secure: boolean, life: CookieLife): void {
    reply.setCookie(sessionCookieNameFor(secure), token, {
        path: `/`,
        httpOnly: true,
        sameSite: `lax`,
        secure,
        ...(life === `account` && { maxAge: sessionMaxAgeSeconds }),
    });
}

/**
 * Reads the session cookie under the name this deployment sets, and refuses
 * a write that carries it from another origin.
 * SameSite=Lax keeps the cookie off a cross-site write, but a sibling
 * subdomain is the same site; the browser's own Sec-Fetch-Site tells it apart.
 * A client that sends none, a bot or curl, is never refused.
 */
export function registerSessionCookie(app: FastifyInstance, secure: boolean): void {
    const name = sessionCookieNameFor(secure);
    app.decorateRequest(`sessionToken`, undefined);
    app.addHook(`onRequest`, (request, reply, done) => {
        const token = request.cookies[name];
        request.sessionToken = token;
        const site = request.headers[`sec-fetch-site`];
        if (token !== undefined && request.method !== `GET` && request.method !== `HEAD` && site !== undefined && site !== `same-origin`) {
            void reply.code(403).send({ error: `a write from another origin carries no session`, code: `cross_origin` });
            return;
        }
        done();
    });
}

/**
 * The person behind a request's session cookie: a user, a guest, or null.
 * Guests are checked first, as a map lookup costs less than a query.
 */
export function sessionPerson(query: Query, guests: GuestSessions, request: FastifyRequest): Person | null {
    const token = request.sessionToken;
    if (token === undefined) return null;
    const guest = guests.find(token);
    if (guest !== null) return { kind: `guest`, id: guest.id, name: guest.name, since: guest.since };
    const user = findSessionUser(query, token);
    return user === null ? null : { kind: `user`, id: user.id, name: user.name };
}

// The Discord names come from the session row, so only the cookie's owner
// ever reads them.
function meOf(deps: SessionApiDeps, token: string | undefined): Me {
    const { query, guests, games } = deps;
    if (token === undefined) return null;
    const guest = guests.find(token);
    if (guest !== null) return { kind: `guest`, name: guest.name, liveGames: games.liveGamesOf({ kind: `guest`, id: guest.id }) };
    const user = findSessionUser(query, token);
    return user === null ? null : userMeOf(deps, user);
}

function userMeOf(deps: SessionApiDeps, user: SessionUser): UserMe {
    const { query, games, analysis } = deps;
    const { rating, provisional } = streamPlayerOf(query, { kind: `human`, id: user.id }, user.name);
    return {
        kind: `user`,
        name: user.name,
        rating,
        provisional,
        discord: user.discord,
        liveGames: games.liveGamesOf({ kind: `user`, id: user.id }),
        analysisOptOut: userOptedOut(query, user.id),
        analysisLeft: { positions: analysis.positionsLeft(user.id), games: analysis.gamesLeft(user.id) },
    };
}

export function registerSessionApi(app: FastifyInstance, deps: SessionApiDeps): void {
    const { query, guests, games, secureCookies, limits } = deps;

    app.get(mePath, { config: { limit: `public` } }, async (request, reply) => {
        return reply.code(200).send(meOf(deps, request.sessionToken));
    });

    app.patch(mePath, { config: { limit: `principal` } }, async (request, reply) => {
        const user = sessionUser(query, request);
        if (user === null) return reply.code(401).send({ error: `no session`, code: `unauthorized` });
        if (limits.refuse(reply, `principal`, `user:${user.id}`)) return reply;
        const parsed = meUpdateRequestSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: `the request fails validation`, code: `bad_request` });
        if (parsed.data.analysisOptOut !== undefined) deps.analysis.setOptOut(user.id, parsed.data.analysisOptOut);
        return reply.code(200).send(userMeOf(deps, user));
    });

    app.post(logoutPath, { config: { limit: `public` } }, async (request, reply) => {
        const token = request.sessionToken;
        if (token !== undefined) {
            guests.end(token);
            deleteSession(query, token);
        }
        clearSessionCookie(reply, secureCookies);
        return reply.code(204).send();
    });

    // The typed name guards against a stray request; a seat in a live game
    // is refused, since ending the game would hand its owner an unrated exit.
    app.delete(mePath, { config: { limit: `principal` } }, async (request, reply) => {
        const user = sessionUser(query, request);
        if (user === null) return reply.code(401).send({ error: `no session`, code: `unauthorized` });
        if (limits.refuse(reply, `principal`, `user:${user.id}`)) return reply;
        const parsed = deleteAccountRequestSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: `the request fails validation`, code: `bad_request` });
        if (parsed.data.name !== user.name) return reply.code(400).send({ error: `the name is not the account's`, code: `name_mismatch` });
        if (games.activeHumanGameCount({ kind: `user`, id: user.id }) > 0) {
            return reply.code(409).send({ error: `the account is seated in a live game`, code: `in_live_game` });
        }
        query.transaction((tx) => {
            const deletion = eraseUser({ ...deps.erasure, games }, tx, user.id);
            recordAdminAction(tx, { actor: selfActor, action: `delete-user`, target: deletion.placeholder, reason: `deleted their own account` });
        });
        deps.erasures?.record(user.id);
        deps.ladder.clear();
        clearSessionCookie(reply, secureCookies);
        return reply.code(204).send();
    });

    app.get(meExportPath, { config: { limit: `principal` } }, async (request, reply) => {
        const user = sessionUser(query, request);
        if (user === null) return reply.code(401).send({ error: `no session`, code: `unauthorized` });
        if (limits.refuse(reply, `accountExport`, `user:${user.id}`)) return reply;
        const now = deps.now();
        const body = JSON.stringify(accountExportSchema.parse(accountExport(query, user.id, now)));
        const day = new Date(now).toISOString().slice(0, 10);
        return reply
            .code(200)
            .header(`content-type`, `application/json; charset=utf-8`)
            .header(`content-disposition`, `attachment; filename="hexo-arena-${user.name}-${day}.json"`)
            .send(body);
    });

    app.post(guestPath, { config: { limit: `public` } }, async (request, reply) => {
        const person = sessionPerson(query, guests, request);
        if (person?.kind === `user`) {
            return reply.code(409).send({ error: `a user is signed in`, code: `signed_in` });
        }
        if (person?.kind === `guest`) {
            const same: GuestMe = { kind: `guest`, name: person.name, liveGames: games.liveGamesOf(person) };
            return reply.code(200).send(same);
        }
        // One client could otherwise fill the cap every visitor shares.
        const wait = limits.wait(`guestMint`, request);
        if (wait !== null) return refuseRate(reply, wait);
        const minted = guests.mint();
        if (minted === null) {
            reply.header(`retry-after`, String(guestRetryAfterSeconds));
            return reply.code(429).send({ error: `the guest cap is full`, code: `guest_limit` });
        }
        setSessionCookie(reply, minted.token, secureCookies, `guest`);
        const fresh: GuestMe = { kind: `guest`, name: minted.guest.name, liveGames: [] };
        return reply.code(201).send(fresh);
    });
}
