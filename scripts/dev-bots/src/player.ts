import {
    bwsHeartbeatPacketSchema,
    bwsMoveRequestPacketSchema,
    bwsSetupPacketSchema,
    internalToWire,
    playerOf,
    wireToInternal,
    type BwsMoveRequestPacket,
} from '@hexarena/contract';
import { place, type Coord, type Position } from '@hexarena/rules';
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

/**
 * Two distinct empty cells, each touching a placed stone, drawn at random.
 * Any cell next to a stone lies inside the placement radius, so both are
 * legal whatever the first one does; a first stone that wins ends the turn
 * and the server ignores the second.
 */
export function chooseTurn(position: Position, random: () => number): [Coord, Coord] {
    const taken = new Set(position.stones.map((stone) => `${String(stone.x)},${String(stone.y)}`));
    const open = new Map<string, Coord>();
    for (const stone of position.stones) {
        for (const step of neighbours) {
            const cell = { x: stone.x + step.x, y: stone.y + step.y };
            const key = `${String(cell.x)},${String(cell.y)}`;
            if (!taken.has(key)) open.set(key, cell);
        }
    }
    const cells = [...open.values()];
    const first = cells.splice(Math.floor(random() * cells.length), 1)[0];
    const second = cells[Math.floor(random() * cells.length)];
    if (first === undefined || second === undefined) throw new Error(`no two open cells next to the stones`);
    return [first, second];
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
 * random turn next to the stones, echoing its request id.
 * The board is rebuilt from the setup and each request's `previous`, which
 * carries every turn this connection has not seen, the bot's own included.
 */
export function playGame(options: PlayOptions): EngineSession {
    const socket = new WebSocket(options.url);
    const pending = new Set<ReturnType<typeof setTimeout>>();
    let position: Position = { stones: [] };

    function answer(request: BwsMoveRequestPacket): void {
        position = applyPrevious(position, request.previous);
        const cells = chooseTurn(position, options.random);
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
