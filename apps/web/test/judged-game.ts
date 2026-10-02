import type { AnalysisTurn, CommunityAnalysis, GameCell, OwnAnalysis } from '@hexo-arena/contract';

// A five-turn game from the origin alone: o's stones run along y = 1 and
// its second stone of turn 5 completes six; x plays turns 2 and 4.
export const judgedCells: GameCell[] = [
    { x: 0, y: 0, side: `x` },
    { x: 0, y: 1, side: `o` },
    { x: 1, y: 1, side: `o` },
    { x: 1, y: 0, side: `x` },
    { x: 2, y: 0, side: `x` },
    { x: 2, y: 1, side: `o` },
    { x: 3, y: 1, side: `o` },
    { x: 3, y: -1, side: `x` },
    { x: 4, y: -1, side: `x` },
    { x: 4, y: 1, side: `o` },
    { x: 5, y: 1, side: `o` },
];

// A reading at the position before each turn, x-positive:
// x's turn 2 is its line C, 0.12 short of the best, an inaccuracy;
// o's turn 3 is not listed and the board after it reads x 0.45, from x 0.08, a blunder;
// x's turn 4 is its line C, which hands o a forced win, a blunder;
// o's turn 5 completes six and is never judged.
export const judgedTurns: AnalysisTurn[] = [
    { turn: 1, toMove: `o`, lines: [{ cells: [{ x: -1, y: 1 }, { x: -1, y: 0 }], heuristic: 0.12 }] },
    {
        turn: 2,
        toMove: `x`,
        lines: [
            { cells: [{ x: 0, y: -1 }, { x: 1, y: -1 }], heuristic: 0.17 },
            { cells: [{ x: -1, y: 0 }, { x: 0, y: 2 }], heuristic: 0.1 },
            { cells: [{ x: 2, y: 0 }, { x: 1, y: 0 }], heuristic: 0.05 },
        ],
    },
    { turn: 3, toMove: `o`, lines: [{ cells: [{ x: 2, y: 1 }, { x: -1, y: 1 }], heuristic: 0.08 }] },
    {
        turn: 4,
        toMove: `x`,
        lines: [
            { cells: [{ x: -1, y: 1 }, { x: -1, y: 2 }], heuristic: 0.45 },
            { cells: [{ x: 0, y: -1 }, { x: 1, y: -1 }], heuristic: 0.3 },
            { cells: [{ x: 3, y: -1 }, { x: 4, y: -1 }], winIn: -3 },
        ],
    },
    { turn: 5, toMove: `o`, lines: [{ cells: [{ x: 4, y: 1 }, { x: 5, y: 1 }], winIn: -1 }] },
];

export const kestrel = { name: `kestrel`, version: `0.9`, ownerName: `tom` };

export function community(overrides: Partial<CommunityAnalysis> = {}): CommunityAnalysis {
    return {
        kind: `community`,
        analysisId: `a_1`,
        analyzer: kestrel,
        status: `done`,
        requestedAt: `2026-10-01T12:00:00Z`,
        finishedAt: `2026-10-01T12:01:00Z`,
        progress: { done: 5, of: 5 },
        seconds: 2,
        turns: judgedTurns,
        ...overrides,
    };
}

export const ownViews: OwnAnalysis[] = [
    {
        kind: `own`,
        side: `x`,
        player: `hextide`,
        turns: [
            { turn: 2, toMove: `x`, lines: [{ cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }], heuristic: 0.3 }, { cells: [{ x: 0, y: -1 }, { x: 1, y: -1 }], heuristic: 0.2 }] },
            { turn: 4, toMove: `x`, lines: [{ cells: [{ x: 3, y: -1 }, { x: 4, y: -1 }], heuristic: 0.1 }] },
        ],
    },
    {
        kind: `own`,
        side: `o`,
        player: `quietlake`,
        turns: [
            { turn: 1, toMove: `o`, lines: [{ cells: [{ x: 0, y: 1 }, { x: 1, y: 1 }], heuristic: -0.05 }] },
            { turn: 3, toMove: `o`, lines: [{ cells: [{ x: 2, y: 1 }, { x: 3, y: 1 }], heuristic: -0.2 }] },
            { turn: 5, toMove: `o`, lines: [{ cells: [{ x: 4, y: 1 }, { x: 5, y: 1 }], winIn: -1 }] },
        ],
    },
];
