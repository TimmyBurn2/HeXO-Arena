import {
    clientCensusDays,
    nameKeyOf,
    tournamentHorizonMs,
    tournamentWaitingCap,
    type AdminBot,
    type AdminMutation,
    type AdminRequest,
    type AdminResponse,
    type AdminStatus,
} from '@hexo-arena/contract';
import type { AdminHandler } from './admin-socket';
import { recentAdminActions, recordAdminAction } from './admin-store';
import type { AnalysisService } from './analysis-service';
import { clientCensus, findBot, findBotClient } from './bots';
import { eraseUser, withdrawBot, type ErasureJournal } from './erasure';
import {
    banUser,
    botIdsOf,
    findBotId,
    findUserId,
    revokeBot,
    setBotDelisted,
    unbanUser,
    voidGames,
    type ModerationChange,
} from './moderation';
import { recomputeRatings } from './rating-store';
import { closeReport, openReports } from './reports';
import type { ChallengeRegistry } from './challenge-registry';
import type { Query } from './db';
import type { GameRegistry } from './game-registry';
import { findGame } from './game-store';
import type { Ladder } from './ladder';
import type { PresenceRegistry } from './presence';
import type { RequestLimits } from './request-limits';
import type { DuelRunner } from './duel-runner';
import { countRunningDuels } from './duel-store';
import { isPaused, setPaused } from './site-state';
import type { TournamentScheduler } from './tournament-scheduler';
import { addTournamentRule, adminTournamentRules, nextRuleStart, removeTournamentRule, ruleSlot } from './tournament-rules';
import { countRunningRoundRobins, createTournament, openTournaments } from './tournament-store';
import { daySeconds } from './utc-day';

interface AdminDeps {
    query: Query;
    presence: PresenceRegistry;
    analysis: Pick<AnalysisService, `withdraw` | `delete`>;
    games: GameRegistry;
    challenges: ChallengeRegistry;
    tournaments: Pick<TournamentScheduler, `cancel` | `withdraw` | `stopSetUpBy`>;
    duels: Pick<DuelRunner, `stopDuel` | `endForBot`>;
    limits: Pick<RequestLimits, `clientCount` | `keys`>;
    ladder: Pick<Ladder, `clear`>;
    actor: string;
    // Writes the night's backup now, or one under a label kept apart, and
    // answers its path; null without a backup folder.
    backup: ((label?: string) => string) | null;
    // Where a deletion is journaled once committed; null where nothing is restored, as in tests.
    erasures: Pick<ErasureJournal, `record`> | null;
    // How soon a tournament may start: an hour in production, a minute on a
    // development server.
    tournamentLeadMs: number;
    now?: () => number;
}

const recentActionCount = 10;

function statusOf(deps: AdminDeps): AdminStatus {
    const reports = openReports(deps.query);
    return {
        uptimeSeconds: Math.floor(process.uptime()),
        paused: isPaused(deps.query),
        liveStreams: deps.presence.streamCount(),
        activeGames: deps.games.liveGameCount(),
        clientKeys: deps.limits.clientCount,
        keylessRequests: deps.limits.keys.keyless,
        tournaments: openTournaments(deps.query),
        tournamentRules: adminTournamentRules(deps.query, nowOf(deps), deps.tournamentLeadMs),
        liveDuels: countRunningDuels(deps.query),
        liveRoundRobins: countRunningRoundRobins(deps.query),
        clients: clientCensus(deps.query, Math.floor(nowOf(deps) / 1000) - clientCensusDays * daySeconds),
        recentActions: recentAdminActions(deps.query, recentActionCount),
        openReportCount: reports.count,
        openReports: reports.oldest,
    };
}

