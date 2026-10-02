import {
    analysisGraceMs,
    bwsInterruptPacketSchema,
    bwsMoveRequestPacketSchema,
    bwsMoveResponsePacketSchema,
    bwsSetupPacketSchema,
    internalToWire,
    playerOf,
    wireToInternal,
    type AnalysisFailure,
    type BwsMoveResponsePacket,
    type HtttxMoveOption,
} from '@hexo-arena/contract';
import { playTurn, type Setup } from '@hexo-arena/rules';
import { z } from 'zod';
import type { EvaluationSource, ReadingLine } from './sources';

/** The part of a Worker, or of a MessagePort, an engine in the browser speaks through. */
export interface EnginePort {
    postMessage(message: unknown): void;
    addEventListener(type: `message`, listener: (event: MessageEvent) => void): void;
    removeEventListener(type: `message`, listener: (event: MessageEvent) => void): void;
    /** A MessagePort delivers nothing to its listeners until started; a Worker has no such step. */
    start?: () => void;
}

// The htttx basic_websocket capabilities an engine must declare to read any
// position: a fresh setup per position, either side to move, answers
// matched by request_id, and a request it can drop.
const required = [`free_setup`, `resettable_state`, `dual_sided`, `request_id`, `interruptible`] as const;

const capabilitiesSchema = z.object({
    meta: z.object({ version: z.string().max(64).optional() }).optional(),
    basic_websocket: z
        .object({ versions: z.object({ 'v1-alpha': z.object(Object.fromEntries(required.map((name) => [name, z.boolean().optional()]))).optional() }) })
        .optional(),
});

/** The seconds a deepening reading answers at on its way to the seconds asked. */
export const deepeningSeconds = [0.25, 0.5, 1, 2] as const;

type Answer = { readonly kind: `answer`; readonly packet: BwsMoveResponsePacket } | { readonly kind: `timeout` } | { readonly kind: `aborted` };

interface Session {
    readonly port: EnginePort;
    readonly version: string;
    nextId: number;
    readonly waiting: Map<number, (packet: BwsMoveResponsePacket) => void>;
}

/**
 * An engine in the browser read through htttx's basic_websocket client shapes over `postMessage`:
 * it posts its capabilities first, and each position is a fresh setup and a move request,
 * asked again at each deepening step up to the seconds asked, every answer but the last not final;
 * leaving a position interrupts the request out.
 * Its lines are held to the rules: a move that is no legal turn, or carries no evaluation, fails the reading,
 * and a consideration that is either is dropped.
 */
