import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Coord, Player, RejectionKind, Stone } from '../../src';

// The oracle surface we consume, declared from observed behavior; the dynamic
// import cannot be typed by the compiler because the path is runtime data.
interface OracleModule {
    PLACE_CELL_HEX_RADIUS: number;
    createStartedGameState(
        playerIds: readonly string[],
        startingPlayerId: string | null,
    ): OracleState;
    applyGameMove(
        state: OracleState,
        params: { playerId: string; x: number; y: number },
    ): unknown;
    isCellWithinPlacementRadius(
        cells: readonly Coord[],
        candidate: Coord,
    ): boolean;
    getHexDistance(a: Coord, b: Coord): number;
}

interface OracleState {
    cells: { x: number; y: number; occupiedBy: string }[];
    winner: { cells: Coord[]; playerId: string } | null;
    currentTurnPlayerId: string | null;
    placementsRemaining: number;
}

export type OracleGame = OracleState;

const playerIds = [`p0`, `p1`] as const;

export interface Oracle {
    radius: number;
    newGame(): OracleState;
    /** Applies in place; null when accepted, else the oracle's message. */
    apply(game: OracleState, player: Player, coord: Coord): string | null;
    stones(game: OracleState): Stone[];
    playerToMove(game: OracleState): Player;
    placementsRemaining(game: OracleState): number;
    winLine(game: OracleState): { player: Player; cells: Coord[] } | null;
    /** The oracle's own legality, mirrored without mutating the state. */
    isLegal(game: OracleState, coord: Coord): boolean;
    hexDistance(a: Coord, b: Coord): number;
    isWithinRadius(game: OracleState, coord: Coord): boolean;
}

/**
 * Locates the sibling HeXO checkout: HEXO_ROOT, else `../HeXO` next to this
 * repo. Returns null when absent so tests can skip; CI never has it.
 */
export function resolveHexoRoot(): string | null {
    const candidates = [
        process.env[`HEXO_ROOT`],
        join(repoRoot(), `..`, `HeXO`),
    ];
    for (const candidate of candidates) {
        if (
            candidate !== undefined &&
            existsSync(join(candidate, `packages/shared/src/sharedTypes.ts`))
        ) {
            return candidate;
        }
    }
    return null;
}

function repoRoot(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    return join(here, `..`, `..`, `..`, `..`);
}

export async function loadOracle(): Promise<Oracle | null> {
    const root = resolveHexoRoot();
    if (root === null) {
        return null;
    }
    const moduleUrl = pathToFileURL(
        join(root, `packages/shared/src/sharedTypes.ts`),
    ).href;
    const loaded: unknown = await import(moduleUrl);
    // The cast is sound because the shape is verified line by line below.
    const mod = loaded as OracleModule;
    if (
        typeof mod.createStartedGameState !== `function` ||
        typeof mod.applyGameMove !== `function` ||
        typeof mod.isCellWithinPlacementRadius !== `function` ||
        typeof mod.getHexDistance !== `function` ||
        mod.PLACE_CELL_HEX_RADIUS !== 8
    ) {
        throw new Error(`HeXO checkout at ${root} does not match the oracle surface`);
    }
    return adapt(mod);
}

function adapt(mod: OracleModule): Oracle {
    return {
        radius: mod.PLACE_CELL_HEX_RADIUS,
        newGame: () => mod.createStartedGameState([...playerIds], playerIds[0]),
        apply: (game, player, coord) => {
            try {
                mod.applyGameMove(game, {
                    playerId: playerIds[player],
                    x: coord.x,
                    y: coord.y,
                });
                return null;
            } catch (error) {
                return error instanceof Error ? error.message : String(error);
            }
        },
        stones: (game) =>
            game.cells.map((cell) => ({
                x: cell.x,
                y: cell.y,
                player: playerIndex(cell.occupiedBy),
            })),
        playerToMove: (game) => {
            if (game.currentTurnPlayerId === null) {
                throw new Error(`oracle game has no current player`);
            }
            return playerIndex(game.currentTurnPlayerId);
        },
        placementsRemaining: (game) => game.placementsRemaining,
        winLine: (game) =>
            game.winner === null
                ? null
                : {
                      player: playerIndex(game.winner.playerId),
                      cells: game.winner.cells.map((cell) => ({
                          x: cell.x,
                          y: cell.y,
                      })),
                  },
        isLegal: (game, coord) => {
            if (game.winner !== null) {
                return false;
            }
            const occupied = game.cells.some(
                (cell) => cell.x === coord.x && cell.y === coord.y,
            );
            if (occupied) {
                return false;
            }
            if (game.cells.length === 0 && (coord.x !== 0 || coord.y !== 0)) {
                return false;
            }
            return (
                game.cells.length === 0 ||
                mod.isCellWithinPlacementRadius(game.cells, coord)
            );
        },
        hexDistance: (a, b) => mod.getHexDistance(a, b),
        isWithinRadius: (game, coord) =>
            mod.isCellWithinPlacementRadius(game.cells, coord),
    };
}

function playerIndex(playerId: string): Player {
    const index = playerIds.findIndex((id) => id === playerId);
    if (index < 0) {
        throw new Error(`unknown oracle player ${playerId}`);
    }
    return index === 0 ? 0 : 1;
}

/** Maps an oracle refusal message to the engine's rejection kinds. */
export function oracleRejectionKind(message: string): RejectionKind {
    if (message.includes(`winning game state`)) {
        return `game-finished`;
    }
    if (message.includes(`already occupied`)) {
        return `cell-occupied`;
    }
    if (message.includes(`must be at the origin`)) {
        return `first-stone-off-origin`;
    }
    if (/within \d+ hexes/.test(message)) {
        return `outside-placement-radius`;
    }
    throw new Error(`unmapped oracle rejection: ${message}`);
}