function botView(deps: AdminDeps, name: string): AdminBot | null {
    const bot = findBot(deps.query, nameKeyOf(name));
    if (bot === undefined) return null;
    const seen = findBotClient(deps.query, bot.id);
    return {
        name: bot.name,
        owner: bot.ownerName,
        online: deps.presence.isOnline(bot.id),
        open: deps.presence.isOpenForChallenges(bot.id),
        liveGames: deps.games.activeGameCount(bot.id),
        delisted: bot.delisted,
        version: bot.version ?? null,
        client: seen?.client ?? null,
        clientAt: seen?.at ?? null,
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

function badRequest(error: string): AdminResponse {
    return { kind: `error`, code: `bad_request`, error };
}

// What a mutation answers, plus the effect on live streams and games that
// may only run once the change is committed,
// and the audit target when only the change knows it, such as a new row's id.
interface Outcome {
    response: AdminResponse;
    live?: () => void;
    target?: string;
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
            recordAdminAction(tx, { actor: deps.actor, action: mutation.op, target: result.target ?? target, reason: mutation.reason });
        }
        return result;
    });
    outcome.live?.();
    // A recompute moves ratings and a ban or delist moves who is listed;
    // the ladder shows either at once.
    if (outcome.response.kind === `done`) deps.ladder.clear();
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

// The audit row names the placeholder, as every earlier row naming the user now does.
function forgetUser(deps: AdminDeps, tx: Query, name: string): Outcome {
    const userId = findUserId(tx, nameKeyOf(name));
    if (userId === undefined) return { response: notFound(`no such user`) };
    const deletion = eraseUser(deps, tx, userId);
    const user = deletion.user === `deleted` ? `user deleted` : `user kept`;
    const bots = `${String(deletion.bots.anonymized)} bots kept anonymized, ${String(deletion.bots.deleted)} deleted`;
    return {
        response: done(`forgot ${name} as ${deletion.placeholder}: ${user}; ${bots}; ${String(deletion.aborted)} live games aborted`),
        target: deletion.placeholder,
        live: () => {
            deps.erasures?.record(userId);
        },
    };
}

function recompute(tx: Query, exclude: readonly string[]): Outcome {
    const voided = voidGames(tx, exclude);
    if (voided.kind === `not_found`) return { response: notFound(`no game or player matches ${voided.match}`) };
    const rated = recomputeRatings(tx);
    return { response: done(`re-folded ${String(rated)} rated games; voided ${String(voided.count)} more`) };
}

function nowOf(deps: AdminDeps): number {
    return (deps.now ?? Date.now)();
}

function nowSecondsOf(deps: AdminDeps): number {
    return Math.floor(nowOf(deps) / 1000);
}

function scheduleTournament(deps: AdminDeps, tx: Query, request: Extract<AdminRequest, { op: `tournament-create` }>): Outcome {
    const startsAt = Math.floor(Date.parse(request.startsAt) / 1000);
    const created = createTournament(
        tx,
        { name: request.name, startsAt, timeControl: request.timeControl, openingPlies: request.openingPlies, maxEntrants: request.maxEntrants },
        nowSecondsOf(deps),
        deps.tournamentLeadMs,
    );
    switch (created.kind) {
        case `created`:
            return { response: done(`scheduled ${request.name} as ${created.id}, starting ${new Date(startsAt * 1000).toISOString()}`) };
        case `too_soon`:
            return { response: badRequest(`a tournament starts at least ${String(deps.tournamentLeadMs / 60_000)} minutes ahead`) };
        case `too_far`:
            return { response: badRequest(`a tournament starts at most ${String(tournamentHorizonMs / 86_400_000)} days ahead`) };
        case `waiting_full`:
            return { response: badRequest(`${String(tournamentWaitingCap)} tournaments are already waiting`) };
    }
}

function addRule(deps: AdminDeps, tx: Query, request: Extract<AdminRequest, { op: `tournament-schedule-add` }>): Outcome {
    const rule = {
        ...ruleSlot(request.weekday, request.time),
        namePattern: request.namePattern,
        timeControl: request.timeControl,
        openingPlies: request.openingPlies,
        maxEntrants: request.maxEntrants,
        daysAhead: request.daysAhead,
    };
    const added = addTournamentRule(tx, rule, nowSecondsOf(deps));
    const slot = `${request.weekday} ${request.time} UTC`;
    switch (added.kind) {
        case `added`: {
            const next = nextRuleStart(tx, { ...rule, id: added.id }, nowOf(deps), deps.tournamentLeadMs);
            return {
                response: done(
                    `added rule ${String(added.id)}: ${slot}, next start ${new Date(next * 1000).toISOString()}; each tournament opens for entries ${String(request.daysAhead)} days ahead`,
                ),
                target: String(added.id),
            };
        }
        case `same`:
            return { response: unchanged(`rule ${String(added.id)} is already this rule`) };
        case `slot_taken`:
            return { response: badRequest(`rule ${String(added.id)} already starts a tournament ${slot}; remove it first`) };
    }
}

