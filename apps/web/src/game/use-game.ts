import { useEffect, useMemo, useRef, useState } from 'react';
import {
    gameFinishSchema,
    gameSnapshotSchema,
    gameTurnSchema,
    watcherRetryAfterSeconds,
    type AxialCoord,
    type GameSnapshot,
} from '@hexo-arena/contract';
import type { ZodType } from 'zod';
import { ApiError, fetchGameSnapshot, gameEventsUrl, playHumanMove, resignGame } from '../api/client';
import { applyFinish, applyTurn, laterOf } from './live';

// A refused or broken stream reopens after this, doubling per failure up
// to the watcher Retry-After, since EventSource never says which it was.
const reopenMs = 2_000;
const reopenCapMs = watcherRetryAfterSeconds * 1000;

/**
 * The stream's state: up; lost, with the browser or the reopen timer
 * retrying; or refused while a plain read still answers, which for a
 * watcher means the watcher cap is full.
 * Either way down, the board keeps the last snapshot until a fresh one
 * arrives on reconnect.
 */
export type GameLink = `up` | `lost` | `refused`;

export type GameLoad =
    | { state: `loading` }
    | { state: `missing` }
    | { state: `error`; retry: () => void }
    | { state: `ready`; snapshot: GameSnapshot; send: GameSend; link: GameLink };

export interface GameSend {
    playMove: (cells: readonly [AxialCoord, AxialCoord]) => Promise<boolean>;
    resign: () => Promise<boolean>;
}

function parsed<T>(schema: ZodType<T>, message: Event): T | null {
    if (!(message instanceof MessageEvent) || typeof message.data !== `string`) return null;
    try {
        const result = schema.safeParse(JSON.parse(message.data));
        return result.success ? result.data : null;
    } catch {
        return null;
    }
}

/**
 * One game on its live event stream: the snapshot on open, then turns and
 * the finish as they land; a reconnect's fresh snapshot is the resync.
 * A seated player's two actions answer with the next snapshot at once.
 */
export function useGame(gameId: string): GameLoad {
    const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
    const [missing, setMissing] = useState(false);
    const [link, setLink] = useState<GameLink>(`up`);
    const [attempt, setAttempt] = useState(0);
    const held = useRef<GameSnapshot | null>(null);

    useEffect(() => {
        let cancelled = false;
        let source: EventSource | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let backoff = reopenMs;
        held.current = null;
        setSnapshot(null);
        setMissing(false);
        setLink(`up`);

        function commit(next: GameSnapshot) {
            held.current = next;
            setSnapshot(next);
        }

        function stop() {
            source?.close();
            source = null;
        }

        function open() {
            const opened = new EventSource(gameEventsUrl(gameId));
            source = opened;
            opened.addEventListener(`snapshot`, (message) => {
                const next = parsed(gameSnapshotSchema, message);
                if (next === null) return;
                backoff = reopenMs;
                commit(next);
                setLink(`up`);
                if (next.status === `finished`) stop();
            });
            opened.addEventListener(`turn`, (message) => {
                const turn = parsed(gameTurnSchema, message);
                const current = held.current;
                if (turn === null || current === null) return;
                const fit = applyTurn(current, turn);
                if (fit.kind === `applied`) commit(fit.snapshot);
                if (fit.kind === `gap`) {
                    stop();
                    open();
                }
            });
            opened.addEventListener(`finish`, (message) => {
                const finish = parsed(gameFinishSchema, message);
                const current = held.current;
                if (finish === null || current === null) return;
                commit(applyFinish(current, finish));
                stop();
            });
            // A dropped connection reconnects on its own; a refused one
            // closes for good, so a plain read tells a missing game from
            // a busy or restarting server before the stream reopens.
            opened.onerror = () => {
                if (source !== opened) return;
                setLink(`lost`);
                if (opened.readyState !== EventSource.CLOSED) return;
                stop();
                void recover();
            };
        }

        async function recover() {
            try {
                const next = await fetchGameSnapshot(gameId);
                if (cancelled) return;
                commit(laterOf(held.current, next));
                if (next.status === `finished`) {
                    setLink(`up`);
                    return;
                }
                setLink(`refused`);
            } catch (cause) {
                if (cancelled) return;
                if (cause instanceof ApiError && cause.status === 404) {
                    setMissing(true);
                    return;
                }
            }
            timer = setTimeout(open, backoff);
            backoff = Math.min(backoff * 2, reopenCapMs);
        }

        open();
        return () => {
            cancelled = true;
            stop();
            if (timer !== null) clearTimeout(timer);
        };
    }, [gameId, attempt]);

    const send = useMemo<GameSend>(
        () => ({
            playMove: async (cells) => {
                try {
                    const next = laterOf(held.current, await playHumanMove(gameId, cells));
                    held.current = next;
                    setSnapshot(next);
                    return true;
                } catch {
                    return false;
                }
            },
            resign: async () => {
                try {
                    const next = laterOf(held.current, await resignGame(gameId));
                    held.current = next;
                    setSnapshot(next);
                    return true;
                } catch {
                    return false;
                }
            },
        }),
        [gameId],
    );

    if (missing) return { state: `missing` };
    if (snapshot === null) {
        if (link !== `up`) {
            return {
                state: `error`,
                retry: () => {
                    setAttempt((current) => current + 1);
                },
            };
        }
        return { state: `loading` };
    }
    return { state: `ready`, snapshot, send, link };
}
