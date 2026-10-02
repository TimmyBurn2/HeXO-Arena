import { useMemo } from 'react';
import { Board, type BoardStone } from '../board/Board';
import { defaultBoardSettings } from '../board/board-settings';
import { stonesFrame } from '../board/geometry';
import { text } from '../text';
import type { LiveView } from './use-live-replay';
import './MiniBoard.css';

// Minis sit in cards of one shape, so every frame takes the same aspect.
const miniAspect = 4 / 3;

// Numbers at this size would cover the stones they name.
const miniSettings = { ...defaultBoardSettings, numbers: false };

/**
 * A live game's board at a glance: read-only, keyless and unfocusable,
 * framed on the stones of its latest read,
 * so stones still landing fall inside a frame that holds still,
 * with the last turn ringed.
 * After the origin a turn is two stones,
 * so an even count is a turn half landed, and only its stone is ringed.
 */
export function MiniBoard({ game }: { game: LiveView }) {
    const { entry, cells, toMove } = game;
    const frame = useMemo(() => stonesFrame(entry.cells, miniAspect), [entry.cells]);
    const stones = useMemo<BoardStone[]>(() => cells.map((cell, index) => ({ ...cell, number: index + 1 })), [cells]);
    const { x, o } = entry.players;
    return (
        <div className="mini-board">
            <Board
                stones={stones}
                settings={miniSettings}
                label={text.live.board(x.name, o.name, entry.players[toMove].name)}
                overlays={{ lastMove: stones.slice(stones.length % 2 === 0 ? -1 : -2) }}
                frame={frame}
            />
        </div>
    );
}
