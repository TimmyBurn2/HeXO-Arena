import { nameKeyOf, type AdminMutation, type AdminRequest, type AdminResponse, type AdminStatus } from '@hexo-arena/contract';
import type { AdminHandler } from './admin-socket';
import { recentAdminActions, recordAdminAction } from './admin-store';
import {
    banUser,
    botIdsOf,
    deleteUser,
    findBotId,
    findUserId,
    liveBotIdsOf,
    revokeBot,
    setBotDelisted,
    unbanUser,
    voidGames,
    type ModerationChange,
} from './moderation';
import { recomputeRatings } from './rating-store';
import type { ChallengeRegistry } from './challenge-registry';
import type { Query } from './db';
import type { GameRegistry } from './game-registry';
import { findGame } from './game-store';
import type { PresenceRegistry } from './presence';
import type { RequestLimits } from './request-limits';
import { isPaused, setPaused } from './site-state';

export interface AdminDeps {
    query: Query;
    presence: PresenceRegistry;
    games: GameRegistry;
    challenges: ChallengeRegistry;
    limits: Pick<RequestLimits, `clientCount` | `keys`>;
    actor: string;
}

const recentActionCount = 10;

function statusOf(deps: AdminDeps): AdminStatus {
    return {
        uptimeSeconds: Math.floor(process.uptime()),
        paused: isPaused(deps.query),
        liveStreams: deps.presence.streamCount(),
        activeGames: deps.games.liveGameCount(),
        clientKeys: deps.limits.clientCount,
        keylessRequests: deps.limits.keys.keyless,
        recentActions: recentAdminActions(deps.query, recentActionCount),
    };
}

function done(summary: string): AdminResponse {
    return { kind: `done`, summary };
}

function unchanged(error: string): AdminResponse {
    return { kind: `error`, code: `unchanged`, error };
}

function notFound(error: string): AdminResponse {
    return { kind: `error`, code: `not_found`, error };
}

// What a mutation answers, plus the effect on live streams and games that
// may only run once the change is committed.
interface Outcome {
    response: AdminResponse;
    live?: () => void;
}

// The change and its audit row commit together, so no mutation lands
// unaudited and a refused one leaves no row.
function audited(
    deps: AdminDeps,
    mutation: AdminMutation,
    target: string | null,
    change: (tx: Query) => Outcome,
): AdminResponse {
    const outcome = deps.query.transaction((tx) => {
        const result = change(tx);
        if (result.response.kind === `done`) {
            recordAdminAction(tx, { actor: deps.actor, action: mutation.op, target, reason: mutation.reason });
        }
        return result;
    });
    outcome.live?.();
    return outcome.response;
}

function settle(
    change: ModerationChange,
    answers: { done: string; unchanged?: string; notFound: string; live?: (id: string) => void },
): Outcome {
    switch (change.kind) {
        case `changed`: {
            const live = answers.live;
            return live === undefined
                ? { response: done(answers.done) }
                : { response: done(answers.done), live: () => { live(change.id); } };
        }
        case `unchanged`:
            return { response: unchanged(answers.unchanged ?? `nothing to change`) };
        case `not_found`:
            return { response: notFound(answers.notFound) };
    }
}

// Aborting writes the finish through the registry, so the change runs
// inside the audit transaction and the events go out with it.
function abortGame(deps: AdminDeps, tx: Query, target: { gameId?: string | undefined; bot?: string | undefined }): Outcome {
    if (target.bot !== undefined) {
        const botId = findBotId(tx, nameKeyOf(target.bot));
        if (botId === undefined) return { response: notFound(`no such bot`) };
        const aborted = deps.games.abortForBot(botId);
        return {
            response:
                aborted === 0 ? unchanged(`no live games`) : done(`aborted ${String(aborted)} live games of ${target.bot}`),
        };
    }
    const gameId = target.gameId ?? ``;
    if (deps.games.abort(gameId)) return { response: done(`aborted ${gameId}`) };
    return {
        response: findGame(tx, gameId) === undefined ? notFound(`no such game`) : unchanged(`the game is already finished`),
    };
}

