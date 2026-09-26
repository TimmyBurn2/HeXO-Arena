import { useEffect, useMemo, useState } from 'react';
import type { GameSnapshot } from '@hexarena/contract';
import { ApiError, fetchGameSnapshot, playHumanMove, resignGame } from '../api/client';
import type { AxialCoord } from '@hexarena/contract';

// The snapshot poll while a game runs; the read-only live channel replaces
// it later with no layout change.
const pollMs = 2000;

export type GameLoad =
    | { state: `loading` }
    | { state: `missing` }
    | { state: `error`; retry: () => void }
    // stale: the last read failed; the board keeps the last snapshot while
    // the poll retries.
    | { state: `ready`; snapshot: GameSnapshot; send: GameSend; stale: boolean };

export interface GameSend {
    playMove: (cells: readonly [AxialCoord, AxialCoord]) => Promise<boolean>;
    resign: () => Promise<void>;
}

/**
 * One game against the snapshot API: fetch, poll while in-progress, and
 * the two actions that answer with the next snapshot.
 */
export function useGame(gameId: string): GameLoad {
    const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
    const [missing, setMissing] = useState(false);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        setMissing(false);
        setFailed(false);

        async function run() {
            try {
                const next = await fetchGameSnapshot(gameId);
                if (cancelled) return;
                setSnapshot(next);
                setFailed(false);
                if (next.status === `in-progress`) {
                    timer = setTimeout(() => {
                        void run();
                    }, pollMs);
                }
            } catch (cause) {
                if (cancelled) return;
                if (cause instanceof ApiError && cause.status === 404) {
                    setMissing(true);
                    return;
                }
                setFailed(true);
                timer = setTimeout(() => {
                    void run();
                }, pollMs);
            }
        }

        void run();
        return () => {
            cancelled = true;
            if (timer !== null) clearTimeout(timer);
        };
    }, [gameId, attempt]);

    const send = useMemo<GameSend>(
        () => ({
            playMove: async (cells) => {
                try {
                    setSnapshot(await playHumanMove(gameId, cells));
                    return true;
                } catch {
                    setFailed(true);
                    return false;
                }
            },
            resign: async () => {
                try {
                    setSnapshot(await resignGame(gameId));
                } catch {
                    setFailed(true);
                }
            },
        }),
        [gameId],
    );

    if (missing) return { state: `missing` };
    if (snapshot === null) {
        if (failed) {
            return {
                state: `error`,
                retry: () => {
                    setAttempt((current) => current + 1);
                },
            };
        }
        return { state: `loading` };
    }
    return { state: `ready`, snapshot, send, stale: failed };
}
