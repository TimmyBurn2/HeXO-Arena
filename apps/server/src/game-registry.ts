import {
    bwsHeartbeatPacketSchema,
    bwsMoveRequestPacketSchema,
    bwsMoveResponsePacketSchema,
    bwsSetupPacketSchema,
    botGameSocketPath,
    htttxMoveRequestSchema,
    internalToWire,
    sideOf,
    wireToInternal,
    type FinishReason,
    type FirstPlayer,
    type GameClock,
    type GameSnapshot,
    type Side,
    type StreamEvent,
    type TimeControl,
} from '@hexarena/contract';
import {
    emptyPosition,
    hexDistance,
    place,
    playerToMove,
    type Coord,
    type Position,
    type Rejection,
    type Win,
} from '@hexarena/rules';
import type { Query } from './db';
import {
    findGame,
    insertBotGame,
    insertGame,
    insertMove,
    recordFinish,
    replayPosition,
} from './game-store';
import type { PresenceRegistry } from './presence';
import { randomFloat } from './random';
import { randomToken } from './tokens';

export const botConcurrentGameCap = 4;
export const humanConcurrentGameCap = 3;
export const humanGameCooldownSeconds = 60;
export const orphanForfeitMs = 30_000;
export const sessionTokenTtlMs = 60_000;
export const sessionHeartbeatMs = 10_000;
export const unlimitedWallCapMs = 24 * 60 * 60 * 1000;

// Opening stones land within this distance of the origin, so every opening
// is compact and the first player turn starts in a known neighbourhood.
const openingRadius = 2;

type Timer = ReturnType<typeof setTimeout>;

// The subset of the ws socket the game layer needs, so the engine session
// is unit-testable against a plain fake.
export interface EngineSocket {
    send(text: string): void;
    close(code?: number, reason?: string): void;
    onceClose(listener: () => void): void;
}

interface Session {
    readonly socket: EngineSocket;
    readonly heartbeat: ReturnType<typeof setInterval>;
}

interface SessionToken {
    readonly token: string;
    readonly expiresAt: number;
}

// A two-placement turn that was played or server-placed; the log doubles
// as the `previous` array of the next engine move_request.
interface TurnEntry {
    readonly side: Side;
    readonly cells: readonly [Coord, Coord];
}

type Clock =
    | { mode: `unlimited` }
    | { mode: `turn`; turnTimeMs: number; turnEndsAt: number; timer: Timer | null }
    | {
          mode: `match`;
          incrementMs: number;
          remaining: { x: number; o: number };
          turnStartedAt: number;
          timer: Timer | null;
      };

// A bot seat holds the engine-session machinery: one live session, one
// short-lived token, one orphan countdown. A human seat holds nothing the
// server drives.
interface BotSeat {
    readonly kind: `bot`;
    readonly botId: string;
    readonly name: string;
    session: Session | null;
    sessionToken: SessionToken | null;
    orphanTimer: Timer | null;
}

interface HumanSeat {
    readonly kind: `human`;
    readonly userId: string;
    readonly name: string;
}

type Seat = BotSeat | HumanSeat;

export interface LiveGame {
    readonly id: string;
    readonly seats: { readonly x: Seat; readonly o: Seat };
    readonly timeControl: TimeControl;
    readonly openingStones: number;
    position: Position;
    turnLog: readonly TurnEntry[];
    nextSeq: number;
    requestCounter: number;
    pending: number | null;
    clock: Clock;
    wallTimer: Timer | null;
}

export type MoveErrorCode = `not_your_turn` | `cell_occupied` | `out_of_range` | `game_over`;

export type HumanMoveResult =
    | { kind: `moved`; snapshot: GameSnapshot }
    | { kind: `rejected`; code: MoveErrorCode }
    | { kind: `unknown` };

export type ResignResult =
    | { kind: `resigned`; snapshot: GameSnapshot }
    | { kind: `rejected`; code: `game_over` }
    | { kind: `unknown` };

export type BotResignResult =
    | { kind: `resigned` }
    | { kind: `rejected`; code: `game_over` }
    | { kind: `unauthorized` }
    | { kind: `unknown` };

export interface RegistryDeps {
    query: Query;
    presence: PresenceRegistry;
    random?: () => number;
}

/**
 * Bind a presence registry to a game registry: the stream replays live
 * games, and presence transitions drive the orphan countdown.
 */
