import { internalToWire, type BwsMoveRequestPacket, type HtttxCell } from '@hexo-arena/contract';
import type { EnginePort } from '../src/analysis/worker-source';

/** The capabilities an engine able to read any position declares, as its capabilities.json would. */
export const analysisCapabilities = {
    meta: { name: `toy`, version: `0.3` },
    basic_websocket: { versions: { 'v1-alpha': { free_setup: true, resettable_state: true, dual_sided: true, request_id: true, interruptible: true, move_time_limit: true } } },
};

/** What the toy engine heard and how it answers. */
export interface ToyEngine {
    readonly port: EnginePort;
    readonly setups: HtttxCell[][];
    readonly requests: BwsMoveRequestPacket[];
    readonly interrupts: (number | undefined)[];
}

/**
 * A test-only engine on the far end of a MessageChannel, playing htttx's bot role:
 * it posts `capabilities` first, then answers each move_request for its request_id after `delayMs`,
 * its move and considerations from `answer`, and drops a request it is told to interrupt.
 */
export function toyEngine({
    capabilities = analysisCapabilities,
    delayMs = 5,
    answer,
}: {
    capabilities?: unknown;
    delayMs?: number;
    answer: (request: BwsMoveRequestPacket, setup: HtttxCell[]) => object | null;
}): ToyEngine {
    const channel = new MessageChannel();
    const engine = channel.port2;
    const heard: ToyEngine = { port: channel.port1, setups: [], requests: [], interrupts: [] };
    const pending = new Map<number | undefined, ReturnType<typeof setTimeout>>();
    let board: HtttxCell[] = [];
    engine.addEventListener(`message`, (event: MessageEvent) => {
        // The packets come from the source under test, which builds them from the contract's schemas.
        const packet = event.data as { type: string; board?: { cells: HtttxCell[] }; request_id?: number };
        if (packet.type === `setup`) {
            board = packet.board?.cells ?? [];
            heard.setups.push(board);
        } else if (packet.type === `move_request`) {
            // The same packet, read as the move request it says it is.
            const request = event.data as BwsMoveRequestPacket;
            heard.requests.push(request);
            const setup = board;
            pending.set(
                request.request_id,
                setTimeout(() => {
                    const reply = answer(request, setup);
                    if (reply !== null) engine.postMessage({ type: `move_response`, ...reply, request_id: request.request_id });
                }, delayMs),
            );
        } else if (packet.type === `interrupt`) {
            heard.interrupts.push(packet.request_id);
            clearTimeout(pending.get(packet.request_id));
        }
    });
    engine.start();
    engine.postMessage(capabilities);
    return heard;
}

/** A pair of engine cells as wire pieces. */
export function pieces(...cells: { x: number; y: number }[]): { q: number; r: number }[] {
    return cells.map(internalToWire);
}
