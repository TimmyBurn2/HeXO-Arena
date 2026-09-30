import {
    devLoginPath,
    devLoginRequestSchema,
    discordCallbackPath,
    discordLoginPath,
    isReservedName,
    nameKeyOf,
    nextParam,
    nextPathOf,
    sessionCookieName,
    signInFailurePath,
    signInStateCap,
    signupCookieName,
    signupMaxAgeSeconds,
    signupPath,
    signupRequestSchema,
    welcomePath,
    type Signup,
} from '@hexo-arena/contract';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Query } from './db';
import { discordNamesOf, type DiscordIdentity, type DiscordOAuth } from './discord';
import type { GuestSessions } from './guests';
import { consumeOAuthState, createOAuthState, outstandingOAuthStates } from './oauth-state';
import type { ClientLimits } from './request-limits';
import { setSessionCookie } from './session-api';
import { createSession, deleteSession } from './sessions';
import { dropSignup, findSignup, holdSignup, spendSignupAttempt } from './signups';
import { createUserWithExactName, findUserByDiscordId, suggestedName } from './users';

export interface SignInApiDeps {
    query: Query;
    guests: GuestSessions;
    discord: DiscordOAuth | null;
    secureCookies: boolean;
    devLogin: boolean;
    limits: ClientLimits;
}

// Discord answers with a code, or with an error such as access_denied for
// a cancel; anything malformed reads as missing.
const callbackQuerySchema = z.object({
    code: z.string().min(1).max(512).optional(),
    state: z.string().min(1).max(256).optional(),
    error: z.string().min(1).max(64).optional(),
});

function setSignupCookie(reply: FastifyReply, token: string, secure: boolean): void {
    reply.setCookie(signupCookieName, token, { path: signupPath, httpOnly: true, sameSite: `lax`, secure, maxAge: signupMaxAgeSeconds });
}

function clearSignupCookie(reply: FastifyReply, secure: boolean): void {
    reply.clearCookie(signupCookieName, { path: signupPath, httpOnly: true, sameSite: `lax`, secure });
}

// A sign-in replaces whatever session the browser held: a guest ends with
// its games, and an account's old session is deleted.
function endHeldSession(deps: SignInApiDeps, request: FastifyRequest): void {
    const token = request.cookies[sessionCookieName];
    if (token === undefined) return;
    deps.guests.end(token);
    deleteSession(deps.query, token);
}

// The end of every sign-in, from Discord or the dev login: a banned account
// stops first, a known one is signed in and sent to `next`, and an unknown
// one is held until the person chooses a public name, with nothing public
// or lasting made yet.
function finishSignIn(deps: SignInApiDeps, identity: DiscordIdentity, next: string, request: FastifyRequest, reply: FastifyReply): FastifyReply {
    const user = findUserByDiscordId(deps.query, identity.id);
    if (user?.banned === true) return reply.redirect(signInFailurePath(`banned`, next));
    if (user === undefined) {
        setSignupCookie(reply, holdSignup(deps.query, identity, next), deps.secureCookies);
        return reply.redirect(welcomePath);
    }
    endHeldSession(deps, request);
    setSessionCookie(reply, createSession(deps.query, user.id, identity.names), deps.secureCookies, `account`);
    return reply.redirect(next);
}

