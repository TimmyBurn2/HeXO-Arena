import type { Estimate } from '@hexo-arena/contract';
import { text } from '../text';

/** One of a duel's two bots, in the order named; or a test's bot against the rest. */
export type DuelSide = `first` | `second`;

/** The other of a duel's two sides. */
export const otherSide = (side: DuelSide): DuelSide => (side === `first` ? `second` : `first`);

/** A count of points, a game without a winner as a half. */
export function pointsText(points: number): string {
    return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

/** A rating difference with its sign. */
export function signed(value: number): string {
    return text.duels.estimate.signed(value);
}

/** Whether one side won every game the estimate counts. */
export function sweptBy(estimate: Estimate): DuelSide | null {
    const favored = estimate.favored;
    return favored !== null && estimate.points[otherSide(favored)] === 0 ? favored : null;
}

/** Seconds as a countdown reads them, minutes and seconds. */
export function countdown(seconds: number): string {
    return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, `0`)}`;
}
