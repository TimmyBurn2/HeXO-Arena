import {
    archiveReadGlobalLimit,
    archiveReadLimit,
    accountExportLimit,
    botManagementLimit,
    positionCheckLimit,
    positionCheckPrefixLimit,
    positionRequestLimit,
    clientRequestLimit,
    discordExchangeLimit,
    engineDialLimit,
    guestMintLimit,
    guestMintPrefixLimit,
    principalRequestLimit,
    publicRequestLimit,
    reportGlobalLimit,
    reportLimit,
    reportPrefixLimit,
    signInStartLimit,
    signInStartPrefixLimit,
    streamOpenLimit,
    type RateLimit,
} from '@hexo-arena/contract';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ClientKeys } from './client-key';
import { RateBuckets } from './rate-limits';

/**
 * How a route is limited beyond the client bucket every request spends:
 * `public` and `shell` routes need no credential and share one ceiling,
 * a shell route answering a page's plain line where the API answers JSON;
 * the rest carry a credential and are limited by it.
 */
export type LimitClass = `public` | `shell` | `principal` | `botManagement` | `stream` | `engine`;

declare module 'fastify' {
    interface FastifyContextConfig {
        limit?: LimitClass;
    }

    interface FastifyRequest {
        // The keyed hash the request's limits count under, null without a public address.
        clientKey: string | null;
        // The keyed hash of its IPv6 /48, null for IPv4 and without a public address.
        prefixKey: string | null;
    }
}

/** Every rate the app enforces, the contract's unless a test says otherwise. */
export interface LimitTable {
    client: RateLimit;
    public: RateLimit;
    principal: RateLimit;
    botManagement: RateLimit;
    streamOpen: RateLimit;
    engineDial: RateLimit;
    guestMint: RateLimit;
    signInStart: RateLimit;
    guestMintPrefix: RateLimit;
    signInStartPrefix: RateLimit;
    discordExchange: RateLimit;
    archiveRead: RateLimit;
    archiveReadGlobal: RateLimit;
    report: RateLimit;
    reportPrefix: RateLimit;
    reportGlobal: RateLimit;
    accountExport: RateLimit;
    positionRequest: RateLimit;
    positionCheck: RateLimit;
    positionCheckPrefix: RateLimit;
}

export const defaultLimits: LimitTable = {
    client: clientRequestLimit,
    public: publicRequestLimit,
    principal: principalRequestLimit,
    botManagement: botManagementLimit,
    streamOpen: streamOpenLimit,
    engineDial: engineDialLimit,
    guestMint: guestMintLimit,
    signInStart: signInStartLimit,
    guestMintPrefix: guestMintPrefixLimit,
    signInStartPrefix: signInStartPrefixLimit,
    discordExchange: discordExchangeLimit,
    archiveRead: archiveReadLimit,
    archiveReadGlobal: archiveReadGlobalLimit,
    report: reportLimit,
    reportPrefix: reportPrefixLimit,
    reportGlobal: reportGlobalLimit,
    accountExport: accountExportLimit,
    positionRequest: positionRequestLimit,
    positionCheck: positionCheckLimit,
    positionCheckPrefix: positionCheckPrefixLimit,
};

/** The limits a client is held to for one kind of act anyone may try. */
export type ClientLimit = `guestMint` | `signInStart` | `report` | `positionCheck`;

/** The limits a credential is held to, each spent once the credential is known. */
export type CredentialLimit = `principal` | `botManagement` | `streamOpen` | `engineDial` | `accountExport` | `positionRequest`;

/** The part of the limits a route handler spends after authentication. */
export interface CredentialLimits {
    refuse(reply: FastifyReply, limit: CredentialLimit, key: string): boolean;
}

/** The part of the limits a handler spends for an act anyone may try. */
export interface ClientLimits {
    wait(limit: ClientLimit, request: FastifyRequest): number | null;
    refuseArchive(reply: FastifyReply, request: FastifyRequest): boolean;
    takeDiscordExchange(): boolean;
    takeReport(): number | null;
}

// One client map holds at most this many keys, about a megabyte and a half.
const clientKeyCap = 10_000;

/** Answers a request with the refusal every limit shares. */
export function refuseRate(reply: FastifyReply, seconds: number, code = `rate_limited`): FastifyReply {
    return reply.code(429).header(`retry-after`, String(seconds)).send({ error: `too many requests; wait and retry`, code });
}

/**
 * The limits every request meets before any body is read or any row touched:
 * its client's bucket,
 * then, without a credential, the ceiling all such callers share.
 */
export class RequestLimits {
    readonly keys: ClientKeys;
    /** Each route's class, by method and pattern, as registered. */
    readonly classes = new Map<string, LimitClass>();
    readonly #client: RateBuckets;
    readonly #public: RateBuckets;
    readonly #credential: Record<CredentialLimit, RateBuckets>;
    readonly #perClient: Record<ClientLimit | `archiveRead`, RateBuckets>;
    readonly #perPrefix: Record<ClientLimit, RateBuckets>;
    readonly #archive: RateBuckets;
    readonly #discordExchange: RateBuckets;
    readonly #reportGlobal: RateBuckets;

