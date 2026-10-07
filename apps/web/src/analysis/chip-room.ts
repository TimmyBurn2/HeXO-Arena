import { useLayoutEffect, type RefObject } from 'react';

/**
 * Keeps the eval bar's chip clear of the stage's plates, the source above and the steps below, at any value and text size:
 * sets on the bar where the chip's middle may run, `--chip-low` under the source plate and `--chip-high` over the steps,
 * each the room a plate keeps from the stage's edge away from it and half the chip clear of it;
 * where the stage leaves no such room, the bar takes `data-cramped` and the chip hides.
 * `chipped` names whether the bar draws a chip, so a chip that comes or goes is measured again.
 */
export function useChipRoom(bar: RefObject<HTMLDivElement | null>, chipped: boolean): void {
    useLayoutEffect(() => {
        const element = bar.current;
        const stage = element === null ? null : element.parentElement;
        if (element === null || stage === null) return;
        const source = stage.querySelector(`.an-chip-source`);
        const steps = stage.querySelector(`.an-chip-nav`);
        const chip = element.querySelector(`.an-evalbar-chip`);
        const measure = () => {
            if (!(chip instanceof HTMLElement) || chip.getClientRects().length === 0) return;
            const box = element.getBoundingClientRect();
            const half = chip.offsetHeight / 2;
            const low = shown(source) ? source.getBoundingClientRect().bottom - box.top + inset(source, `top`) + half : half;
            const high = shown(steps) ? steps.getBoundingClientRect().top - box.top - inset(steps, `bottom`) - half : box.height - half;
            element.style.setProperty(`--chip-low`, `${low.toFixed(1)}px`);
            element.style.setProperty(`--chip-high`, `${high.toFixed(1)}px`);
            element.toggleAttribute(`data-cramped`, low > high);
        };
        measure();
        if (typeof ResizeObserver === `undefined`) return;
        const watcher = new ResizeObserver(measure);
        for (const each of [stage, source, steps, chip]) if (each !== null) watcher.observe(each);
        return () => {
            watcher.disconnect();
        };
    }, [bar, chipped]);
}

function shown(element: Element | null): element is Element {
    return element !== null && element.getClientRects().length > 0;
}

// The room a plate keeps from the stage's edge, which the chip keeps from the plate.
function inset(element: Element, side: `top` | `bottom`): number {
    const value = Number.parseFloat(getComputedStyle(element)[side]);
    return Number.isFinite(value) ? value : 0;
}
