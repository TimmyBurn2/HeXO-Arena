import {
    bwsHeartbeatPacketSchema,
    bwsMoveRequestPacketSchema,
    bwsMoveResponsePacketSchema,
    bwsSetupPacketSchema,
    botGameSocketPath,
    htttxMoveRequestSchema,
    internalToWire,
    openingPliesSchema,
    sessionHeartbeatMs,
    sessionTokenTtlMs,
    sideOf,
    wireToInternal,
    type FinishReason,
    type FirstPlayer,
    type GameClock,
    type GameSnapshot,
    type OpeningPlies,
    type SeatPlayer,
    type Side,
    type StreamEvent,
    type StreamPlayer,
    type TimeControl,
} from '@hexarena/contract';
import { randomUUID } from 'node:crypto';
import {
    drawOpening,
    place,
    playerToMove,
    type Coord,
    type Position,
    type Rejection,
    type Win,
} from '@hexarena/rules';
import type { Query } from './db';
import {
    findFinishedHeadline,
    findGame,
    insertBotGame,
    insertGame,
    insertMove,
    recordFinish,
    replayPosition,
    type GameHeadline,
} from './game-store';
import type { PresenceRegistry } from './presence';
import { randomFloat, randomIndex } from './random';
import { streamPlayerOf } from './rating-store';
import { isCurrentGeneration } from './site-state';
import { randomToken } from './tokens';

export const orphanForfeitMs = 30_000;
export const unlimitedWallCapMs = 24 * 60 * 60 * 1000;

type Timer = ReturnType<typeof setTimeout>;

// The subset of the ws socket the game layer needs, so the engine session
// is unit-testable against a plain fake.
export interface EngineSocket {
    send(text: string): void;
    close(code?: number, reason?: string): void;
    onceClose(listener: () => void): void;
}

// bws forbids resending a move a connection has already carried, so each
// session counts the turn log entries it has delivered.
// The setup holds the origin alone, which is not in the log, so a fresh
// session counts from zero.
interface Session {
    readonly socket: EngineSocket;
    readonly heartbeat: ReturnType<typeof setInterval>;
    delivered: number;
}

interface SessionToken {
    readonly token: string;
    readonly expiresAt: number;
}

// A two-placement turn that was played or server-placed; each engine
// session receives the log in order as the `previous` arrays of its
// move_requests.
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

/** Who a human-facing action names: an account or an anonymous guest. */
export interface PersonRef {
    readonly kind: `user` | `guest`;
    readonly id: string;
}

export interface Person extends PersonRef {
    readonly name: string;
}

interface HumanSeat {
    readonly kind: `human`;
    readonly person: Person;
}

type Seat = BotSeat | HumanSeat;