export function workerSource({ connect, engine, now = Date.now }: { connect: () => EnginePort; engine: string; now?: () => number }): EvaluationSource {
    let session: Promise<Session> | null = null;

    function open(): Promise<Session> {
        session ??= new Promise<Session>((resolve, reject) => {
            const port = connect();
            let opened: Session | null = null;
            port.addEventListener(`message`, (event) => {
                if (opened === null) {
                    const capabilities = capabilitiesSchema.safeParse(event.data);
                    const declared = capabilities.success ? capabilities.data.basic_websocket?.versions[`v1-alpha`] : undefined;
                    if (declared === undefined || required.some((name) => declared[name] !== true)) {
                        reject(new Error(`the engine lacks a capability analysis needs`));
                        return;
                    }
                    opened = { port, version: capabilities.data?.meta?.version ?? ``, nextId: 1, waiting: new Map() };
                    resolve(opened);
                    return;
                }
                const packet = bwsMoveResponsePacketSchema.safeParse(event.data);
                if (!packet.success || packet.data.request_id === undefined) return;
                opened.waiting.get(packet.data.request_id)?.(packet.data);
            });
            port.start?.();
        });
        return session;
    }

    function answer(live: Session, id: number, ms: number, signal: AbortSignal): Promise<Answer> {
        return new Promise((resolve) => {
            const done = (result: Answer) => {
                clearTimeout(timer);
                signal.removeEventListener(`abort`, aborted);
                live.waiting.delete(id);
                resolve(result);
            };
            const aborted = () => {
                done({ kind: `aborted` });
            };
            const timer = setTimeout(() => {
                done({ kind: `timeout` });
            }, ms);
            signal.addEventListener(`abort`, aborted, { once: true });
            live.waiting.set(id, (packet) => {
                done({ kind: `answer`, packet });
            });
        });
    }

    return {
        id: `worker:${engine}`,
        label: engine,
        runs: `auto`,
        async *read(position, ask, signal) {
            yield { kind: `thinking` };
            let live: Session;
            try {
                live = await open();
            } catch {
                if (!signal.aborted) yield { kind: `failed`, code: `protocol`, by: null };
                return;
            }
            const setup: Setup = { stones: position.cells.map((cell) => ({ x: cell.x, y: cell.y, player: playerOf(cell.side) })), toMove: playerOf(position.toMove) };
            const cells = position.cells.map((cell) => ({ ...internalToWire(cell), p: cell.side }));
            const steps = [...deepeningSeconds.filter((seconds) => seconds < ask.seconds), ask.seconds];
            const started = now();
            for (const [index, seconds] of steps.entries()) {
                if (signal.aborted) return;
                const id = live.nextId;
                live.nextId += 1;
                live.port.postMessage(bwsSetupPacketSchema.parse({ type: `setup`, board: { cells } }));
                live.port.postMessage(bwsMoveRequestPacketSchema.parse({ type: `move_request`, side: position.toMove, previous: [], move_time_limit: seconds, request_id: id }));
                const answered = await answer(live, id, seconds * 1000 + analysisGraceMs, signal);
                if (answered.kind !== `answer`) {
                    live.port.postMessage(bwsInterruptPacketSchema.parse({ type: `interrupt`, request_id: id }));
                    if (answered.kind === `timeout`) yield { kind: `failed`, code: `timeout`, by: null };
                    return;
                }
                const lines = linesOf(setup, answered.packet, ask.lines);
                if (!lines.ok) {
                    yield { kind: `failed`, code: lines.failure, by: null };
                    return;
                }
                yield {
                    kind: `reading`,
                    reading: { by: { kind: `worker`, engine, version: live.version }, lines: lines.lines, seconds, final: index === steps.length - 1, elapsedMs: now() - started },
                };
            }
        },
    };
}

type Lines = { readonly ok: true; readonly lines: ReadingLine[] } | { readonly ok: false; readonly failure: AnalysisFailure };

// The move, then the considerations that are legal turns with an evaluation, no turn twice, `count` at most.
function linesOf(setup: Setup, packet: BwsMoveResponsePacket, count: number): Lines {
    const move = lineOf(setup, packet.move);
    if (typeof move === `string`) return { ok: false, failure: move };
    const lines = [move];
    for (const option of packet.considerations ?? []) {
        if (lines.length >= count) break;
        const line = lineOf(setup, option);
        if (typeof line === `string` || lines.some((each) => samePair(each, line))) continue;
        lines.push(line);
    }
    return { ok: true, lines };
}

// A line, or why it is none: no legal turn, or no evaluation of the board after it.
function lineOf(setup: Setup, option: HtttxMoveOption): ReadingLine | Extract<AnalysisFailure, `illegal` | `no_evaluation`> {
    const [first, second] = option.pieces.map(wireToInternal);
    if (first === undefined || second === undefined) return `illegal`;
    const turn = playTurn(setup, [first]).ok || playTurn(setup, [first, second]).ok;
    if (!turn) return `illegal`;
    const evaluation = option.evaluation;
    if (evaluation === undefined || (evaluation.heuristic === undefined && evaluation.win_in === undefined)) return `no_evaluation`;
    return { cells: [first, second], evaluation };
}

function samePair(a: ReadingLine, b: ReadingLine): boolean {
    return a.cells.every((cell) => b.cells.some((other) => other.x === cell.x && other.y === cell.y));
}
