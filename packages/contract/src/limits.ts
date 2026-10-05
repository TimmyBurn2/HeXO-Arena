/** A request rate as a GCRA bucket: `burst` requests at once, then one more every `refillMs`. */
export interface RateLimit {
    readonly burst: number;
    readonly refillMs: number;
}

/** Every request one client makes, a client being one network address (an IPv6 /64). */
export const clientRequestLimit: RateLimit = { burst: 60, refillMs: 100 };

/** Every request needing no credential, from all callers together. */
export const publicRequestLimit: RateLimit = { burst: 300, refillMs: 10 };

/** Every request one bot, user, guest, or game seat makes with its credential. */
export const principalRequestLimit: RateLimit = { burst: 20, refillMs: 500 };

/** Creating, deleting, or rotating an account's bots. */
export const botManagementLimit: RateLimit = { burst: 10, refillMs: 60_000 };

/** Stream opens per bot; the refill stays inside the orphan window, so a limited bot returns in time. */
export const streamOpenLimit: RateLimit = { burst: 5, refillMs: 10_000 };

/** Engine session dials per game seat, refilling inside the orphan window too. */
export const engineDialLimit: RateLimit = { burst: 5, refillMs: 10_000 };

/** Frames an engine session may send that answer no outstanding request; the next closes it. */
export const engineStrayFrameCap = 10;

/** The largest frame a bot may send on its engine session. */
export const engineFrameLimitBytes = 16 * 1024;

/** How long a tournament's scheduled game waits for a bot that is not ready to play. */
export const presenceGraceMs = 60_000;

/** How long a bot's live games wait for its stream to return before it forfeits them. */
export const orphanForfeitMs = 30_000;

/** An unlimited game ends after this long with no winner, as `terminated`. */
export const unlimitedWallCapMs = 24 * 60 * 60 * 1000;

/** Guest sessions one client may start. */
export const guestMintLimit: RateLimit = { burst: 3, refillMs: 20 * 60_000 };

/** Guest sessions alive at once, across every caller. */
export const guestSessionCap = 500;

/** Discord sign-ins one client may start. */
export const signInStartLimit: RateLimit = { burst: 10, refillMs: 30_000 };

// One subscriber may hold a whole IPv6 /48, 65,536 networks of a /64 each,
// so a /48 meets a second bucket of four clients' worth.

/** Guest sessions one IPv6 /48 may start. */
export const guestMintPrefixLimit: RateLimit = { burst: 4 * guestMintLimit.burst, refillMs: guestMintLimit.refillMs / 4 };

/** Discord sign-ins one IPv6 /48 may start. */
export const signInStartPrefixLimit: RateLimit = { burst: 4 * signInStartLimit.burst, refillMs: signInStartLimit.refillMs / 4 };

/** Data exports one account may download: each reads every row the account has. */
export const accountExportLimit: RateLimit = { burst: 2, refillMs: 10 * 60_000 };

/** Reports one client may send. */
export const reportLimit: RateLimit = { burst: 5, refillMs: 10 * 60_000 };

/** Reports one IPv6 /48 may send. */
export const reportPrefixLimit: RateLimit = { burst: 4 * reportLimit.burst, refillMs: reportLimit.refillMs / 4 };

/** Reports received across every caller, so no crowd of addresses fills the database. */
export const reportGlobalLimit: RateLimit = { burst: 30, refillMs: 60_000 };

/** Sign-ins handed to Discord to confirm, across every caller: Discord limits the server's one address. */
export const discordExchangeLimit: RateLimit = { burst: 30, refillMs: 1_000 };

/** Sign-ins started and not yet back from Discord, across every caller. */
export const signInStateCap = 500;

/** Event streams one client may hold on games it has no seat in. */
export const clientWatcherCap = 10;

/** Event streams one seat may hold on its own game. */
export const seatWatcherCap = 4;

/** Finished games one client may read, by snapshot or event stream. */
export const archiveReadLimit: RateLimit = { burst: 10, refillMs: 1_000 };

/** Finished games read across every caller. */
export const archiveReadGlobalLimit: RateLimit = { burst: 20, refillMs: 100 };

/** Exports of a tournament's games one client may download: each reads up to a tournament's every game. */
export const gameExportLimit: RateLimit = { burst: 4, refillMs: 15_000 };

/** Exports downloaded across every caller. */
export const gameExportGlobalLimit: RateLimit = { burst: 20, refillMs: 1_000 };

/** Challenges one bot may send in a UTC day, taken or not. */
export const challengeDailyCap = 200;

/** Challenges one bot may hold pending with any one target. */
export const challengePairPendingCap = 1;

/** Turns after which a game ends terminated, with no winner and unrated. */
export const gameTurnCap = 500;

/** The largest request body the server reads. */
export const requestBodyLimitBytes = 16 * 1024;

/** The longest line the server writes to a stream, and the largest engine frame it sends. */
export const serverLineLimitBytes = 64 * 1024;

/** Bytes a connection may leave unread before the server ends it. */
export const streamBacklogLimitBytes = 128 * 1024;

// A body past the limit is refused before a byte of it is parsed.
export const payloadTooLargeErrorCodes = [`payload_too_large`] as const;

// A refusal waiting alone can lift; the named caps keep their own codes.
export const rateLimitedErrorCodes = [`rate_limited`] as const;

/** A limit in words, as every description prints one: "5 at once, then 1 every 10 s". */
export function rateText(limit: RateLimit): string {
    const { burst, refillMs } = limit;
    const refill =
        refillMs < 1_000
            ? `${String(1_000 / refillMs)} a second`
            : refillMs === 1_000
              ? `1 a second`
              : refillMs === 60_000
                ? `1 a minute`
                : refillMs % 60_000 === 0
                  ? `1 every ${String(refillMs / 60_000)} min`
                  : `1 every ${String(refillMs / 1_000)} s`;
    return `${String(burst)} at once, then ${refill}`;
}