// A forgotten user's live games end unrated before their rows change: an
// operator's deletion is no one's fault at the board, and a clean delete
// would take the game rows away from under the registry.
function forgetUser(deps: AdminDeps, tx: Query, name: string): Outcome {
    const userId = findUserId(tx, nameKeyOf(name));
    if (userId === undefined) return { response: notFound(`no such user`) };
    const botIds = liveBotIdsOf(tx, userId);
    let aborted = deps.games.abortForPerson({ kind: `user`, id: userId });
    for (const botId of botIds) {
        aborted += deps.games.abortForBot(botId);
        deps.presence.close(botId);
        deps.challenges.withdrawFor(botId);
    }
    const deletion = deleteUser(tx, userId);
    const user = deletion.placeholder === null ? `user deleted` : `user kept as ${deletion.placeholder}`;
    const bots = `${String(deletion.bots.anonymized)} bots kept anonymized, ${String(deletion.bots.deleted)} deleted`;
    return { response: done(`forgot ${name}: ${user}; ${bots}; ${String(aborted)} live games aborted`) };
}

function recompute(tx: Query, exclude: readonly string[]): Outcome {
    const voided = voidGames(tx, exclude);
    if (voided.kind === `not_found`) return { response: notFound(`no game or player matches ${voided.match}`) };
    const rated = recomputeRatings(tx);
    return { response: done(`re-folded ${String(rated)} rated games; voided ${String(voided.count)} more`) };
}

/**
 * The admin ops, applied in this process: every live effect lands on the
 * registries that own the streams and games.
 */
export function createAdminHandler(deps: AdminDeps): AdminHandler {
    return (request: AdminRequest): AdminResponse => {
        switch (request.op) {
            case `status`:
                return { kind: `status`, status: statusOf(deps) };
            case `pause`:
                return audited(deps, request, null, (tx) => ({
                    response: setPaused(tx, true) ? done(`paused`) : unchanged(`already paused`),
                }));
            case `resume`:
                return audited(deps, request, null, (tx) => ({
                    response: setPaused(tx, false) ? done(`resumed`) : unchanged(`not paused`),
                }));
            case `delist-bot`:
                return audited(deps, request, request.name, (tx) =>
                    settle(setBotDelisted(tx, nameKeyOf(request.name), true), {
                        done: `delisted ${request.name}`,
                        unchanged: `already delisted`,
                        notFound: `no such bot`,
                        // Its stream and live games run on; only what is
                        // still pending leaves with it.
                        live: (botId) => {
                            deps.challenges.withdrawFor(botId);
                        },
                    }),
                );
            case `ban-user`:
                return audited(deps, request, request.name, (tx) =>
                    settle(banUser(tx, nameKeyOf(request.name)), {
                        done: `banned ${request.name}`,
                        unchanged: `already banned`,
                        notFound: `no such user`,
                        // A closed stream orphans the bot's live games,
                        // which then forfeit on the clock, rated: a ban
                        // grants no unrated escape.
                        live: (userId) => {
                            for (const botId of botIdsOf(deps.query, userId)) {
                                deps.presence.close(botId);
                                deps.challenges.withdrawFor(botId);
                            }
                        },
                    }),
                );
            case `unban-user`:
                return audited(deps, request, request.name, (tx) =>
                    settle(unbanUser(tx, nameKeyOf(request.name)), {
                        done: `unbanned ${request.name}; bot tokens must be minted afresh`,
                        unchanged: `not banned`,
                        notFound: `no such user`,
                    }),
                );
            case `relist-bot`:
                return audited(deps, request, request.name, (tx) =>
                    settle(setBotDelisted(tx, nameKeyOf(request.name), false), {
                        done: `relisted ${request.name}`,
                        unchanged: `not delisted`,
                        notFound: `no such bot`,
                    }),
                );
            case `revoke-bot`:
                return audited(deps, request, request.name, (tx) =>
                    settle(revokeBot(tx, nameKeyOf(request.name)), {
                        done: `revoked the token of ${request.name}; the owner mints a fresh one`,
                        notFound: `no such bot`,
                        live: (botId) => {
                            deps.presence.close(botId);
                        },
                    }),
                );
            case `abort-game`:
                return audited(deps, request, request.gameId ?? request.bot ?? null, (tx) =>
                    abortGame(deps, tx, request),
                );
            case `recompute-ratings`:
                return audited(deps, request, request.exclude.length === 0 ? null : request.exclude.join(` `), (tx) =>
                    recompute(tx, request.exclude),
                );
            case `delete-user`:
                return audited(deps, request, request.name, (tx) => forgetUser(deps, tx, request.name));
        }
    };
}
