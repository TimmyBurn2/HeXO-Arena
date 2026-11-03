import { useCallback, useEffect, useRef, useState } from 'react';
import { internalToWire, sideOf, wireToInternal, type Side } from '@hexo-arena/contract';
import type { Setup, TurnCells } from '@hexo-arena/rules';
import { z } from 'zod';
import { playCells, type AnalysisState } from './state';
import { nodeAt, positionAt } from './tree';

/** Where the site serves the pinned mantis engine; scripts/mantis.mjs fetches it into that folder. */
export const mantisAssets = `/engines/mantis-0.1.0`;

/** What mantis spends on a turn: simulations a stone, or milliseconds a turn. */
export type MantisLevel = { readonly sims: number } | { readonly turnMs: number };

/** The levels on offer, named by budget alone until their strength is measured. */
export const mantisLevels: readonly MantisLevel[] = [{ sims: 32 }, { sims: 128 }, { sims: 512 }, { turnMs: 2000 }, { turnMs: 5000 }, { turnMs: 10000 }];

// The level a page starts on, and falls back to when a chosen clock no longer fits.
const defaultLevel: MantisLevel = { sims: 128 };

/** Why mantis is not playing: the browser cannot run it, it did not load, it refused the position, it crashed, or another error. */
export type MantisProblem = `unsupported` | `unloaded` | `position` | `crashed` | `failed`;

/** Mantis off (with what stopped it, if anything), loading its files, or playing a side. */
export type MantisMode =
    | { readonly kind: `off`; readonly problem: MantisProblem | null }
    | { readonly kind: `loading`; readonly seat: Side }
    | { readonly kind: `playing`; readonly seat: Side };

const infoSchema = z.object({ backend: z.enum([`webgpu`, `cpu`]), minTurnMs: z.number().nullable() });

/** What the engine says of itself: where its net runs, and the shortest turn clock it keeps. */
export type MantisInfo = z.infer<typeof infoSchema>;

const turnSchema = z.object({ stones: z.array(z.object({ cell: z.tuple([z.int(), z.int()]) })).max(2) });

type Wire = { q: number; r: number };

// The part of the engine's typed API this board drives.
interface Engine {
    info(): unknown;
    newGame(opening: { stones: (Wire & { p: 1 | -1 })[]; toMove: 1 | -1; stonesLeft: 1 | 2 }, clock: { unlimited: true }): Promise<unknown>;
    play(stones: Wire[]): Promise<unknown>;
    playTurn(budget: MantisLevel): Promise<unknown>;
    abort(): void;
    dispose(): void;
}

const moduleSchema = z.object({ createEngine: z.custom<(options: { assets: string; backend: `auto` }) => Promise<unknown>>((value) => typeof value === `function`) });

async function loadEngine(): Promise<Engine> {
    const assets = `${window.location.origin}${mantisAssets}`;
    const module = moduleSchema.parse(await import(/* @vite-ignore */ `${assets}/src/index.js`));
    // The module is the pinned release, whose createEngine resolves to the engine its types describe.
    return (await module.createEngine({ assets, backend: `auto` })) as Engine;
}

/** Whether mantis keeps this level's clock on this device: a time level only at or above the shortest clock it reports. */
export function levelFits(level: MantisLevel, info: MantisInfo | null): boolean {
    if (!(`turnMs` in level)) return true;
    return info?.minTurnMs !== null && info?.minTurnMs !== undefined && level.turnMs >= info.minTurnMs;
}

// The engine's position: its stones in the order played, x as 1, and the stones the mover still owes.
function openingOf(position: Setup) {
    return {
        stones: position.stones.map((stone) => ({ ...internalToWire(stone), p: stone.player === 0 ? (1 as const) : (-1 as const) })),
        toMove: position.toMove === 0 ? (1 as const) : (-1 as const),
        stonesLeft: position.stones.length === 0 ? (1 as const) : (2 as const),
    };
}

function problemOf(cause: unknown, stage: `load` | `position` | `turn`): MantisProblem | null {
    const name = cause instanceof Error ? cause.name : ``;
    if (name === `AbortError`) return null;
    if (name === `EngineCrashed`) return `crashed`;
    if (stage === `load`) return name === `Unsupported` || name === `NoBackendPassed` ? `unsupported` : `unloaded`;
    return stage === `position` ? `position` : `failed`;
}

