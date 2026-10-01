import type { TournamentDetail } from '@hexo-arena/contract';
import { cellPoints, cellSize } from '../board/geometry';
import { text } from '../text';
import { roundStates } from './view';

const halfWidth = (Math.sqrt(3) * cellSize) / 2;
const box = `${String(-halfWidth)} ${String(-cellSize)} ${String(2 * halfWidth)} ${String(2 * cellSize)}`;

/** The rounds as a strip of cells: filled when over, ringed in brass while live, empty to come. */
export function RoundSteps({ detail }: { detail: TournamentDetail }) {
    return (
        <ol className="round-steps" aria-label={text.tournaments.roundSteps}>
            {roundStates(detail).map(({ round, state }) => (
                <li key={round} className={`round-step round-step-${state}`} aria-label={text.tournaments.step(round, state)}>
                    <svg viewBox={box} aria-hidden="true">
                        <polygon points={cellPoints()} />
                    </svg>
                    <span aria-hidden="true">{String(round)}</span>
                </li>
            ))}
        </ol>
    );
}