function removeRule(tx: Query, id: number): Outcome {
    const removed = removeTournamentRule(tx, id);
    if (removed.kind === `not_found`) return { response: notFound(`no such rule`) };
    const stay = `removed rule ${String(id)}; the tournaments it created stay`;
    return {
        response: done(removed.waiting.length === 0 ? stay : `${stay}; cancel a waiting one with tournament-cancel: ${removed.waiting.join(`, `)}`),
    };
}

function endTournament(deps: AdminDeps, id: string): Outcome {
    const canceled = deps.tournaments.cancel(id);
    switch (canceled.kind) {
        case `canceled`:
            return { response: done(`canceled ${id}, which was ${canceled.status}; ${String(canceled.aborted ?? 0)} live games aborted`) };
        case `over`:
            return { response: unchanged(`the tournament is already over`) };
        case `not_found`:
            return { response: notFound(`no such tournament`) };
    }
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
            case `bot`: {
                const bot = botView(deps, request.name);
                return bot === null ? notFound(`no such bot`) : { kind: `bot`, bot };
            }
            // A snapshot changes no data, so it writes no audit row.
            case `backup`:
                return deps.backup === null
                    ? { kind: `error`, code: `bad_request`, error: `no backup folder is set` }
                    : { kind: `done`, summary: `backup written to ${deps.backup(request.label)}` };
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
                        live: (botId) => {
                            withdrawBot(deps, botId, `delisted`);
                        },
                    }),
                );
            case `ban-user`:
                return audited(deps, request, request.name, (tx) =>
                    settle(banUser(tx, nameKeyOf(request.name)), {
                        done: `banned ${request.name}`,
                        unchanged: `already banned`,
                        notFound: `no such user`,
                        live: (userId) => {
                            deps.tournaments.stopSetUpBy(userId, `banned`);
                            for (const botId of botIdsOf(deps.query, userId)) withdrawBot(deps, botId, `banned`);
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
                            deps.analysis.withdraw(botId);
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
            case `tournament-create`:
                return audited(deps, request, request.name, (tx) => scheduleTournament(deps, tx, request));
            case `tournament-cancel`:
                return audited(deps, request, request.id, () => endTournament(deps, request.id));
            case `tournament-schedule-add`:
                return audited(deps, request, null, (tx) => addRule(deps, tx, request));
            case `tournament-schedule-list`:
                return { kind: `tournament-rules`, rules: adminTournamentRules(deps.query, nowOf(deps), deps.tournamentLeadMs) };
            case `tournament-schedule-remove`:
                return audited(deps, request, String(request.id), (tx) => removeRule(tx, request.id));
            case `report-close`:
                return audited(deps, request, String(request.id), (tx) => {
                    const closed = closeReport(tx, request.id, request.reason);
                    switch (closed.kind) {
                        case `closed`:
                            return { response: done(`closed report ${String(request.id)}`) };
                        case `already_closed`:
                            return { response: unchanged(`the report is already closed`) };
                        case `not_found`:
                            return { response: notFound(`no such report`) };
                    }
                });
            case `duel-stop`:
                return audited(deps, request, request.id, () => {
                    switch (deps.duels.stopDuel(request.id, { reason: `operator`, bot: null })) {
                        case `stopped`:
                            return { response: done(`stopped ${request.id}; no further game starts, and a live one plays on`) };
                        case `over`:
                            return { response: unchanged(`the duel is already over`) };
                        case `not_found`:
                            return { response: notFound(`no such duel`) };
                    }
                });
            case `delete-analysis`:
                return audited(deps, request, request.id, () => ({
                    response: deps.analysis.delete(request.id) ? done(`deleted analysis ${request.id}`) : notFound(`no such analysis`),
                }));
        }
    };
}