/**
 * Mantis playing one side of the board in this browser: once started, it answers every position at the end of a line
 * where its side is to move, as a turn played into the tree; a change to the board aborts the turn it is thinking on.
 * Nothing reaches the site; the engine lives as long as the page.
 */
export function useMantis(board: AnalysisState, step: (move: (board: AnalysisState) => AnalysisState) => void) {
    const [mode, setMode] = useState<MantisMode>({ kind: `off`, problem: null });
    const [info, setInfo] = useState<MantisInfo | null>(null);
    const [chosen, setChosen] = useState<MantisLevel>(defaultLevel);
    const [thinking, setThinking] = useState(false);
    const loading = useRef<Promise<Engine> | null>(null);
    const engine = useRef<Engine | null>(null);
    // The key of the position the engine stands on, null when unknown.
    const synced = useRef<string | null>(null);
    // Engine calls run one at a time: a turn aborted for a new board settles before the next call.
    const queue = useRef<Promise<void>>(Promise.resolve());

    const level = levelFits(chosen, info) ? chosen : defaultLevel;

    useEffect(
        () => () => {
            void loading.current?.then(
                (loaded) => {
                    loaded.dispose();
                },
                () => undefined,
            );
        },
        [],
    );

    const start = useCallback((seat: Side) => {
        setMode({ kind: `loading`, seat });
        loading.current ??= loadEngine();
        void loading.current.then(
            (loaded) => {
                engine.current = loaded;
                setInfo(infoSchema.parse(loaded.info()));
                setMode((current) => (current.kind === `loading` ? { kind: `playing`, seat: current.seat } : current));
            },
            (cause: unknown) => {
                loading.current = null;
                setMode({ kind: `off`, problem: problemOf(cause, `load`) });
            },
        );
    }, []);

    const stop = useCallback(() => {
        setMode({ kind: `off`, problem: null });
    }, []);

    const seat = mode.kind === `playing` ? mode.seat : null;
    useEffect(() => {
        const live = engine.current;
        const { tree, at, mark } = board;
        const node = nodeAt(tree, at);
        if (seat === null || live === null || mark !== null || node === undefined || node.kind === `half` || node.children.length > 0) return;
        if (node.kind === `turn` && node.win !== null) return;
        const position = positionAt(tree, at);
        if (sideOf(position.toMove) !== seat) return;
        const parent = node.kind === `turn` ? nodeAt(tree, node.parent) : undefined;
        const left = new AbortController();
        // A call, so the check reads the signal anew after every await.
        const gone = () => left.signal.aborted;
        let stage: `position` | `turn` = `position`;
        const run = async () => {
            if (gone()) return;
            setThinking(true);
            if (node.kind === `turn` && parent !== undefined && synced.current === parent.key) {
                synced.current = null;
                await live.play(node.cells.map(internalToWire));
            } else if (synced.current !== node.key) {
                synced.current = null;
                await live.newGame(openingOf(position), { unlimited: true });
            }
            synced.current = node.key;
            if (gone()) return;
            stage = `turn`;
            const turn = turnSchema.parse(await live.playTurn(level));
            synced.current = null;
            setInfo(infoSchema.parse(live.info()));
            const [first, second] = turn.stones.map(({ cell: [q, r] }) => wireToInternal({ q, r }));
            if (first === undefined) throw new Error(`mantis played no stone`);
            const cells: TurnCells = second === undefined ? [first] : [first, second];
            const played = playCells(board, cells);
            if (played.refusal !== null) throw new Error(`mantis played no legal turn`);
            synced.current = nodeAt(played.state.tree, played.state.at)?.key ?? null;
            if (!gone()) step(() => played.state);
        };
        queue.current = queue.current
            .then(run)
            .catch((cause: unknown) => {
                const problem = problemOf(cause, stage);
                if (problem === null) return;
                synced.current = null;
                if (!gone()) setMode({ kind: `off`, problem });
            })
            .finally(() => {
                if (!gone()) setThinking(false);
            });
        return () => {
            left.abort();
            live.abort();
            setThinking(false);
        };
    }, [seat, board, step, level]);

    return { mode, info, level, setLevel: setChosen, thinking, start, stop };
}