export interface LiveGame {
    readonly id: string;
    readonly seats: { readonly x: Seat; readonly o: Seat };
    readonly timeControl: TimeControl;
    readonly openingPlies: OpeningPlies;
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
    generation: number;
    random?: () => number;
    randomIndex?: (bound: number) => number;
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

function humanSeat(person: Person): HumanSeat {
    return { kind: `human`, person };
}

function seatName(seat: Seat): string {
    return seat.kind === `bot` ? seat.name : seat.person.name;
}

function seatNames(game: LiveGame): Record<Side, string> {
    return { x: seatName(game.seats.x), o: seatName(game.seats.o) };
}

function samePerson(one: PersonRef, other: PersonRef): boolean {
    return one.kind === other.kind && one.id === other.id;
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

// A game against a guest lives in memory alone: no row, no moves, no
// finish, so neither the rating fold nor a recompute can ever see it.
function isGuestGame(game: LiveGame): boolean {
    return humanSide(game)?.seat.person.kind === `guest`;
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

function holdsRequest(game: LiveGame, side: Side): boolean {
    return game.pending !== null && sideToMove(game) === side;
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
    // Finished guest games answer from here while their guest session
    // lives; the session's end forgets them.
    readonly #finishedGuestGames = new Map<
        string,
        { guestId: string; snapshot: GameSnapshot; headline: GameHeadline }
    >();
    readonly #query: Query;
    readonly #presence: PresenceRegistry;
    readonly #generation: number;
    readonly #random: () => number;
    readonly #randomIndex: (bound: number) => number;

    constructor(deps: RegistryDeps) {
        this.#query = deps.query;
        this.#presence = deps.presence;
        this.#generation = deps.generation;
        // The crypto source is the default; the injection seam exists so
        // tests can script a draw.
        this.#random = deps.random ?? randomFloat;
        this.#randomIndex = deps.randomIndex ?? randomIndex;
    }

    liveGameCount(): number {
        return this.#games.size;
    }

    activeGameCount(botId: string): number {
        let count = 0;
        for (const game of this.#games.values()) {
            if (this.#seatsBot(game, botId) !== null) count += 1;
        }
        return count;
    }

    activeHumanGameCount(person: PersonRef): number {
        let count = 0;
        for (const game of this.#games.values()) {
            const human = humanSide(game);
            if (human !== null && samePerson(human.seat.person, person)) count += 1;
        }
        return count;
    }

    createGame(input: {
        person: Person;
        bot: { id: string; name: string };
        timeControl: TimeControl;
        openingPlies: OpeningPlies;
    }): { gameId: string; snapshot: GameSnapshot } {
        const userSide: Side = this.#random() < 0.5 ? `x` : `o`;
        const { position, turns } = this.#placeOpening(input.openingPlies);
        const gameId =
            input.person.kind === `guest`
                ? `g_${randomUUID()}`
                : insertGame(this.#query, {
                      userId: input.person.id,
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
                    ? { x: humanSeat(input.person), o: botSeat(input.bot) }
                    : { x: botSeat(input.bot), o: humanSeat(input.person) },
            timeControl: input.timeControl,
            openingPlies: input.openingPlies,
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
        return { gameId, snapshot: this.#liveSnapshot(game) };
    }

    createBotGame(input: {
        challenger: { id: string; name: string };
        dest: { id: string; name: string };
        timeControl: TimeControl;
        openingPlies: OpeningPlies;
        firstPlayer: FirstPlayer;
    }): { gameId: string } {
        const { position, turns } = this.#placeOpening(input.openingPlies);
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
            openingPlies: input.openingPlies,
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

    // Pairs of plies after the origin are whole turns, so the opening
    // reaches engine sessions as ordinary two-stone turns.
    #placeOpening(openingPlies: OpeningPlies): { position: Position; turns: TurnEntry[] } {
        const position = drawOpening(openingPlies, this.#randomIndex);
        const turns: TurnEntry[] = [];
        for (let ply = 1; ply < position.stones.length; ply += 2) {
            const first = position.stones[ply];
            const second = position.stones[ply + 1];
            // An odd ply count leaves every stone after the origin paired.
            if (first === undefined || second === undefined) throw new Error(`an opening split a turn`);
            turns.push({
                side: sideOf(first.player),
                cells: [
                    { x: first.x, y: first.y },
                    { x: second.x, y: second.y },
                ],
            });
        }
        return { position, turns };
    }

    /**
     * Any game by id, live or finished, bot-vs-bot or guest: spectating is
     * free, so who plays and how it stands is public.
     */
    headline(gameId: string): GameHeadline | null {
        const live = this.#games.get(gameId);
        if (live !== undefined) {
            return { status: `live`, names: seatNames(live), toMove: sideToMove(live), timeControl: live.timeControl };
        }
        return this.#finishedGuestGames.get(gameId)?.headline ?? findFinishedHeadline(this.#query, gameId) ?? null;
    }

    // Unknown and not-yours read the same, so a game id reveals nothing.
    snapshotFor(gameId: string, person: PersonRef): GameSnapshot | null {
        const live = this.#games.get(gameId);
        if (live !== undefined) {
            const human = humanSide(live);
            return human !== null && samePerson(human.seat.person, person) ? this.#liveSnapshot(live) : null;
        }
        if (person.kind === `guest`) {
            const finished = this.#finishedGuestGames.get(gameId);
            return finished?.guestId === person.id ? finished.snapshot : null;
        }
        const record = findGame(this.#query, gameId);
        // A bot-vs-bot game belongs to no human, and an unfinished game
        // without a live registry entry belongs to an earlier process.
        if (record?.kind !== `human` || record.finishReason === null || record.userId !== person.id) {
            return null;
        }
        return {
            gameId: record.id,
            status: `finished`,
            you: record.userSide,
            opponent: streamPlayerOf(this.#query, { kind: `bot`, id: record.botId }, record.botName),
            // The stored opening holds every opening stone, the origin included.
            openingPlies: openingPliesSchema.parse(record.opening.length),
            board: { cells: boardCells(replayPosition(this.#query, record)) },
            winner: record.winner,
            reason: record.finishReason,
        };
    }

    humanMove(gameId: string, person: PersonRef, cells: readonly [Coord, Coord]): HumanMoveResult {
        const game = this.#games.get(gameId);
        if (game === undefined) return this.#finishedReject(gameId, person);
        const human = humanSide(game);
        if (human === null || !samePerson(human.seat.person, person)) return { kind: `unknown` };
        if (sideToMove(game) !== human.side) return { kind: `rejected`, code: `not_your_turn` };
        const applied = applyTurn(game.position, cells);
        if (!applied.ok) return { kind: `rejected`, code: moveErrorCode(applied.rejection) };
        this.#completeTurn(game, cells, human.side, applied);
        // A winning move finished the game and removed it from the live
        // map, so the snapshot comes from wherever the game now lives.
        return { kind: `moved`, snapshot: this.requireSnapshot(gameId, person) };
    }

    humanResign(gameId: string, person: PersonRef): ResignResult {
        const game = this.#games.get(gameId);
        if (game === undefined) return this.#finishedReject(gameId, person);
        const human = humanSide(game);
        if (human === null || !samePerson(human.seat.person, person)) return { kind: `unknown` };
        this.#finish(game, opponentOf(human.side), `surrender`);
        return { kind: `resigned`, snapshot: this.requireSnapshot(gameId, person) };
    }

    botResign(gameId: string, token: string): BotResignResult {
        const holder = this.claimSession(gameId, token);
        if (holder === null) {
            const known =
                this.#games.has(gameId) ||
                this.#finishedGuestGames.has(gameId) ||
                findGame(this.#query, gameId) !== undefined;
            return known ? { kind: `unauthorized` } : { kind: `unknown` };
        }
        this.#finish(holder.game, opponentOf(holder.side), `surrender`);
        return { kind: `resigned` };
    }

    // A finished game still answers actions with its result instead of a
    // 404, so a caller can tell stale from unknown.
    #finishedReject(gameId: string, person: PersonRef): { kind: `rejected`; code: `game_over` } | { kind: `unknown` } {
        return this.snapshotFor(gameId, person) === null ? { kind: `unknown` } : { kind: `rejected`, code: `game_over` };
    }

    requireSnapshot(gameId: string, person: PersonRef): GameSnapshot {
        const found = this.snapshotFor(gameId, person);
        // Every caller finishes the game first, so the record exists.
        if (found === null) throw new Error(`finished game left no record: ${gameId}`);
        return found;
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
            // bws obliges an idle bot that hears it is waited on to hang up,
            // so waiting is true only for the seat holding the request.
            heartbeat: setInterval(() => {
                socket.send(
                    JSON.stringify(
                        bwsHeartbeatPacketSchema.parse({
                            type: `heartbeat`,
                            waiting: holdsRequest(game, side),
                        }),
                    ),
                );
            }, sessionHeartbeatMs),
            delivered: 0,
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
        if (holdsRequest(game, side)) {
            this.#sendMoveRequest(game, session);
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
        if (!isGuestGame(game)) insertMove(this.#query, { gameId: game.id, seq: game.nextSeq, side, cells });
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
        if (seat.session !== null) this.#sendMoveRequest(game, seat.session);
    }

    #sendMoveRequest(game: LiveGame, session: Session): void {
        const limit = moveTimeLimit(game);
        session.socket.send(
            JSON.stringify(
                bwsMoveRequestPacketSchema.parse({
                    type: `move_request`,
                    side: sideToMove(game),
                    previous: toWireMoves(game.turnLog.slice(session.delivered)),
                    ...(limit !== undefined && { move_time_limit: limit }),
                    request_id: game.pending,
                }),
            ),
        );
        session.delivered = game.turnLog.length;
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

    // An abort has no winner, so it leaves every rating alone; both bot
    // seats hear it as gameFinish like any other end.
    abort(gameId: string): boolean {
        const game = this.#games.get(gameId);
        if (game === undefined) return false;
        this.#finish(game, null, `aborted`);
        return true;
    }

    abortForPerson(person: PersonRef): number {
        const seated = [...this.#games.values()].filter((game) => {
            const human = humanSide(game);
            return human !== null && samePerson(human.seat.person, person);
        });
        for (const game of seated) this.#finish(game, null, `aborted`);
        return seated.length;
    }

    // A guest session's end takes its games along: the live ones abort,
    // unrated as they always were, and the finished ones are forgotten.
    endGuest(guestId: string): void {
        this.abortForPerson({ kind: `guest`, id: guestId });
        for (const [gameId, finished] of [...this.#finishedGuestGames]) {
            if (finished.guestId === guestId) this.#finishedGuestGames.delete(gameId);
        }
    }

    abortForBot(botId: string): number {
        const seated = [...this.#games.values()].filter((game) => this.#seatsBot(game, botId) !== null);
        for (const game of seated) this.#finish(game, null, `aborted`);
        return seated.length;
    }

    abortAll(): number {
        const live = [...this.#games.values()];
        for (const game of live) this.#finish(game, null, `aborted`);
        return live.length;
    }

    // Presence is the stream; a bot whose stream is gone this long forfeits
    // every live game, so a vanished bot cannot stall the arena.
    // Once this process's generation is retired, a lost stream is the
    // shutdown's fault, not the bot's, so the game aborts unrated instead.
    botOffline(botId: string): void {
        for (const game of this.#games.values()) {
            for (const side of [`x`, `o`] as const) {
                const seat = game.seats[side];
                if (seat.kind !== `bot` || seat.botId !== botId || seat.orphanTimer !== null) continue;
                seat.orphanTimer = setTimeout(() => {
                    if (this.#games.get(game.id) !== game) return;
                    if (isCurrentGeneration(this.#query, this.#generation)) {
                        this.#finish(game, opponentOf(side), `disconnect`);
                    } else {
                        this.#finish(game, null, `aborted`);
                    }
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
        this.#finishedGuestGames.clear();
    }

    replayForBot(botId: string): StreamEvent[] {
        const events: StreamEvent[] = [];
        for (const game of this.#games.values()) {
            for (const side of [`x`, `o`] as const) {
                const seat = game.seats[side];
                if (seat.kind !== `bot` || seat.botId !== botId) continue;
                events.push(this.#gameStartEvent(game, side));
                if (holdsRequest(game, side)) {
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
            opponent: this.#playerOf(game.seats[opponentOf(side)]),
            timeControl: game.timeControl,
            openingPlies: game.openingPlies,
            rated: !isGuestGame(game),
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
        const human = humanSide(game);
        if (human?.seat.person.kind === `guest`) {
            this.#finishedGuestGames.set(game.id, {
                guestId: human.seat.person.id,
                snapshot: { ...this.#seatedView(game, human.side), status: `finished`, winner, reason },
                headline: { status: `finished`, names: seatNames(game), winner, reason },
            });
        } else {
            recordFinish(this.#query, game.id, { winner, reason });
        }
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

    #liveSnapshot(game: LiveGame): GameSnapshot {
        const human = humanSide(game);
        // Every snapshot reader is a human action, so the human seat exists.
        if (human === null) throw new Error(`snapshot for a game without a human: ${game.id}`);
        return {
            ...this.#seatedView(game, human.side),
            status: `in-progress`,
            toMove: sideToMove(game),
            clock: liveClockView(game),
        };
    }

    #seatedView(game: LiveGame, humanSideOf: Side) {
        return {
            gameId: game.id,
            you: humanSideOf,
            opponent: this.#botPlayerOf(game.seats[opponentOf(humanSideOf)]),
            openingPlies: game.openingPlies,
            board: { cells: boardCells(game.position) },
        };
    }

    // A human game seats one human against one bot, so the seat across
    // from the human is always a bot.
    #botPlayerOf(seat: Seat): StreamPlayer {
        if (seat.kind !== `bot`) throw new Error(`a human faces a human seat`);
        return streamPlayerOf(this.#query, { kind: `bot`, id: seat.botId }, seat.name);
    }

    #playerOf(seat: Seat): SeatPlayer {
        if (seat.kind === `bot`) return this.#botPlayerOf(seat);
        const person = seat.person;
        return person.kind === `guest`
            ? { name: person.name, rating: null, provisional: false }
            : streamPlayerOf(this.#query, { kind: `human`, id: person.id }, person.name);
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
