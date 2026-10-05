import {
    bwsHeartbeatPacketSchema,
    bwsInterruptPacketSchema,
    bwsMoveRequestPacketSchema,
    bwsSetupPacketSchema,
    internalToWire,
    playerOf,
    wireToInternal,
    type AnalyzerDeclaration,
    type HtttxMoveOption,
} from '@hexo-arena/contract';
import { lineAxes, openWindows, otherPlayer, playerToMove, playTurn, type Coord, type Player, type Setup, type Stone } from '@hexo-arena/rules';
import { z } from 'zod';
import { chooseGreedyTurn, chooseTurn } from './player';

/** The analyzer the toy reader declares: three lines, five seconds at most, read between and during games. */
export const devAnalyzer: AnalyzerDeclaration = { lines: 3, maxSeconds: 5, whilePlaying: true };

// Everything the server may send on an analysis session.
const inboundSchema = z.discriminatedUnion(`type`, [bwsSetupPacketSchema, bwsMoveRequestPacketSchema, bwsHeartbeatPacketSchema, bwsInterruptPacketSchema]);

function keyOf(cell: Coord): string {
    return `${String(cell.x)},${String(cell.y)}`;
}

// The longest run of one player's stones on any axis, at most six.
function longestRun(stones: readonly Stone[], player: Player): number {
    const owned = new Set(stones.filter((stone) => stone.player === player).map(keyOf));
    let longest = 0;
    for (const stone of stones) {
        if (stone.player !== player) continue;
        for (const axis of lineAxes) {
            if (owned.has(keyOf({ x: stone.x - axis.x, y: stone.y - axis.y }))) continue;
            let run = 1;
            while (run < 6 && owned.has(keyOf({ x: stone.x + run * axis.x, y: stone.y + run * axis.y }))) run += 1;
            longest = Math.max(longest, run);
        }
    }
    return longest;
}

// x counts positive, as htttx's evaluations do.
function signOf(player: Player): 1 | -1 {
    return player === 0 ? 1 : -1;
}

/**
 * The evaluation of the board after a turn: the mover's line against the
 * other's, in sixths; a turn that leaves the other side six to complete is
 * the other side's, and one that completes six is the mover's.
 */
function evaluate(setup: Setup, cells: readonly [Coord, Coord]): number | null {
    const mover = setup.toMove;
    const first = playTurn(setup, [cells[0]]);
    if (first.ok) return signOf(mover);
    const turn = playTurn(setup, cells);
    if (!turn.ok) return null;
    if (turn.win !== null) return signOf(mover);
    const after = turn.setup.stones;
    const other = otherPlayer(mover);
    if (openWindows(after, other).length > 0) return -0.9 * signOf(mover);
    const lead = (longestRun(after, mover) - longestRun(after, other)) / 6;
    return Math.round(lead * 0.8 * signOf(mover) * 100) / 100;
}

// A turn that completes six when the side to move can: a window's empty
// cells, one of them free to spare when a single stone suffices.
function winningTurn(setup: Setup): [Coord, Coord] | null {
    const window = openWindows(setup.stones, setup.toMove)[0];
    if (window === undefined) return null;
    const [first, second] = window.empty;
    if (first === undefined) return null;
    if (second !== undefined) return [first, second];
    const spare = chooseTurn({ stones: setup.stones }, () => 0).find((cell) => keyOf(cell) !== keyOf(first));
    return spare === undefined ? null : [first, spare];
}

/**
 * Up to `lines` distinct legal turns from the position, best first, each
 * with an evaluation the board bears out: a six whenever the side to move
 * can complete one, then the greedy turn, then random ones, ranked by value.
 */
