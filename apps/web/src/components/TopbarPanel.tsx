import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import './TopbarPanel.css';

// The shell's phone breakpoint, where the tab strip takes over: at and
// below it a panel is a modal bottom sheet, above it a popover under the bar.
const sheetQuery = `(max-width: 30rem)`;

// What a click can hand focus to; a landing target with tabindex -1 is
// not one.
const controls = `a[href], button, input, select, textarea, summary, label, [tabindex]:not([tabindex="-1"])`;

type PanelId = `settings` | `identity` | `games-filters`;
type OpenMode = `popover` | `sheet`;

/** Whether a top-bar panel is shut, or open and in which form. */
export type PanelMode = `closed` | OpenMode;

// One panel at a time: opening one takes the place of any other.
let open: { id: PanelId; mode: OpenMode } | null = null;
const listeners = new Set<() => void>();

function setOpen(next: typeof open): void {
    open = next;
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function read(): typeof open {
    return open;
}

function modeForViewport(): OpenMode {
    return typeof window.matchMedia === `function` && window.matchMedia(sheetQuery).matches ? `sheet` : `popover`;
}

/** One top-bar button's hold on its panel. */
export interface PanelControl {
    mode: PanelMode;
    button: RefObject<HTMLButtonElement | null>;
    toggle: () => void;
    /** Shut the panel; focus goes back to its button only when asked. */
    close: (returnFocus: boolean) => void;
}

/**
 * The open state of a button's panel, a top-bar one or the games list's
 * filters, shared so that opening one panel shuts any other.
 */
export function usePanel(id: PanelId): PanelControl {
    const current = useSyncExternalStore(subscribe, read, read);
    const mode = current?.id === id ? current.mode : `closed`;
    const button = useRef<HTMLButtonElement>(null);
    const refocus = useRef(false);

    // Focus goes back only once the panel is gone, since an open sheet
    // keeps the button inert.
    useEffect(() => {
        if (mode === `closed` && refocus.current) {
            refocus.current = false;
            button.current?.focus();
        }
    }, [mode]);

    // A close aimed at a panel another has replaced must not shut that one.
    const close = useCallback(
        (returnFocus: boolean) => {
            if (open?.id !== id) return;
            refocus.current = returnFocus;
            setOpen(null);
        },
        [id],
    );

    const toggle = useCallback(() => {
        if (open?.id === id) {
            close(true);
        } else {
            setOpen({ id, mode: modeForViewport() });
        }
    }, [id, close]);

    // A button that leaves the bar takes its panel along.
    useEffect(
        () => () => {
            if (open?.id === id) setOpen(null);
        },
        [id],
    );

    return { mode, button, toggle, close };
}

/**
 * A panel under the button that opens it: a non-modal popover hanging
 * under its row, or a modal bottom sheet on phones.
 * Esc, a click elsewhere, or focus leaving shuts the popover; focus goes
 * back to the button unless it landed on another control.
 * Opening puts focus on the first element matching `initialFocus`.
 */
export function TopbarPanel({ id, className, control, labelledBy, head, closeLabel, initialFocus, children }: {
    id: string;
    className: string;
    control: PanelControl;
    labelledBy: string;
    head: ReactNode;
    closeLabel: string;
    initialFocus: string;
    children: ReactNode;
}) {
    if (control.mode === `closed`) return null;
    return (
        <OpenPanel
            id={id}
            className={className}
            mode={control.mode}
            button={control.button}
            onClose={control.close}
            labelledBy={labelledBy}
            head={head}
            closeLabel={closeLabel}
            initialFocus={initialFocus}
        >
            {children}
        </OpenPanel>
    );
}

function OpenPanel({ id, className, mode, button, onClose, labelledBy, head, closeLabel, initialFocus, children }: {
    id: string;
    className: string;
    mode: OpenMode;
    button: RefObject<HTMLButtonElement | null>;
    onClose: (returnFocus: boolean) => void;
    labelledBy: string;
    head: ReactNode;
    closeLabel: string;
    initialFocus: string;
    children: ReactNode;
}) {
    const ref = useRef<HTMLDialogElement>(null);

    // A rerun finds the dialog open and leaves it be.
    useLayoutEffect(() => {
        const dialog = ref.current;
        if (dialog === null || dialog.open) return;
        if (mode === `sheet`) {
            dialog.showModal();
        } else {
            dialog.show();
        }
        dialog.querySelector<HTMLElement>(initialFocus)?.focus();
    }, [mode, initialFocus]);

    // The popover leaves the page live, so Esc anywhere and a click
    // anywhere else close it; the browser routes both for the modal sheet.
    // A click on another control leaves focus with that control, and so
    // does focus reaching one past the button, as Shift+Tab does.
    useEffect(() => {
        if (mode !== `popover`) return;
        // A press elsewhere that opened the panel is still on its way up
        // when these listen, so a click from before the panel opened passes.
        const openedAt = performance.now();
        function onKey(event: KeyboardEvent) {
            if (event.key !== `Escape`) return;
            event.preventDefault();
            onClose(true);
        }
        function onClick(event: MouseEvent) {
            if (event.timeStamp < openedAt) return;
            const target = event.target;
            if (!(target instanceof Element) || ref.current?.contains(target) || button.current?.contains(target)) return;
            onClose(target.closest(controls) === null);
        }
        function onFocus(event: FocusEvent) {
            const target = event.target;
            if (!(target instanceof Node) || ref.current?.contains(target) || button.current?.contains(target)) return;
            onClose(false);
        }
        document.addEventListener(`keydown`, onKey);
        document.addEventListener(`click`, onClick);
        document.addEventListener(`focusin`, onFocus);
        return () => {
            document.removeEventListener(`keydown`, onKey);
            document.removeEventListener(`click`, onClick);
            document.removeEventListener(`focusin`, onFocus);
        };
    }, [mode, button, onClose]);

    return (
        <dialog
            ref={ref}
            id={id}
            className={`topbar-panel ${className}`}
            data-mode={mode}
            aria-labelledby={labelledBy}
            onClose={() => {
                onClose(true);
            }}
            onClick={(event) => {
                if (event.target === event.currentTarget) onClose(true);
            }}
            onBlur={(event) => {
                // Focus leaving the popover, by Tab or by a press elsewhere,
                // closes it; on another control, focus stays there.
                const next = event.relatedTarget;
                if (mode === `popover` && next instanceof Element && !event.currentTarget.contains(next) && next !== button.current) {
                    onClose(next.closest(controls) === null);
                }
            }}
        >
            {/* the dialog lifts and the body inside takes the cut, since
                the cut would clip the lift */}
            <div className="topbar-panel-body">
                <div className="topbar-panel-head">
                    {head}
                    <button
                        type="button"
                        className="topbar-panel-close"
                        aria-label={closeLabel}
                        onClick={() => {
                            onClose(true);
                        }}
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                    </button>
                </div>
                {children}
            </div>
        </dialog>
    );
}
