// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { meStore } from '../src/me';
import { AnalysisScreen } from '../src/screens/AnalysisScreen';
import { toyEngine, pieces, type ToyEngine } from './analysis-worker';

// The engine the board reads, set by each test; the board's analyzer source
// is swapped for it, guarded, and nothing else of the page changes.
const engines: { current: ToyEngine | null } = vi.hoisted(() => ({ current: null }));

vi.mock(import('../src/analysis/sources'), async (importOriginal) => {
    const original = await importOriginal();
    const { guarded } = await import('../src/analysis/guard');
    const { workerSource } = await import('../src/analysis/worker-source');
    return {
        ...original,
        botSource: () => {
            const engine = engines.current;
            if (engine === null) throw new Error(`no engine set`);
            return guarded(workerSource({ connect: () => engine.port, engine: `toy` }), {
                seats: { seated: () => false, subscribe: () => () => undefined },
                seatedByMe: () => Promise.resolve(false),
            });
        },
    };
});

const me = { kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: [], analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } };

function serveSite(checks: string[]): void {
    vi.stubGlobal(
        `fetch`,
        vi.fn((url: string, init?: RequestInit) => {
            if (url === `/api/analysis/check`) {
                checks.push(typeof init?.body === `string` ? init.body : ``);
                return Promise.resolve(new Response(null, { status: 204 }));
            }
            if (url === `/api/me`) return Promise.resolve(new Response(JSON.stringify(me)));
            return Promise.resolve(new Response(JSON.stringify([])));
        }),
    );
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    meStore.reset();
    engines.current = null;
    window.history.replaceState(null, ``, `/`);
});

describe('the analysis panel with an engine in the browser', () => {
    it('shows a worker\'s reading as it shows an analyzer\'s: who read it, its lines on the panel and the board, and the eval bar', async () => {
        engines.current = toyEngine({
            answer: (request) => ({
                move: { pieces: pieces({ x: 1, y: 0 }, { x: 0, y: 1 }), evaluation: { heuristic: -0.2 * Math.min(1, request.move_time_limit ?? 0) } },
                considerations: [
                    { pieces: pieces({ x: -1, y: 0 }, { x: 0, y: -1 }), evaluation: { heuristic: 0.05 } },
                    { pieces: pieces({ x: 1, y: -1 }, { x: -1, y: 1 }), evaluation: { heuristic: 0.1 } },
                ],
            }),
        });
        const checks: string[] = [];
        serveSite(checks);
        await meStore.refresh();
        window.history.replaceState(null, ``, `/analysis`);
        const { container } = render(<AnalysisScreen />);

        await waitFor(
            () => {
                expect(container.querySelector(`.an-by`)?.textContent).toBe(`toy0.3, in this browser; 2 s a position`);
            },
            { timeout: 4_000 },
        );
        expect(container.querySelector(`.an-by .badge-bot`)).toBeNull();
        expect([...container.querySelectorAll(`.an-line .an-value`)].map((value) => value.textContent)).toEqual([`o 0.20`, `x 0.05`, `x 0.10`]);
        expect(screen.getByRole(`button`, { name: /^Play line A: o 0\.20, o: \[1,0\] \[1,-1\]$/u })).toBeTruthy();
        expect(container.querySelector(`.an-state`)?.textContent).toMatch(/^Read in \d+\.\d s; o to move$/u);
        expect(container.querySelector(`.an-evalbar-chip`)?.textContent).toBe(`o 0.20`);
        expect(container.querySelectorAll(`.line-mark`).length).toBeGreaterThan(0);
        expect(checks).toEqual([JSON.stringify({ cells: [{ x: 0, y: 0, side: `x` }], toMove: `o` })]);
        expect(engines.current.requests.map((request) => request.move_time_limit)).toEqual([0.25, 0.5, 1, 2]);
    });
});
