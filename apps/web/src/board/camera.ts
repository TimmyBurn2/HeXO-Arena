import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { AxialCoord } from '@hexo-arena/contract';
import { cellSize, frontierCells, viewBoxOf, type Frame } from './geometry';

// A cell spans this many svg units edge to edge across its flats.
const cellWidth = Math.sqrt(3) * cellSize;

// When the frontier is too big to fit, the camera frames the stones and
// this many cells round them.
const nearCells = 3;

function nearBox(stones: readonly AxialCoord[]): Frame {
    const box = viewBoxOf(stones);
    const dx = nearCells * cellWidth;
    const dy = nearCells * 1.5 * cellSize;
    return { x: box.x - dx, y: box.y - dy, w: box.w + 2 * dx, h: box.h + 2 * dy };
}

// The smallest a cell may render, from the scale sheet, which raises it
// for coarse pointers so a finger always hits one cell; a board that takes
// no taps keeps the reading minimum at any pointer.
function minCellPx(element: HTMLElement, reading: boolean): number {
    const style = getComputedStyle(element);
    const raw = style.getPropertyValue(reading ? `--board-cell-read` : `--board-cell-min`).trim();
    const rootPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return 0;
    return raw.endsWith(`rem`) ? value * rootPx : value;
}

// Where a camera stands: its element, the scale it draws at, and the box of the field it frames.
interface Camera {
    readonly ref: RefObject<HTMLDivElement | null>;
    readonly scale: number | undefined;
    readonly box: Frame;
}

/**
 * The board's camera over the frontier of `framed`, the position it frames:
 * the whole frontier when every cell stays at its minimum size, else the
 * stones and three cells round them, centered, scrolling natively.
 * It refits on a new stone count, a new viewport, or a change of `reading`,
 * a board that takes no taps; a mark in hand never moves it.
 */
export function useBoardCamera(framed: readonly AxialCoord[], reading: boolean): Camera {
    const ref = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState<{ w: number; h: number } | null>(null);
    const [scale, setScale] = useState<number | undefined>(undefined);
    const centerOn = useRef<{ cx: number; cy: number; scale: number } | null>(null);
    const box = useMemo(() => viewBoxOf(frontierCells(framed)), [framed]);

    useEffect(() => {
        const camera = ref.current;
        if (camera === null || typeof ResizeObserver === `undefined`) return;
        const observer = new ResizeObserver(() => {
            setSize({ w: camera.clientWidth, h: camera.clientHeight });
        });
        observer.observe(camera);
        return () => {
            observer.disconnect();
        };
    }, []);

    // The fit is read against the room between the paddings, centered once
    // the new size has laid out.
    useLayoutEffect(() => {
        const camera = ref.current;
        if (camera === null || size === null || size.w === 0 || size.h === 0) return;
        const style = getComputedStyle(camera);
        const w = size.w - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
        const h = size.h - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom);
        const least = minCellPx(camera, reading) / cellWidth;
        const whole = Math.min(w / box.w, h / box.h);
        if (whole >= least || framed.length === 0) {
            centerOn.current = null;
            setScale(whole);
            return;
        }
        const near = nearBox(framed);
        const next = Math.max(least, Math.min(w / near.w, h / near.h));
        centerOn.current = { cx: near.x + near.w / 2, cy: near.y + near.h / 2, scale: next };
        setScale(next);
        // Only the stone count refits, never the stones themselves, so a
        // board that keeps its count keeps its frame.
    }, [framed.length, size, reading]);

    // The stones center in the room between the paddings, which differ
    // above and below, once the refit's scale has laid out: in this same
    // commit when a new viewport kept the scale, else in the next.
    useLayoutEffect(() => {
        const camera = ref.current;
        const target = centerOn.current;
        if (camera === null || target === null || scale !== target.scale) return;
        const style = getComputedStyle(camera);
        const w = camera.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
        const h = camera.clientHeight - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom);
        camera.scrollLeft = (target.cx - box.x) * scale - w / 2;
        camera.scrollTop = (target.cy - box.y) * scale - h / 2;
        centerOn.current = null;
    }, [scale, box, size]);

    return { ref, scale, box };
}