export function wirePresence(presence: PresenceRegistry, games: GameRegistry): void {
    presence.replay = (botId) => games.replayForBot(botId);
    presence.watch = (botId, online) => {
        if (online) {
            games.botOnline(botId);
        } else {
            games.botOffline(botId);
        }
    };
}

type Applied =
    | { ok: true; position: Position; win: Win | null }
    | { ok: false; rejection: Rejection };

// One turn is two placements, but the game ends the instant a line
// completes, so the second placement of a winning turn never applies.
function applyTurn(position: Position, cells: readonly [Coord, Coord]): Applied {
    const first = place(position, cells[0]);
    if (!first.ok) return first;
    if (first.win !== null) return { ok: true, position: first.position, win: first.win };
    const second = place(first.position, cells[1]);
    if (!second.ok) return second;
    return { ok: true, position: second.position, win: second.win };
}

function opponentOf(side: Side): Side {
    return side === `x` ? `o` : `x`;
}

function humanSeat(user: { id: string; name: string }): HumanSeat {
    return { kind: `human`, userId: user.id, name: user.name };
}

function botSeat(bot: { id: string; name: string }): BotSeat {
    return { kind: `bot`, botId: bot.id, name: bot.name, session: null, sessionToken: null, orphanTimer: null };
}

// A human game seats its human on one side; bot-vs-bot games answer null.
function humanSide(game: LiveGame): { side: Side; seat: HumanSeat } | null {
    if (game.seats.x.kind === `human`) return { side: `x`, seat: game.seats.x };
    if (game.seats.o.kind === `human`) return { side: `o`, seat: game.seats.o };
    return null;
}

function secondsFromMs(ms: number): number {
    return Math.max(0, ms) / 1000;
}

function toWireMoves(log: readonly TurnEntry[]) {
    return log.map((turn) => ({
        side: turn.side,
        pieces: turn.cells.map((cell) => internalToWire(cell)),
    }));
}

function boardCells(position: Position) {
    return position.stones.map((stone) => ({
        x: stone.x,
        y: stone.y,
        side: sideOf(stone.player),
    }));
}

function sideToMove(game: LiveGame): Side {
    return sideOf(playerToMove(game.position));
}

function elapsedMs(game: LiveGame): number {
    return game.clock.mode === `match` ? Date.now() - game.clock.turnStartedAt : 0;
}

function remainingMainMs(game: LiveGame, side: Side): number {
    if (game.clock.mode !== `match`) return 0;
    const stored = game.clock.remaining[side];
    return sideToMove(game) === side ? Math.max(0, stored - elapsedMs(game)) : stored;
}

// The seconds the mover may still think, per clock mode; unlimited carries
// nothing, which the packet schemas express by the field being optional.
function moveTimeLimit(game: LiveGame): number | undefined {
    if (game.clock.mode === `turn`) {
        return secondsFromMs(game.clock.turnEndsAt - Date.now());
    }
    if (game.clock.mode === `match`) {
        return secondsFromMs(remainingMainMs(game, sideToMove(game)));
    }
    return undefined;
}

function liveClockView(game: LiveGame): GameClock {
    if (game.clock.mode === `turn`) {
        return { mode: `turn`, remainingTurnMs: Math.max(0, game.clock.turnEndsAt - Date.now()) };
    }
    if (game.clock.mode === `match`) {
        return {
            mode: `match`,
            remainingMainMs: { x: remainingMainMs(game, `x`), o: remainingMainMs(game, `o`) },
        };
    }
    return { mode: `unlimited` };
}

function initialClock(timeControl: TimeControl): Clock {
    if (timeControl.mode === `turn`) {
        return { mode: `turn`, turnTimeMs: timeControl.turnTimeMs, turnEndsAt: 0, timer: null };
    }
    if (timeControl.mode === `match`) {
        return {
            mode: `match`,
            incrementMs: timeControl.incrementMs,
            remaining: { x: timeControl.mainTimeMs, o: timeControl.mainTimeMs },
            turnStartedAt: 0,
            timer: null,
        };
    }
    return { mode: `unlimited` };
}

function clearClockTimer(clock: Clock): void {
    if (clock.mode !== `unlimited` && clock.timer !== null) clearTimeout(clock.timer);
}

