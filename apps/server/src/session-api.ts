import {
    guestPath,
    guestRetryAfterSeconds,
    logoutPath,
    mePath,
    sessionCookieName,
    type GuestMe,
    type Me,
} from '@hexo-arena/contract';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Query } from './db';
import type { Person } from './game-registry';
import type { GuestSessions } from './guests';
import { streamPlayerOf } from './rating-store';
import { deleteSession, findSessionUser, sessionCookieMaxAge } from './sessions';

export interface SessionApiDeps {
    query: Query;
    guests: GuestSessions;
    secureCookies: boolean;
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
        ...(life === `account` && { maxAge: sessionCookieMaxAge }),
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

/**
 * A new sign-in replaces whatever guest session the browser held, and the
 * guest's games end with it.
 */
export function endGuestSession(guests: GuestSessions, request: FastifyRequest): void {
    const token = request.cookies[sessionCookieName];
    if (token !== undefined) guests.end(token);
}

function meOf(query: Query, person: Person | null): Me {
    if (person === null) return null;
    if (person.kind === `guest`) return { kind: `guest`, name: person.name };
    const { rating, provisional } = streamPlayerOf(query, { kind: `human`, id: person.id }, person.name);
    return { kind: `user`, name: person.name, rating, provisional };
}

export function registerSessionApi(app: FastifyInstance, deps: SessionApiDeps): void {
    const { query, guests, secureCookies } = deps;

    app.get(mePath, async (request, reply) => {
        const person = sessionPerson(query, guests, request);
        return reply.code(200).send(meOf(query, person));
    });

    app.post(logoutPath, async (request, reply) => {
        const token = request.cookies[sessionCookieName];
        if (token !== undefined) {
            guests.end(token);
            deleteSession(query, token);
        }
        reply.clearCookie(sessionCookieName, { path: `/`, httpOnly: true, sameSite: `lax`, secure: secureCookies });
        return reply.code(204).send();
    });

    app.post(guestPath, async (request, reply) => {
        const person = sessionPerson(query, guests, request);
        if (person?.kind === `user`) {
            return reply.code(409).send({ error: `a user is signed in`, code: `signed_in` });
        }
        if (person?.kind === `guest`) {
            const same: GuestMe = { kind: `guest`, name: person.name };
            return reply.code(200).send(same);
        }
        const minted = guests.mint();
        if (minted === null) {
            reply.header(`retry-after`, String(guestRetryAfterSeconds));
            return reply.code(429).send({ error: `the guest cap is full`, code: `guest_limit` });
        }
        setSessionCookie(reply, minted.token, secureCookies, `guest`);
        const fresh: GuestMe = { kind: `guest`, name: minted.guest.name };
        return reply.code(201).send(fresh);
    });
}