    constructor(deps: { table: LimitTable; now: () => number; trustedProxy: string | null }) {
        this.keys = new ClientKeys({ trustedProxy: deps.trustedProxy, now: deps.now });
        this.#client = new RateBuckets(deps.table.client, deps.now, clientKeyCap);
        this.#public = new RateBuckets(deps.table.public, deps.now);
        this.#credential = {
            principal: new RateBuckets(deps.table.principal, deps.now),
            botManagement: new RateBuckets(deps.table.botManagement, deps.now),
            streamOpen: new RateBuckets(deps.table.streamOpen, deps.now),
            engineDial: new RateBuckets(deps.table.engineDial, deps.now),
            accountExport: new RateBuckets(deps.table.accountExport, deps.now),
            positionRequest: new RateBuckets(deps.table.positionRequest, deps.now),
        };
        this.#perClient = {
            guestMint: new RateBuckets(deps.table.guestMint, deps.now, clientKeyCap),
            signInStart: new RateBuckets(deps.table.signInStart, deps.now, clientKeyCap),
            report: new RateBuckets(deps.table.report, deps.now, clientKeyCap),
            positionCheck: new RateBuckets(deps.table.positionCheck, deps.now, clientKeyCap),
            archiveRead: new RateBuckets(deps.table.archiveRead, deps.now, clientKeyCap),
        };
        this.#perPrefix = {
            guestMint: new RateBuckets(deps.table.guestMintPrefix, deps.now, clientKeyCap),
            signInStart: new RateBuckets(deps.table.signInStartPrefix, deps.now, clientKeyCap),
            report: new RateBuckets(deps.table.reportPrefix, deps.now, clientKeyCap),
            positionCheck: new RateBuckets(deps.table.positionCheckPrefix, deps.now, clientKeyCap),
        };
        this.#archive = new RateBuckets(deps.table.archiveReadGlobal, deps.now);
        this.#discordExchange = new RateBuckets(deps.table.discordExchange, deps.now);
        this.#reportGlobal = new RateBuckets(deps.table.reportGlobal, deps.now);
        this.keys.onRekey(() => {
            this.#client.clear();
            for (const buckets of [...Object.values(this.#perClient), ...Object.values(this.#perPrefix)]) buckets.clear();
        });
    }

    /** Client keys held now. */
    get clientCount(): number {
        return this.#client.size;
    }

    sweep(): void {
        this.#client.sweep();
        this.#public.sweep();
        for (const buckets of Object.values(this.#credential)) buckets.sweep();
        for (const buckets of [...Object.values(this.#perClient), ...Object.values(this.#perPrefix)]) buckets.sweep();
        this.#archive.sweep();
        this.#discordExchange.sweep();
        this.#reportGlobal.sweep();
    }

    /**
     * Spends a token of the client's bucket for an anonymous act, then of its IPv6 /48's:
     * null when admitted, else whole seconds until one returns.
     * A request without a public address meets only the act's global cap.
     */
    wait(limit: ClientLimit, request: FastifyRequest): number | null {
        if (request.clientKey === null) return null;
        return this.#perClient[limit].take(request.clientKey) ?? (request.prefixKey === null ? null : this.#perPrefix[limit].take(request.prefixKey));
    }

    /** Spends one of the Discord exchanges every caller shares; false once they are spent. */
    takeDiscordExchange(): boolean {
        return this.#discordExchange.take(`all`) === null;
    }

    /** Spends one of the reports every caller shares: null when admitted, else whole seconds until one returns. */
    takeReport(): number | null {
        return this.#reportGlobal.take(`all`);
    }

    /**
     * Spends a finished-game read, the client's and then the one all callers share;
     * a replayed board costs what a cheap read does not.
     */
    refuseArchive(reply: FastifyReply, request: FastifyRequest): boolean {
        const wait = (request.clientKey === null ? null : this.#perClient.archiveRead.take(request.clientKey)) ?? this.#archive.take(`all`);
        if (wait === null) return false;
        void refuseRate(reply, wait);
        return true;
    }

    /**
     * Spends a token of a credential's bucket, keyed by who holds it:
     * a bot, a user, a guest, or a game seat.
     * Answers the refusal and yields true when the bucket is spent.
     */
    refuse(reply: FastifyReply, limit: CredentialLimit, key: string): boolean {
        const wait = this.#credential[limit].take(key);
        if (wait === null) return false;
        void refuseRate(reply, wait);
        return true;
    }

    /**
     * Makes every route name its class, so none ships unlimited,
     * and spends each request's tokens before anything else runs.
     */
    register(app: FastifyInstance): void {
        app.decorateRequest(`clientKey`, null);
        app.decorateRequest(`prefixKey`, null);
        app.addHook(`onRoute`, (route) => {
            const limit = route.config?.limit;
            if (limit === undefined) throw new Error(`route ${String(route.method)} ${route.url} names no limit class`);
            for (const method of [route.method].flat()) this.classes.set(`${method} ${route.url}`, limit);
        });
        app.addHook(`onRequest`, (request, reply, done) => {
            // A path no route serves reads as a public page.
            const limit = request.routeOptions.config.limit ?? `public`;
            const { client: key, prefix } = this.keys.keysOf(request.socket.remoteAddress, request.headers[`x-forwarded-for`]);
            request.clientKey = key;
            request.prefixKey = prefix;
            const wait = (key === null ? null : this.#client.take(key)) ?? (limit === `public` || limit === `shell` ? this.#public.take(`all`) : null);
            if (wait === null) {
                done();
                return;
            }
            if (limit === `shell`) {
                void reply.code(429).header(`retry-after`, String(wait)).type(`text/plain; charset=utf-8`).send(`Too many requests; try again in ${String(wait)} s.\n`);
                return;
            }
            void refuseRate(reply, wait);
        });
    }
}