function moveErrorCode(rejection: Rejection): MoveErrorCode {
    switch (rejection.kind) {
        case `game-finished`:
            return `game_over`;
        case `cell-occupied`:
            return `cell_occupied`;
        case `outside-placement-radius`:
            return `out_of_range`;
        case `first-stone-off-origin`:
            // The server places the origin before any player turn, so this
            // is unreachable; the mapping only keeps the switch exhaustive.
            return `out_of_range`;
    }
}

export class GameRegistry {
    readonly #games = new Map<string, LiveGame>();
    readonly #query: Query;
    readonly #presence: PresenceRegistry;
    readonly #random: () => number;

    constructor(deps: RegistryDeps) {
        this.#query = deps.query;
        this.#presence = deps.presence;
        // The crypto source is the default; the injection seam exists so
        // tests can script a draw.
        this.#random = deps.random ?? randomFloat;
    }

    activeGameCount(botId: string): number {
        let count = 0;
        for (const game of this.#games.values()) {
            if (this.#seatsBot(game, botId) !== null) count += 1;
        }
        return count;
    }

    activeHumanGameCount(userId: string): number {
        let count = 0;
        for (const game of this.#games.values()) {
            if (humanSide(game)?.seat.userId === userId) count += 1;
        }
        return count;
    }

    createGame(input: {
        user: { id: string; name: string };
        bot: { id: string; name: string };
        timeControl: TimeControl;
        openingStones: number;
    }): { gameId: string; snapshot: GameSnapshot } {
        const userSide: Side = this.#random() < 0.5 ? `x` : `o`;
        const { position, turns } = this.#placeOpening(input.openingStones);
        const gameId = insertGame(this.#query, {
            userId: input.user.id,
            botId: input.bot.id,
            userSide,
            timeControl: input.timeControl,
            opening: position.stones.map((stone) => ({
                x: stone.x,
                y: stone.y,
                player: stone.player,
            })),
        });
        const game: LiveGame = {
            id: gameId,
            seats:
                userSide === `x`
                    ? { x: humanSeat(input.user), o: botSeat(input.bot) }
                    : { x: botSeat(input.bot), o: humanSeat(input.user) },
            timeControl: input.timeControl,
            openingStones: input.openingStones,
            position,
            turnLog: turns,
            nextSeq: 1,
            requestCounter: 0,
            pending: null,
            clock: { mode: `unlimited` },
            wallTimer: null,
        };
        this.#games.set(gameId, game);
        this.#armClock(game, initialClock(game.timeControl));
        this.#armWallCap(game);
        this.#requestBotMove(game);
        const botSide = opponentOf(userSide);
        this.#presence.send(this.#botIdAt(game, botSide), this.#gameStartEvent(game, botSide));
        return { gameId, snapshot: liveSnapshot(game) };
    }

