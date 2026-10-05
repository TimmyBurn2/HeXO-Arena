import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    analysesPollMs,
    analysisTurnCap,
    type AnalysisFailure,
    type AnalysisList,
    type AnalyzerRef,
    type CommunityAnalysis,
    type GamePlayers,
    type OwnAnalysis,
} from '@hexo-arena/contract';
import { ApiError, fetchAnalyses, requestAnalysis } from '../api/client';
import { useAsync } from '../api/use-async';
import type { GameLine } from '../analysis/game-readings';
import { meStore } from '../me';
import { text } from '../text';

/** A reading the drawer's head can show: a community analyzer's, done or under way, or the bots' own views. */
export type ReadingChoice =
    | { readonly kind: `community`; readonly id: string; readonly name: string; readonly analysis: CommunityAnalysis }
    | { readonly kind: `own`; readonly id: string; readonly views: readonly OwnAnalysis[] };

/** The id the bots' own views go by among the choices. */
export const ownChoiceId = `own`;

/**
 * What the head says of asking for a community reading:
 * none yet, so one may be asked for; waiting for an analyzer; being read; the latest failed;
 * a player opted out; the game cannot be read whole;
 * or its one reading came from an analyzer whose owner played, and an independent one is online to read it again.
 */
export type RequestCard =
    | { readonly kind: `none` }
    | { readonly kind: `independent` }
    | { readonly kind: `queued`; readonly ahead: number }
    | { readonly kind: `running`; readonly analyzer: AnalyzerRef | null; readonly turn: number; readonly last: number; readonly share: number }
    | { readonly kind: `failed`; readonly analyzer: AnalyzerRef | null; readonly cause: AnalysisFailure; readonly turn: number | null }
    | { readonly kind: `opted-out` }
    | { readonly kind: `unreadable`; readonly why: `too-long` | `unplayed` };

/** The readings to choose between, and the card, absent once a community reading is done and none is under way. */
export interface AnalysisHeadState {
    readonly choices: readonly ReadingChoice[];
    readonly card: RequestCard | null;
}

/**
 * The head a game's readings make: finished community readings, then one under way once an analyzer has it,
 * then the bots' own views, as choices; and what the card says.
 * A reading under way speaks first; with none done the latest failure does, or the game's own limits.
 */
export function headOf(list: AnalysisList, line: GameLine): AnalysisHeadState {
    if (list.optedOut) return { choices: [], card: { kind: `opted-out` } };
    const community = list.analyses.filter((analysis) => analysis.kind === `community`);
    const done = community.filter((analysis) => analysis.status === `done`);
    const pending = community.find((analysis) => analysis.status === `queued` || analysis.status === `running`);
    const failed = community.find((analysis) => analysis.status === `failed`);
    const views = list.analyses.filter((analysis) => analysis.kind === `own`);
    const choices: ReadingChoice[] = [];
    for (const analysis of done) choices.push(communityChoice(analysis));
    if (pending?.status === `running` && pending.analyzer !== null) choices.push(communityChoice(pending));
    if (views.length > 0) choices.push({ kind: `own`, id: ownChoiceId, views });
    return { choices, card: cardOf(line, done, pending, failed, list.independentOnline) };
}

/**
 * What a community reading says of its analyzer when the analyzer's owner played in the game:
 * that the analyzer itself played, or that a player's analyzer read it; null for an independent reading.
 */
export function involvedNote(analysis: CommunityAnalysis, players: GamePlayers): string | null {
    if (!analysis.involved) return null;
    const name = analysis.analyzer?.name ?? null;
    const seated = name !== null && [players.x, players.o].some((seat) => seat.kind === `bot` && seat.deleted === undefined && seat.name === name);
    return name !== null && seated ? text.drawer.reading.involvedSelf(name) : text.drawer.reading.involvedOwner;
}

function communityChoice(analysis: CommunityAnalysis): ReadingChoice {
    return { kind: `community`, id: analysis.analysisId, name: analysis.analyzer?.name ?? ``, analysis };
}

function cardOf(
    line: GameLine,
    done: readonly CommunityAnalysis[],
    pending: CommunityAnalysis | undefined,
    failed: CommunityAnalysis | undefined,
    independentOnline: boolean,
): RequestCard | null {
    if (pending?.status === `queued`) return { kind: `queued`, ahead: Math.max(0, (pending.queuePosition ?? 1) - 1) };
    if (pending !== undefined) {
        const { done, of } = pending.progress;
        // The position under way is the one after those read; the last, the final board, belongs to the last turn.
        return { kind: `running`, analyzer: pending.analyzer, turn: Math.min(line.firstTurn + done, line.lastTurn), last: line.lastTurn, share: of === 0 ? 0 : done / of };
    }
    if (done.length > 0) return done.length === 1 && done[0]?.involved === true && independentOnline ? { kind: `independent` } : null;
    if (line.lastTurn < line.firstTurn) return { kind: `unreadable`, why: `unplayed` };
    if (line.lastTurn > analysisTurnCap) return { kind: `unreadable`, why: `too-long` };
    if (failed !== undefined) {
        const turn = failed.failedTurn === undefined ? null : Math.min(failed.failedTurn, line.lastTurn);
        // A failed reading always names its failure; one without is read as never taken.
        return { kind: `failed`, analyzer: failed.analyzer, cause: failed.failure ?? `expired`, turn };
    }
    return { kind: `none` };
}

