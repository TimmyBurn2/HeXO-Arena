import type { GameFinish, GameSnapshot, GameTurn } from '@hexo-arena/contract';

/**
 * The last turn the board holds: turn 0 is the origin and turn t is plies
 * 2t-1 and 2t, so a won turn cut short after one stone still counts.
 */
export function lastTurnOf(snapshot: GameSnapshot): number {
    return Math.ceil((snapshot.board.cells.length - 1) / 2);
}

/**
 * A turn event against the board in hand: the next turn applies, one the
 * board already holds is a no-op, and a skipped turn means the stream and
 * the board disagree, which only a fresh snapshot resolves.
 */
export type TurnFit = { kind: `applied`; snapshot: GameSnapshot } | { kind: `held` } | { kind: `gap` };

export function applyTurn(snapshot: GameSnapshot, turn: GameTurn): TurnFit {
    if (snapshot.status !== `in-progress`) return { kind: `held` };
    const last = lastTurnOf(snapshot);
    if (turn.turn <= last) return { kind: `held` };
    if (turn.turn > last + 1) return { kind: `gap` };
    return {
        kind: `applied`,
        snapshot: {
            ...snapshot,
            board: { cells: [...snapshot.board.cells, ...turn.cells.map((cell) => ({ ...cell, side: turn.side }))] },
            toMove: turn.toMove,
            clock: turn.clock,
        },
    };
}

/** The result lands on the board as it stands; a finished board keeps its own. */
export function applyFinish(snapshot: GameSnapshot, finish: GameFinish): GameSnapshot {
    if (snapshot.status === `finished`) return snapshot;
    const { gameId, players, openingPlies, board, timeControl } = snapshot;
    return {
        gameId,
        players,
        ...(snapshot.you !== undefined && { you: snapshot.you }),
        openingPlies,
        board,
        timeControl,
        status: `finished`,
        winner: finish.winner,
        reason: finish.reason,
        voided: finish.voided,
        clock: finish.clock,
    };
}

/**
 * The later of two reads of one game: a move's answer can land after the
 * stream already carried the next turn, and must not take it back.
 */
export function laterOf(current: GameSnapshot | null, next: GameSnapshot): GameSnapshot {
    if (current === null) return next;
    const held = current.board.cells.length;
    const offered = next.board.cells.length;
    if (offered !== held) return offered > held ? next : current;
    return current.status === `finished` && next.status !== `finished` ? current : next;
}