/** The ways in: Discord's login and callback, the first sign-in's name, and the dev login. */
export function registerSignInApi(app: FastifyInstance, deps: SignInApiDeps): void {
    const { query, secureCookies } = deps;

    // A visitor reaches these routes by following links, so every failure
    // is a redirect to the page the sign-in started from, naming its
    // reason, never a JSON body as a page.
    app.get(discordLoginPath, { config: { limit: `public` } }, async (request, reply) => {
        const next = nextPathOf((request.query as Record<string, unknown>)[nextParam]);
        if (!deps.discord) return reply.redirect(signInFailurePath(`unconfigured`, next));
        // Each start writes a state row and arms calls to Discord from the box's one address,
        // so one client's starts and all the waiting ones are bounded.
        if (deps.limits.wait(`signInStart`, request) !== null || outstandingOAuthStates(query) >= signInStateCap) {
            return reply.redirect(signInFailurePath(`busy`, next));
        }
        return reply.redirect(deps.discord.authorizeUrl(createOAuthState(query, next)));
    });

    app.get(discordCallbackPath, { config: { limit: `public` } }, async (request, reply) => {
        const parsed = callbackQuerySchema.safeParse(request.query);
        const { code, state, error } = parsed.success ? parsed.data : {};
        const issued = state === undefined ? null : consumeOAuthState(query, state);
        const next = issued?.next ?? `/`;
        if (!deps.discord) return reply.redirect(signInFailurePath(`unconfigured`, next));
        if (error !== undefined) return reply.redirect(signInFailurePath(error === `access_denied` ? `cancelled` : `rejected`, next));
        if (issued === null) return reply.redirect(signInFailurePath(`expired`));
        if (code === undefined) return reply.redirect(signInFailurePath(`rejected`, next));
        const identity = await deps.discord.exchange(code).catch(() => null);
        if (!identity) return reply.redirect(signInFailurePath(`rejected`, next));
        return finishSignIn(deps, identity, next, request, reply);
    });

    app.get(signupPath, { config: { limit: `public` } }, async (request, reply) => {
        const token = request.cookies[signupCookieName];
        const signup = token === undefined ? null : findSignup(query, token);
        if (signup === null) return reply.code(410).send({ error: `no sign-up waits for this cookie`, code: `signup_expired` });
        const body: Signup = { discord: signup.names, suggestedName: suggestedName(query, signup.names.username), next: signup.next };
        return reply.code(200).send(body);
    });

    app.post(signupPath, { config: { limit: `public` } }, async (request, reply) => {
        const token = request.cookies[signupCookieName];
        const signup = token === undefined ? null : findSignup(query, token);
        if (token === undefined || signup === null) {
            clearSignupCookie(reply, secureCookies);
            return reply.code(410).send({ error: `no sign-up waits for this cookie`, code: `signup_expired` });
        }
        if (!spendSignupAttempt(query, token)) {
            clearSignupCookie(reply, secureCookies);
            // Waiting revives nothing: the sign-up is spent, as an expired one is.
            return reply.code(410).send({ error: `the sign-up tried too many names`, code: `signup_limit` });
        }
        const parsed = signupRequestSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: `the name fails the syntax rules`, code: `invalid_name` });
        if (isReservedName(parsed.data.name)) return reply.code(400).send({ error: `the name is reserved`, code: `name_reserved` });
        // Only a held sign-up reaches here, and the callback holds none for
        // an account that exists, so a match means the account was made
        // meanwhile, and this sign-up is spent.
        if (findUserByDiscordId(query, signup.discordId) !== undefined) {
            dropSignup(query, token);
            clearSignupCookie(reply, secureCookies);
            return reply.code(410).send({ error: `no sign-up waits for this cookie`, code: `signup_expired` });
        }
        const user = createUserWithExactName(query, signup.discordId, parsed.data.name);
        if (user === `name_taken`) return reply.code(409).send({ error: `the name fold is already taken`, code: `name_taken` });
        dropSignup(query, token);
        clearSignupCookie(reply, secureCookies);
        endHeldSession(deps, request);
        setSessionCookie(reply, createSession(query, user.id, signup.names), secureCookies, `account`);
        return reply.code(201).send({ name: user.name });
    });

    app.delete(signupPath, { config: { limit: `public` } }, async (request, reply) => {
        const token = request.cookies[signupCookieName];
        if (token !== undefined) dropSignup(query, token);
        clearSignupCookie(reply, secureCookies);
        return reply.code(204).send();
    });

    if (deps.devLogin) {
        app.post(devLoginPath, { config: { limit: `public` } }, async (request, reply) => {
            const parsed = devLoginRequestSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ error: `the name fails the syntax rules`, code: `invalid_name` });
            }
            // A Discord account comes back as Discord's callback would, so
            // the first sign-in's page can be tried without Discord.
            if (`discord` in parsed.data) {
                const { username, displayName } = parsed.data.discord;
                const identity = { id: `dev:${username}`, names: discordNamesOf(`dev`, username, displayName) };
                return finishSignIn(deps, identity, parsed.data.next ?? `/`, request, reply);
            }
            const { name } = parsed.data;
            if (isReservedName(name)) {
                return reply.code(400).send({ error: `the name is reserved`, code: `name_reserved` });
            }
            // The synthetic discord id keys on the fold, so logging in
            // twice with the same name resumes the same identity.
            const discordId = `dev:${nameKeyOf(name)}`;
            const user = findUserByDiscordId(query, discordId) ?? createUserWithExactName(query, discordId, name);
            if (user === `name_taken`) {
                return reply.code(409).send({ error: `the name fold is already taken`, code: `name_taken` });
            }
            if (user.banned) return reply.code(403).send({ error: `the account is banned`, code: `banned` });
            endHeldSession(deps, request);
            setSessionCookie(reply, createSession(query, user.id, null), secureCookies, `account`);
            return reply.code(200).send({ name: user.name });
        });
    }
}