export function readPosition(setup: Setup, lines: number, random: () => number): HtttxMoveOption[] {
    const candidates: [Coord, Coord][] = [];
    const seen = new Set<string>();
    const add = (cells: [Coord, Coord] | null) => {
        if (cells === null) return;
        const pair = [keyOf(cells[0]), keyOf(cells[1])].sort().join(`|`);
        if (cells[0].x === cells[1].x && cells[0].y === cells[1].y) return;
        if (seen.has(pair)) return;
        seen.add(pair);
        candidates.push(cells);
    };
    const winning = winningTurn(setup);
    add(winning);
    const position = { stones: setup.stones };
    // The greedy choice reads the side to move from the stone count, which a set-up board need not keep.
    if (playerToMove(position) === setup.toMove) add(chooseGreedyTurn(position, random));
    for (let tries = 0; candidates.length < lines + 2 && tries < 12; tries += 1) add(chooseTurn(position, random));
    const valued = candidates.flatMap((cells) => {
        const value = evaluate(setup, cells);
        return value === null ? [] : [{ cells, value }];
    });
    const mover = signOf(setup.toMove);
    const [best, ...rest] = winning === null ? valued.sort((a, b) => b.value * mover - a.value * mover) : valued;
    if (best === undefined) return [];
    return [best, ...rest.sort((a, b) => b.value * mover - a.value * mover)].slice(0, lines).map(({ cells, value }) => ({
        pieces: cells.map((cell) => internalToWire(cell)),
        evaluation: { heuristic: value },
    }));
}

// How the toy reader answers and reports.
interface AnalyzeOptions {
    url: string;
    lines: number;
    random: () => number;
    // A pause before each answer, so a person sees the reading arrive.
    thinkMs: () => number;
    log: (line: string) => void;
    closed: () => void;
}

/** An open analysis session; close ends it from this side. */
export interface AnalysisSession {
    close(): void;
}

/**
 * Dials the bot's analysis session and answers each position with its
 * lines, within the seconds given, dropping a request the server interrupts.
 */
export function analyze(options: AnalyzeOptions): AnalysisSession {
    const socket = new WebSocket(options.url);
    let setup: Setup | null = null;
    let pending: { readonly requestId: number | undefined; readonly timer: ReturnType<typeof setTimeout> } | null = null;

    const drop = () => {
        if (pending !== null) clearTimeout(pending.timer);
        pending = null;
    };

    socket.addEventListener(`message`, (event) => {
        try {
            const packet = inboundSchema.parse(JSON.parse(String(event.data)));
            switch (packet.type) {
                case `setup`:
                    drop();
                    setup = { stones: packet.board.cells.map((cell) => ({ ...wireToInternal(cell), player: playerOf(cell.p) })), toMove: 0 };
                    return;
                case `move_request`: {
                    if (setup === null) throw new Error(`a move request came before any setup`);
                    const position: Setup = { stones: setup.stones, toMove: playerOf(packet.side) };
                    const limitMs = packet.move_time_limit === undefined ? Infinity : packet.move_time_limit * 250;
                    const requestId = packet.request_id;
                    drop();
                    pending = {
                        requestId,
                        timer: setTimeout(() => {
                            pending = null;
                            const [move, ...considerations] = readPosition(position, options.lines, options.random);
                            if (move === undefined || socket.readyState !== WebSocket.OPEN) return;
                            socket.send(JSON.stringify({ type: `move_response`, move, considerations, ...(requestId === undefined ? {} : { request_id: requestId }) }));
                        }, Math.min(options.thinkMs(), limitMs)),
                    };
                    return;
                }
                case `interrupt`:
                    if (pending?.requestId === packet.request_id) drop();
                    return;
                // Every request is answered within its pause, so the reader is never idle while waited on.
                case `heartbeat`:
                    return;
                default: {
                    const unknown: never = packet;
                    return unknown;
                }
            }
        } catch (error) {
            options.log(`analysis session dropped: ${error instanceof Error ? error.message : String(error)}`);
            socket.close();
        }
    });
    socket.addEventListener(`close`, () => {
        drop();
        options.closed();
    });
    socket.addEventListener(`error`, () => {
        options.log(`analysis session failed`);
    });
    return {
        close: () => {
            socket.close();
        },
    };
}
