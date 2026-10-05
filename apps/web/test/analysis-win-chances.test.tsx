// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { undeclaredValues, valueWords, winChanceCuts, type AnalyzerValues, type GamePlayer, type ValueText } from '@hexo-arena/contract';
import { originSetup, type Setup, type TurnCells } from '@hexo-arena/rules';
import { communityReading, gameLineOf } from '../src/analysis/game-readings';
import { MoveList } from '../src/analysis/MoveList';
import { EvalBar, Lines } from '../src/analysis/ReadingPanel';
import { shownLines } from '../src/analysis/reading-view';
import { newTree, play, rootId } from '../src/analysis/tree';
import { PeekReadout } from '../src/game/DrawerAnalysis';
import { feedNotes } from '../src/game/drawer-reading';
import { GameDrawer } from '../src/game/GameDrawer';
import { community, judgedCells, judgedTurns } from './judged-game';

// kestrel's heuristic is its estimate of x's expected result; a raw one only ranks.
const expected: AnalyzerValues = { scale: 1, cuts: winChanceCuts, meaning: `expected` };
const raw: AnalyzerValues = { ...expected, meaning: `raw` };

beforeEach(() => {
    vi.stubGlobal(
        `fetch`,
        vi.fn(() => Promise.resolve(new Response(null, { status: 404 }))),
    );
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('the analysis window\'s lines and eval bar', () => {
    function lineA(values: AnalyzerValues) {
        const reading = { by: { kind: `bot`, name: `kestrel`, version: `0.9`, ownerName: `tom` }, values, lines: [{ cells: [{ x: 1, y: -1 }, { x: 0, y: -1 }], evaluation: { heuristic: -0.24 } }], seconds: 2, final: true, elapsedMs: 900 } as const;
        const [line] = shownLines(reading, originSetup, `o`, 1);
        if (line === undefined) throw new Error(`no line`);
        return line;
    }

    it('name a six the side to move holds as its win in 1 on the chip, never the longer win a line that leaves it claims', () => {
        // x has five in a row from the origin, so x to move completes six this turn.
        const stones = [[0, 0, 0], [0, 3, 1], [1, 3, 1], [1, 0, 0], [2, 0, 0], [-2, 3, 1], [-1, 3, 1], [3, 0, 0], [4, 0, 0]] as const;
        const position: Setup = { stones: stones.map(([x, y, player]) => ({ x, y, player })), toMove: 0 };
        const reading = { by: { kind: `bot`, name: `kestrel`, version: `0.9`, ownerName: `tom` }, values: expected, lines: [{ cells: [{ x: 0, y: 1 }, { x: 1, y: 1 }], evaluation: { win_in: 4 } }], seconds: 2, final: true, elapsedMs: 900 } as const;
        const [line] = shownLines(reading, position, `x`, 1);
        if (line === undefined) throw new Error(`no line`);
        const { container } = render(<EvalBar line={line} held={false} />);
        expect(container.querySelector(`.an-evalbar-chip`)?.textContent).toBe(`x wins in 1`);
        expect(container.querySelector<HTMLElement>(`.an-evalbar`)?.style.getPropertyValue(`--x-share`)).toBe(`100.0%`);
    });

    it('show an expected value as the leading side\'s win chance, and name the line with it spoken in full', () => {
        const line = lineA(expected);
        const { container } = render(
            <>
                <Lines lines={[line]} toMove="o" onPreview={() => undefined} onPlay={() => undefined} />
                <EvalBar line={line} held={false} />
            </>,
        );
        expect(container.querySelector(`.an-line .an-value`)?.textContent).toBe(`o 62%`);
        expect(screen.getByRole(`button`, { name: `Play line A: o's win chance 62 percent, o: [0,1] [-1,1]` })).toBeTruthy();
        expect(container.querySelector(`.an-evalbar-chip`)?.textContent).toBe(`o 62%`);
    });

    it('keep a raw value in hundredths, spoken as shown', () => {
        const line = lineA(raw);
        const { container } = render(
            <>
                <Lines lines={[line]} toMove="o" onPreview={() => undefined} onPlay={() => undefined} />
                <EvalBar line={line} held={false} />
            </>,
        );
        expect(container.querySelector(`.an-line .an-value`)?.textContent).toBe(`o 0.24`);
        expect(screen.getByRole(`button`, { name: `Play line A: o 0.24, o: [0,1] [-1,1]` })).toBeTruthy();
        expect(container.querySelector(`.an-evalbar-chip`)?.textContent).toBe(`o 0.24`);
    });
});

describe('a move list row\'s value', () => {
    function rowOf(value: ValueText | null) {
        const cells: TurnCells = [
            { x: 1, y: 0 },
            { x: 0, y: 1 },
        ];
        const played = play(newTree({ kind: `origin` }), rootId, cells);
        if (!played.ok) throw new Error(`refused`);
        return render(
            <MoveList
                tree={played.tree}
                gameTurns={[]}
                at={played.node}
                onGo={() => undefined}
                actions={{ promote: () => undefined, remove: () => undefined, copy: () => undefined }}
                facts={new Map([[played.node, { judgment: null, value }]])}
                folds={[]}
            />,
        );
    }

    it('show a win chance to the eye and say it in full in the row\'s name', () => {
        const { container } = rowOf(valueWords({ heuristic: 0.34 }, { kind: `board` }, expected));
        const value = container.querySelector(`.an-row-value`);
        expect(value?.textContent).toBe(`x 67%`);
        expect(value?.getAttribute(`aria-hidden`)).toBe(`true`);
        expect(screen.getByRole(`button`, { name: /^1 .+ x's win chance 67 percent$/u })).toBeTruthy();
    });

    it('say a raw value as it shows', () => {
        const { container } = rowOf(valueWords({ heuristic: 0.34 }, { kind: `board` }, undeclaredValues));
        const value = container.querySelector(`.an-row-value`);
        expect(value?.textContent).toBe(`x 0.34`);
        expect(value?.hasAttribute(`aria-hidden`)).toBe(false);
        expect(screen.getByRole(`button`, { name: /^1 .+ x 0\.34$/u })).toBeTruthy();
    });
});

describe('the game panel\'s feed and peek', () => {
    const line = gameLineOf(judgedCells, 1);
    const reading = communityReading(line, judgedTurns, true, expected);
    const players: Record<`x` | `o`, GamePlayer> = {
        x: { name: `hextide`, rating: 1712, provisional: false, kind: `bot` },
        o: { name: `quietlake`, rating: 1690, provisional: true, kind: `bot` },
    };
    const choice = { kind: `community`, id: `kestrel`, name: `kestrel`, analysis: community() } as const;

    it('show each turn\'s win chance after it in the feed, said in full', () => {
        const feed = [`op 0`, `1`, `2`, `3`, `4`, `5`].map((label, index) => ({ label, spoken: label, groups: [`turn ${String(index)}`] }));
        const { container } = render(
            <GameDrawer
                drawer={{ visible: true, openedBy: `hand`, pinned: false, pinnable: false, tab: `moves`, show: () => undefined, hide: () => undefined, toggle: () => undefined, choose: () => undefined, pin: () => undefined }}
                feed={feed}
                current={1}
                notes={feedNotes(line, reading, feed.length, `kestrel`)}
                folds={[]}
                onLine={() => undefined}
                onPoint={() => undefined}
                head={null}
                facts={[]}
                meetings={null}
                rundown={null}
                event={null}
                analysis={null}
                running={false}
                timed={false}
                onResign={null}
                peek={null}
            />,
        );
        const first = container.querySelectorAll(`.feed-line`)[1];
        expect(first?.querySelector(`.feed-value`)?.textContent).toBe(`x\u00a059%`);
        expect(first?.querySelector(`.feed-value`)?.getAttribute(`aria-hidden`)).toBe(`true`);
        expect(first?.querySelector(`.feed-value + .sr-only`)?.textContent).toBe(`x's win chance 59 percent`);
        const forced = container.querySelectorAll(`.feed-line`)[4];
        expect(forced?.querySelector(`.feed-value`)?.textContent).toBe(`o wins in 1`);
        expect(forced?.querySelector(`.feed-value`)?.hasAttribute(`aria-hidden`)).toBe(false);
    });

    it('read the turn shown in the peek with its win chance said in full, and a judged turn by its verdict', () => {
        const { container, unmount } = render(<PeekReadout card={null} view={reading} choice={choice} turn={1} players={players} />);
        expect(container.querySelector(`.peek-readout-words`)?.textContent).toBe(`quietlake: x 59%; kestrel`);
        expect(container.querySelector(`.peek-readout .sr-only`)?.textContent).toBe(`quietlake: x's win chance 59 percent; kestrel`);
        unmount();
        const judged = render(<PeekReadout card={null} view={reading} choice={choice} turn={2} players={players} />);
        expect(judged.container.querySelector(`.peek-readout-words`)?.textContent).toBe(`hextide: inaccuracy; kestrel`);
        expect(judged.container.querySelector(`.peek-readout-words`)?.hasAttribute(`aria-hidden`)).toBe(false);
    });
});