/** Why a request for a reading was not taken, in the words the head has for it. */
export type RequestRefusal =
    | `analysis_limit`
    | `analysis_queue_full`
    | `pending_limit`
    | `no_analyzer`
    | `analysis_full`
    | `analysis_pending`
    | `not_analysable`
    | `opted_out`
    | `rate_limited`
    | `paused`
    | `signed_out`
    | `unavailable`;

/** A refused request's status and code as the head words it; a code it has no words for reads as the generic one. */
export function refusalOf(status: number, code: string | null): RequestRefusal {
    if (status === 401) return `signed_out`;
    if (status === 503) return `paused`;
    switch (code) {
        case `analysis_limit`:
        case `analysis_queue_full`:
        case `pending_limit`:
        case `no_analyzer`:
        case `analysis_full`:
        case `analysis_pending`:
        case `not_analysable`:
        case `opted_out`:
        case `rate_limited`:
            return code;
        default:
            return `unavailable`;
    }
}

/** Where a game's readings stand as read, and where the person's request stands. */
export interface AnalysesState {
    readonly load: { readonly kind: `loading` } | { readonly kind: `failed` } | { readonly kind: `ready`; readonly list: AnalysisList };
    readonly request: { readonly kind: `idle` } | { readonly kind: `sending` } | { readonly kind: `refused`; readonly code: RequestRefusal; readonly retryAfter: number | null };
}

/**
 * The list with a request just queued in it, before the next read confirms it;
 * a list read meanwhile that already holds it keeps one copy.
 */
export function withQueued(list: AnalysisList | null, analysis: CommunityAnalysis): AnalysisList {
    const held = list ?? { analyses: [], optedOut: false, independentOnline: false };
    const others = held.analyses.filter((reading) => reading.kind !== `community` || reading.analysisId !== analysis.analysisId);
    return { ...held, analyses: [...others, analysis] };
}

/** Whether the list holds a community reading still queued or running, which the page polls for. */
export function underWay(list: AnalysisList): boolean {
    return list.analyses.some((analysis) => analysis.kind === `community` && (analysis.status === `queued` || analysis.status === `running`));
}

// A refusal that says the list moved on since it was read: another
// request, an opt-out, or a reading done meanwhile.
const stale: readonly RequestRefusal[] = [`analysis_pending`, `analysis_full`, `opted_out`];

const idle: AnalysesState[`request`] = { kind: `idle` };

/**
 * A finished game's readings, read once `wanted`, and again at the contract's interval while one is under way;
 * a read that fails once a list is on screen keeps that list, so a missed poll never blanks the head.
 * `request` asks for a reading, by the analyzer named or by any, and `retry` reads the list again.
 * The drawer never asks for position readings: this reads only what is stored.
 */
export function useGameAnalyses(gameId: string, wanted: boolean): { state: AnalysesState; request: (analyzer: string | null) => void; retry: () => void } {
    const load = useCallback(async () => fetchAnalyses(gameId), [gameId]);
    const read = useAsync(load, { enabled: wanted, every: (list) => (underWay(list) ? analysesPollMs : null) });
    const [request, setRequest] = useState<AnalysesState[`request`]>(idle);
    const live = useRef(true);
    const { data: list, error, replace, reload } = read;

    useEffect(() => {
        live.current = true;
        return () => {
            live.current = false;
        };
    }, []);

    const ask = useCallback(
        (analyzer: string | null) => {
            setRequest({ kind: `sending` });
            requestAnalysis(gameId, analyzer).then(
                (analysis) => {
                    if (!live.current) return;
                    replace((held) => withQueued(held, analysis));
                    setRequest(idle);
                    // The day's count of requests left moved with this one.
                    void meStore.refresh();
                },
                (cause: unknown) => {
                    if (!live.current) return;
                    const code = cause instanceof ApiError ? refusalOf(cause.status, cause.code) : `unavailable`;
                    setRequest({ kind: `refused`, code, retryAfter: cause instanceof ApiError ? cause.retryAfter : null });
                    if (stale.includes(code)) reload();
                    if (code === `signed_out`) void meStore.refresh();
                },
            );
        },
        [gameId, replace, reload],
    );

    const state = useMemo<AnalysesState>(
        () => ({ load: list !== null ? { kind: `ready`, list } : error ? { kind: `failed` } : { kind: `loading` }, request }),
        [list, error, request],
    );
    return { state, request: ask, retry: reload };
}