    createBotGame(input: {
        challenger: { id: string; name: string };
        dest: { id: string; name: string };
        timeControl: TimeControl;
        openingStones: number;
        firstPlayer: FirstPlayer;
    }): { gameId: string } {
        const { position, turns } = this.#placeOpening(input.openingStones);
        // firstPlayer names who takes the first player turn; the placed
        // opening decides which side that is, parity included.
        const firstMover = sideOf(playerToMove(position));
        const challengerSide =
            input.firstPlayer === `challenger`
                ? firstMover
                : input.firstPlayer === `challenged`
                  ? opponentOf(firstMover)
                  : this.#random() < 0.5
                    ? firstMover
                    : opponentOf(firstMover);
        const gameId = insertBotGame(this.#query, {
            challengerBotId: input.challenger.id,
            destBotId: input.dest.id,
            challengerSide,
            timeControl: input.timeControl,
            opening: position.stones.map((stone) => ({
                x: stone.x,
                y: stone.y,
                player: stone.player,
            })),
        });
        const game: LiveGame = {
            id: gameId,
            seats:
                challengerSide === `x`
                    ? { x: botSeat(input.challenger), o: botSeat(input.dest) }
                    : { x: botSeat(input.dest), o: botSeat(input.challenger) },
            timeControl: input.timeControl,
            openingStones: input.openingStones,
            position,
            turnLog: turns,
            nextSeq: 1,
            requestCounter: 0,
            pending: null,
            clock: { mode: `unlimited` },
            wallTimer: null,
        };
        this.#games.set(gameId, game);
        this.#armClock(game, initialClock(game.timeControl));
        this.#armWallCap(game);
        this.#requestBotMove(game);
        this.#presence.send(this.#botIdAt(game, `x`), this.#gameStartEvent(game, `x`));
        this.#presence.send(this.#botIdAt(game, `o`), this.#gameStartEvent(game, `o`));
        return { gameId };
    }

    // The origin plus pairs of alternating random legal stones within the
    // opening radius; pairs keep turns whole, so the first player turn
    // always wants exactly two placements.
    #placeOpening(stones: number): { position: Position; turns: TurnEntry[] } {
        const origin = place(emptyPosition, { x: 0, y: 0 });
        if (!origin.ok) throw new Error(`the empty board rejected the origin`);
        let position = origin.position;
        const turns: TurnEntry[] = [];
        for (let turn = 0; turn < stones / 2; turn += 1) {
            const side = sideOf(playerToMove(position));
            const first = this.#randomOpeningCell(position);
            const afterFirst = place(position, first);
            if (!afterFirst.ok) throw new Error(`opening candidate rejected`);
            const second = this.#randomOpeningCell(afterFirst.position);
            const afterSecond = place(afterFirst.position, second);
            if (!afterSecond.ok) throw new Error(`opening candidate rejected`);
            position = afterSecond.position;
            turns.push({ side, cells: [first, second] });
        }
        return { position, turns };
    }

    #randomOpeningCell(position: Position): Coord {
        const taken = new Set(position.stones.map((stone) => `${String(stone.x)},${String(stone.y)}`));
        const candidates: Coord[] = [];
        for (let x = -openingRadius; x <= openingRadius; x += 1) {
            for (let y = -openingRadius; y <= openingRadius; y += 1) {
                const cell = { x, y };
                const distance = hexDistance(cell, { x: 0, y: 0 });
                if (distance > 0 && distance <= openingRadius && !taken.has(`${String(x)},${String(y)}`)) {
                    candidates.push(cell);
                }
            }
        }
        const chosen = candidates[Math.floor(this.#random() * candidates.length)];
        // 18 cells fit the radius and at most 6 stones are ever taken.
        if (chosen === undefined) throw new Error(`opening candidates exhausted`);
        return chosen;
    }

    snapshotFor(gameId: string): { userId: string | null; snapshot: GameSnapshot } | null {
        const live = this.#games.get(gameId);
        if (live !== undefined) {
            return { userId: humanSide(live)?.seat.userId ?? null, snapshot: liveSnapshot(live) };
        }
        const record = findGame(this.#query, gameId);
        // A bot-vs-bot game belongs to no human, so every user reads it as
        // unknown, and an unfinished game without a live registry entry
        // belongs to an earlier process.
        if (record === undefined || record.finishReason === null || record.kind !== `human`) {
            return null;
        }
        return {
            userId: record.userId,
            snapshot: {
                gameId: record.id,
                status: `finished`,
                you: record.userSide,
                opponent: { name: record.botName },
                board: { cells: boardCells(replayPosition(this.#query, record)) },
                winner: record.winner,
                reason: record.finishReason,
            },
        };
    }

    humanMove(gameId: string, userId: string, cells: readonly [Coord, Coord]): HumanMoveResult {
        const game = this.#games.get(gameId);
        if (game === undefined) return this.#storedReject(gameId, userId);
        const human = humanSide(game);
        if (human === null || human.seat.userId !== userId) return { kind: `unknown` };
        if (sideToMove(game) !== human.side) return { kind: `rejected`, code: `not_your_turn` };
        const applied = applyTurn(game.position, cells);
        if (!applied.ok) return { kind: `rejected`, code: moveErrorCode(applied.rejection) };
        this.#completeTurn(game, cells, human.side, applied);
        // A winning move finished the game and removed it from the live
        // map, so the snapshot comes from wherever the game now lives.
        return { kind: `moved`, snapshot: this.requireSnapshot(gameId) };
    }

    humanResign(gameId: string, userId: string): ResignResult {
        const game = this.#games.get(gameId);
        if (game === undefined) return this.#storedReject(gameId, userId);
        const human = humanSide(game);
        if (human === null || human.seat.userId !== userId) return { kind: `unknown` };
        this.#finish(game, opponentOf(human.side), `surrender`);
        return { kind: `resigned`, snapshot: this.requireSnapshot(gameId) };
    }

    botResign(gameId: string, token: string): BotResignResult {
        const holder = this.claimSession(gameId, token);
        if (holder === null) {
            return findGame(this.#query, gameId) === undefined
                ? { kind: `unknown` }
                : { kind: `unauthorized` };
        }
        this.#finish(holder.game, opponentOf(holder.side), `surrender`);
        return { kind: `resigned` };
    }

    // A finished game still answers actions with its result instead of a
    // 404, so a caller can tell stale from unknown.
    #storedReject(gameId: string, userId: string): { kind: `rejected`; code: `game_over` } | { kind: `unknown` } {
        const record = findGame(this.#query, gameId);
        if (record === undefined || record.kind !== `human` || record.userId !== userId) {
            return { kind: `unknown` };
        }
        return { kind: `rejected`, code: `game_over` };
    }

    requireSnapshot(gameId: string): GameSnapshot {
        const found = this.snapshotFor(gameId);
        // Every caller finishes the game first, so the row exists.
        if (found === null) throw new Error(`finished game left no record: ${gameId}`);
        return found.snapshot;
    }

    // Possession of the current, unexpired session token is the whole
    // credential for a game's engine session and its resign route.
    claimSession(gameId: string, token: string): { game: LiveGame; side: Side; seat: BotSeat } | null {
        const game = this.#games.get(gameId);
        if (game === undefined) return null;
        for (const side of [`x`, `o`] as const) {
            const seat = game.seats[side];
            if (seat.kind !== `bot` || seat.sessionToken === null) continue;
            if (seat.sessionToken.token !== token) continue;
            if (seat.sessionToken.expiresAt <= Date.now()) continue;
            return { game, side, seat };
        }
        return null;
    }

    attachSession(
        gameId: string,
        token: string,
        socket: EngineSocket,
    ): { game: LiveGame; side: Side } | null {
        const holder = this.claimSession(gameId, token);
        if (holder === null) return null;
        const { game, side, seat } = holder;
        this.#closeSession(seat);
        const session: Session = {
            socket,
            heartbeat: setInterval(() => {
                socket.send(
                    JSON.stringify(
                        bwsHeartbeatPacketSchema.parse({
                            type: `heartbeat`,
                            waiting: game.pending !== null,
                        }),
                    ),
                );
            }, sessionHeartbeatMs),
        };
        seat.session = session;
        socket.onceClose(() => {
            if (seat.session !== session) return;
            seat.session = null;
            clearInterval(session.heartbeat);
        });
        socket.send(
            JSON.stringify(
                bwsSetupPacketSchema.parse({
                    type: `setup`,
                    board: { cells: [{ q: 0, r: 0, p: `x` }] },
                }),
            ),
        );
        // The outstanding request belongs to whoever holds the turn, so a
        // bot attaching off-turn receives only the setup.
        if (game.pending !== null && sideToMove(game) === side) {
            socket.send(this.#moveRequestPacket(game));
        }
        return { game, side };
    }

    sessionMessage(side: Side, game: LiveGame, text: string): void {
        if (this.#games.get(game.id) !== game) return;
        const seat = game.seats[side];
        if (seat.kind !== `bot`) return;
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch {
            this.#closeSession(seat, 1008, `malformed frame`);
            return;
        }
        const packet = bwsMoveResponsePacketSchema.safeParse(parsed);
        if (!packet.success) {
            this.#closeSession(seat, 1008, `protocol violation`);
            return;
        }
        // Answer matching: only the outstanding request counts, so stale
        // and mismatched answers drop instead of applying.
        if (game.pending === null || packet.data.request_id !== game.pending) return;
        const cells = packet.data.move.pieces.map((piece) => wireToInternal(piece)) as [Coord, Coord];
        const applied = applyTurn(game.position, cells);
        if (!applied.ok) {
            // An illegal engine move forfeits server-side; the retry loop of
            // a move POST has no equivalent here by design.
            this.#finish(game, opponentOf(side), `terminated`);
            return;
        }
        this.#completeTurn(game, cells, side, applied);
    }

    #completeTurn(
        game: LiveGame,
        cells: readonly [Coord, Coord],
        side: Side,
        applied: { position: Position; win: Win | null },
    ): void {
        game.pending = null;
        game.position = applied.position;
        game.turnLog = [...game.turnLog, { side, cells }];
        insertMove(this.#query, { gameId: game.id, seq: game.nextSeq, side, cells });
        game.nextSeq += 1;
        if (applied.win !== null) {
            this.#finish(game, sideOf(applied.win.player), `six-in-a-row`);
            return;
        }
        this.#advanceClock(game, side);
        this.#requestBotMove(game);
    }

    // A pending request exists exactly while a bot seat holds the turn.
    #requestBotMove(game: LiveGame): void {
        const side = sideToMove(game);
        const seat = game.seats[side];
        if (seat.kind !== `bot`) return;
        game.requestCounter += 1;
        game.pending = game.requestCounter;
        seat.session?.socket.send(this.#moveRequestPacket(game));
    }

    #moveRequestPacket(game: LiveGame): string {
        const limit = moveTimeLimit(game);
        return JSON.stringify(
            bwsMoveRequestPacketSchema.parse({
                type: `move_request`,
                side: sideToMove(game),
                previous: toWireMoves(game.turnLog),
                ...(limit !== undefined && { move_time_limit: limit }),
                request_id: game.pending,
            }),
        );
    }

    #armClock(game: LiveGame, clock: Clock): void {
        clearClockTimer(game.clock);
        game.clock = clock;
        if (clock.mode === `unlimited`) return;
        const now = Date.now();
        if (clock.mode === `turn`) {
            clock.turnEndsAt = now + clock.turnTimeMs;
            clock.timer = setTimeout(() => {
                this.#onTimeout(game);
            }, clock.turnTimeMs);
            return;
        }
        clock.turnStartedAt = now;
        const budget = clock.remaining[sideToMove(game)];
        clock.timer = setTimeout(() => {
            this.#onTimeout(game);
        }, Math.max(0, budget));
    }

    // Unlimited games carry no clock arithmetic that would ever end them,
    // so a wall-time cap closes the game with no winner instead.
    #armWallCap(game: LiveGame): void {
        if (game.timeControl.mode !== `unlimited`) return;
        game.wallTimer = setTimeout(() => {
            if (this.#games.get(game.id) !== game) return;
            this.#finish(game, null, `terminated`);
        }, unlimitedWallCapMs);
    }

    // The mover's time stops here and the increment lands after the move;
    // the next mover's timer arms from the stored remaining budget.
    #advanceClock(game: LiveGame, mover: Side): void {
        if (game.clock.mode === `match`) {
            const left = Math.max(0, game.clock.remaining[mover] - (Date.now() - game.clock.turnStartedAt));
            game.clock.remaining[mover] = left + game.clock.incrementMs;
        }
        this.#armClock(game, game.clock);
    }

    #onTimeout(game: LiveGame): void {
        if (this.#games.get(game.id) !== game) return;
        this.#finish(game, opponentOf(sideToMove(game)), `timeout`);
    }

    // Presence is the stream; a bot whose stream is gone this long forfeits
    // every live game, so a vanished bot cannot stall the arena.
    botOffline(botId: string): void {
        for (const game of this.#games.values()) {
            for (const side of [`x`, `o`] as const) {
                const seat = game.seats[side];
                if (seat.kind !== `bot` || seat.botId !== botId || seat.orphanTimer !== null) continue;
                seat.orphanTimer = setTimeout(() => {
                    if (this.#games.get(game.id) !== game) return;
                    this.#finish(game, opponentOf(side), `disconnect`);
                }, orphanForfeitMs);
            }
        }
    }

    botOnline(botId: string): void {
        for (const game of this.#games.values()) {
            for (const side of [`x`, `o`] as const) {
                const seat = game.seats[side];
                if (seat.kind !== `bot` || seat.botId !== botId || seat.orphanTimer === null) continue;
                clearTimeout(seat.orphanTimer);
                seat.orphanTimer = null;
            }
        }
    }

    // Shutdown drops every timer and forgets every live game without
    // writing: the next boot's sweep is the owner of games a process left
    // unfinished, so nothing here may touch the database on the way out.
    // Late socket events after this point find an empty registry and arm
    // nothing.
    stop(): void {
        for (const game of [...this.#games.values()]) {
            clearClockTimer(game.clock);
            if (game.wallTimer !== null) {
                clearTimeout(game.wallTimer);
                game.wallTimer = null;
            }
            for (const side of [`x`, `o`] as const) {
                const seat = game.seats[side];
                if (seat.kind !== `bot`) continue;
                if (seat.orphanTimer !== null) {
                    clearTimeout(seat.orphanTimer);
                    seat.orphanTimer = null;
                }
                this.#closeSession(seat);
            }
        }
        this.#games.clear();
    }

    replayForBot(botId: string): StreamEvent[] {
        const events: StreamEvent[] = [];
        for (const game of this.#games.values()) {
            for (const side of [`x`, `o`] as const) {
                const seat = game.seats[side];
                if (seat.kind !== `bot` || seat.botId !== botId) continue;
                events.push(this.#gameStartEvent(game, side));
                if (sideToMove(game) === side && game.pending !== null) {
                    events.push(this.#moveRequestEvent(game));
                }
            }
        }
        return events;
    }

    // Every emission of gameStart mints the session token afresh for the
    // seat it names, which supersedes the previous one and starts its own
    // short life.
    #gameStartEvent(game: LiveGame, side: Side): StreamEvent {
        const seat = game.seats[side];
        // Every caller derives the side from a bot seat it just found.
        if (seat.kind !== `bot`) throw new Error(`gameStart asked for a human seat`);
        seat.sessionToken = {
            token: `hgs_${randomToken(32)}`,
            expiresAt: Date.now() + sessionTokenTtlMs,
        };
        return {
            type: `gameStart`,
            gameId: game.id,
            side,
            opponent: { name: game.seats[opponentOf(side)].name },
            timeControl: game.timeControl,
            ...(game.openingStones > 0 && { opening: { randomTurns: game.openingStones / 2 } }),
            rated: false,
            engine: {
                socketUrl: botGameSocketPath.replace(`{gameId}`, game.id),
                token: seat.sessionToken.token,
            },
        };
    }

    #moveRequestEvent(game: LiveGame): StreamEvent {
        const limit = moveTimeLimit(game);
        return {
            type: `moveRequest`,
            gameId: game.id,
            request: htttxMoveRequestSchema.parse({
                board: {
                    to_move: sideToMove(game),
                    cells: game.position.stones.map((stone) => ({
                        ...internalToWire(stone),
                        p: sideOf(stone.player),
                    })),
                },
                ...(limit !== undefined && { time_limit: limit }),
                request_id: game.pending ?? 0,
            }),
        };
    }

    #finish(game: LiveGame, winner: Side | null, reason: FinishReason): void {
        if (!this.#games.delete(game.id)) return;
        clearClockTimer(game.clock);
        if (game.wallTimer !== null) {
            clearTimeout(game.wallTimer);
            game.wallTimer = null;
        }
        recordFinish(this.#query, game.id, { winner, reason });
        for (const side of [`x`, `o`] as const) {
            const seat = game.seats[side];
            if (seat.kind !== `bot`) continue;
            if (seat.orphanTimer !== null) {
                clearTimeout(seat.orphanTimer);
                seat.orphanTimer = null;
            }
            this.#closeSession(seat);
            this.#presence.send(seat.botId, {
                type: `gameFinish`,
                gameId: game.id,
                winner,
                reason,
            });
        }
    }

    #closeSession(seat: BotSeat, code = 1000, reason = `closed`): void {
        const session = seat.session;
        if (session === null) return;
        seat.session = null;
        clearInterval(session.heartbeat);
        session.socket.close(code, reason);
    }

    #seatsBot(game: LiveGame, botId: string): Side | null {
        for (const side of [`x`, `o`] as const) {
            const seat = game.seats[side];
            if (seat.kind === `bot` && seat.botId === botId) return side;
        }
        return null;
    }

    // The side is a bot seat in every caller; the missing row would mean
    // the registry and the store disagree.
    #botIdAt(game: LiveGame, side: Side): string {
        const seat = game.seats[side];
        if (seat.kind !== `bot`) throw new Error(`no bot seated on side ${side}`);
        return seat.botId;
    }
}

function liveSnapshot(game: LiveGame): GameSnapshot {
    const human = humanSide(game);
    // Every snapshot reader is a human action, so the human seat exists.
    if (human === null) throw new Error(`snapshot for a game without a human: ${game.id}`);
    return {
        gameId: game.id,
        status: `in-progress`,
        you: human.side,
        opponent: { name: game.seats[opponentOf(human.side)].name },
        board: { cells: boardCells(game.position) },
        toMove: sideToMove(game),
        clock: liveClockView(game),
    };
}
