import {
    guestPath,
    guestRetryAfterSeconds,
    logoutPath,
    mePath,
    sessionCookieName,
    sessionMaxAgeSeconds,
    type GuestMe,
    type Me,
} from '@hexo-arena/contract';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Query } from './db';
import type { GameRegistry, Person } from './game-registry';
import type { GuestSessions } from './guests';
import { refuseRate, type ClientLimits } from './request-limits';
import { streamPlayerOf } from './rating-store';
import { deleteSession, findSessionUser } from './sessions';

export interface SessionApiDeps {
    query: Query;
    guests: GuestSessions;
    games: GameRegistry;
    secureCookies: boolean;
    limits: ClientLimits;
}

// An account session outlives the browser; a guest session ends with it,
// since nothing of a guest survives anyway.
export type CookieLife = `account` | `guest`;

export function setSessionCookie(reply: FastifyReply, token: string, secure: boolean, life: CookieLife): void {
    reply.setCookie(sessionCookieName, token, {
        path: `/`,
        httpOnly: true,
        sameSite: `lax`,
        secure,
        ...(life === `account` && { maxAge: sessionMaxAgeSeconds }),
    });
}

/**
 * The person behind a request's session cookie: a user, a guest, or null.
 * Guests are checked first, as a map lookup costs less than a query.
 */
export function sessionPerson(query: Query, guests: GuestSessions, request: FastifyRequest): Person | null {
    const token = request.cookies[sessionCookieName];
    if (token === undefined) return null;
    const guest = guests.find(token);
    if (guest !== null) return { kind: `guest`, id: guest.id, name: guest.name };
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
    if (user === null) return null;
    const { rating, provisional } = streamPlayerOf(query, { kind: `human`, id: user.id }, user.name);
    return { kind: `user`, name: user.name, rating, provisional, discord: user.discord, liveGames: games.liveGamesOf({ kind: `user`, id: user.id }) };
}

export function registerSessionApi(app: FastifyInstance, deps: SessionApiDeps): void {
    const { query, guests, games, secureCookies, limits } = deps;

    app.get(mePath, { config: { limit: `public` } }, async (request, reply) => {
        return reply.code(200).send(meOf(deps, request.cookies[sessionCookieName]));
    });

    app.post(logoutPath, { config: { limit: `public` } }, async (request, reply) => {
        const token = request.cookies[sessionCookieName];
        if (token !== undefined) {
            guests.end(token);
            deleteSession(query, token);
        }
        reply.clearCookie(sessionCookieName, { path: `/`, httpOnly: true, sameSite: `lax`, secure: secureCookies });
        return reply.code(204).send();
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
