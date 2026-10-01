import {
    bwsHeartbeatPacketSchema,
    bwsMoveRequestPacketSchema,
    bwsSetupPacketSchema,
    internalToWire,
    playerOf,
    wireToInternal,
    type BwsMoveRequestPacket,
} from '@hexo-arena/contract';
import { lineAxes, place, playerToMove, type Coord, type Position } from '@hexo-arena/rules';
import { z } from 'zod';

// Everything the server may send on an engine session.
const inboundSchema = z.discriminatedUnion(`type`, [
    bwsSetupPacketSchema,
    bwsMoveRequestPacketSchema,
    bwsHeartbeatPacketSchema,
]);

// The steps to the six cells around a stone.
const neighbours: readonly Coord[] = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: -1, y: 1 },
];

/** How a dev bot picks its turns: at random next to the stones, or greedily along its longest line. */
export type Strategy = `random` | `greedy`;

function keyOf(cell: Coord): string {
    return `${String(cell.x)},${String(cell.y)}`;
}

// Any cell next to a stone lies inside the placement radius,
// so every cell here is legal whatever else the turn places.
function openCells(position: Position): Coord[] {
    const taken = new Set(position.stones.map(keyOf));
    const open = new Map<string, Coord>();
    for (const stone of position.stones) {
        for (const step of neighbours) {
            const cell = { x: stone.x + step.x, y: stone.y + step.y };
            if (!taken.has(keyOf(cell))) open.set(keyOf(cell), cell);
        }
    }
    return [...open.values()];
}

/**
 * Two distinct empty cells, each touching a placed stone, drawn at random.
 * A first stone that wins ends the turn and the server ignores the second.
 */
export function chooseTurn(position: Position, random: () => number): [Coord, Coord] {
    const cells = openCells(position);
    const first = cells.splice(Math.floor(random() * cells.length), 1)[0];
    const second = cells[Math.floor(random() * cells.length)];
    if (first === undefined || second === undefined) throw new Error(`no two open cells next to the stones`);
    return [first, second];
}

// The longest line of the owned cells through this one, counting it.
function runThrough(owned: ReadonlySet<string>, cell: Coord): number {
    let longest = 0;
    for (const axis of lineAxes) {
        let run = 1;
        for (const sign of [1, -1]) {
            let step = 1;
            while (owned.has(keyOf({ x: cell.x + sign * step * axis.x, y: cell.y + sign * step * axis.y }))) step += 1;
            run += step - 1;
        }
        longest = Math.max(longest, run);
    }
    return longest;
}

// A win first, then a block of a line one stone short of six, then the
// longest own line, with the opponent's line as the tiebreak.
function greedyCell(position: Position, random: () => number): Coord {
    const me = playerToMove(position);
    const mine = new Set(position.stones.filter((stone) => stone.player === me).map(keyOf));
    const theirs = new Set(position.stones.filter((stone) => stone.player !== me).map(keyOf));
    let best: Coord[] = [];
    let bestScore = -1;
    for (const cell of openCells(position)) {
        const own = runThrough(mine, cell);
        const other = runThrough(theirs, cell);
        const score = own >= 6 ? 1_000 : other >= 6 ? 500 : own * 10 + other;
        if (score > bestScore) {
            best = [cell];
            bestScore = score;
        } else if (score === bestScore) {
            best.push(cell);
        }
    }
    const chosen = best[Math.floor(random() * best.length)];
    if (chosen === undefined) throw new Error(`no open cell next to the stones`);
    return chosen;
}

/** A turn that extends the mover's longest line, completing six whenever one stone can. */
export function chooseGreedyTurn(position: Position, random: () => number): [Coord, Coord] {
    const first = greedyCell(position, random);
    const placed = place(position, first);
    if (!placed.ok) throw new Error(`the greedy cell is illegal: ${placed.rejection.kind}`);
    if (placed.win !== null) {
        const spare = openCells(placed.position)[0];
        if (spare === undefined) throw new Error(`no open cell next to the stones`);
        return [first, spare];
    }
    return [first, greedyCell(placed.position, random)];
}

function applyPrevious(position: Position, previous: BwsMoveRequestPacket[`previous`]): Position {
    let next = position;
    for (const move of previous) {
        for (const piece of move.pieces) {
            const placed = place(next, wireToInternal(piece));
            if (!placed.ok) throw new Error(`the server sent an illegal move: ${placed.rejection.kind}`);
            next = placed.position;
        }
    }
    return next;
}

/** How one game's engine session plays and reports. */
export interface PlayOptions {
    url: string;
    strategy: Strategy;
    random: () => number;
    // A pause before each answer, so a watcher can follow the game.
    thinkMs: () => number;
    log: (line: string) => void;
    closed: () => void;
}

/** A live engine session; close ends it from this side. */
export interface EngineSession {
    close(): void;
}

/**
 * Dials a game's engine session and answers every move request with a
 * turn its strategy picks, echoing its request id.
 * The board is rebuilt from the setup and each request's `previous`, which
 * carries every turn this connection has not seen, the bot's own included.
 */
export function playGame(options: PlayOptions): EngineSession {
    const socket = new WebSocket(options.url);
    const pending = new Set<ReturnType<typeof setTimeout>>();
    let position: Position = { stones: [] };

    function answer(request: BwsMoveRequestPacket): void {
        position = applyPrevious(position, request.previous);
        const cells = (options.strategy === `greedy` ? chooseGreedyTurn : chooseTurn)(position, options.random);
        // The limit is in seconds; pausing at most a quarter of it leaves
        // the rest for the network, so thinking never loses on time.
        const limitMs = request.move_time_limit === undefined ? Infinity : request.move_time_limit * 250;
        const timer = setTimeout(() => {
            pending.delete(timer);
            if (socket.readyState !== WebSocket.OPEN) return;
            socket.send(
                JSON.stringify({
                    type: `move_response`,
                    move: { pieces: cells.map((cell) => internalToWire(cell)) },
                    ...(request.request_id !== undefined && { request_id: request.request_id }),
                }),
            );
        }, Math.min(options.thinkMs(), limitMs));
        pending.add(timer);
    }

    socket.addEventListener(`message`, (event) => {
        try {
            const packet = inboundSchema.parse(JSON.parse(String(event.data)));
            switch (packet.type) {
                case `setup`:
                    position = {
                        stones: packet.board.cells.map((cell) => ({ ...wireToInternal(cell), player: playerOf(cell.p) })),
                    };
                    return;
                case `move_request`:
                    answer(packet);
                    return;
                // bws obliges an idle bot that is waited on to hang up;
                // this one answers every request within its pause, so it is
                // never idle while waited on.
                case `heartbeat`:
                    return;
                default: {
                    const unknown: never = packet;
                    return unknown;
                }
            }
        } catch (error) {
            options.log(`engine session dropped: ${error instanceof Error ? error.message : String(error)}`);
            socket.close();
        }
    });
    socket.addEventListener(`close`, () => {
        for (const timer of pending) clearTimeout(timer);
        pending.clear();
        options.closed();
    });
    // A refused dial and a dropped connection both land here.
    socket.addEventListener(`error`, () => {
        options.log(`engine session failed`);
    });

    return {
        close: () => {
            socket.close();
        },
    };
}
