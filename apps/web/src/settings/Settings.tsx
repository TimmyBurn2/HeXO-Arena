import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { BoardToggles } from '../board/BoardToggles';
import { ThemeSwatch } from '../board/ThemeSwatch';
import { Link } from '../router/Link';
import { themes, useTheme } from '../theme/themes';
import './Settings.css';

// The shell's phone breakpoint, where the tab strip takes over: below it
// the panel is a modal bottom sheet, above it a popover under the gear.
const sheetQuery = `(max-width: 30rem)`;

// What a click can hand focus to; a landing target with tabindex -1 is
// not one.
const controls = `a[href], button, input, select, textarea, summary, label, [tabindex]:not([tabindex="-1"])`;

type Mode = `closed` | `popover` | `sheet`;
type OpenMode = Exclude<Mode, `closed`>;

function modeForViewport(): OpenMode {
    return typeof window.matchMedia === `function` && window.matchMedia(sheetQuery).matches ? `sheet` : `popover`;
}

/**
 * The look and the board aids from any framed screen: a gear in the top
 * bar that opens a popover, or a modal bottom sheet on phones.
 * Every choice applies at once and persists in this browser.
 */
export function Settings() {
    const [mode, setMode] = useState<Mode>(`closed`);
    const gearRef = useRef<HTMLButtonElement>(null);
    const refocus = useRef(false);

    // Focus goes back only once the panel is gone, since an open sheet
    // keeps the gear inert.
    useEffect(() => {
        if (mode === `closed` && refocus.current) {
            refocus.current = false;
            gearRef.current?.focus();
        }
    }, [mode]);

    const close = useCallback((returnFocus: boolean) => {
        refocus.current = returnFocus;
        setMode(`closed`);
    }, []);

    return (
        <>
            <button
                ref={gearRef}
                type="button"
                className="settings-gear"
                aria-label="Settings"
                aria-haspopup="dialog"
                aria-expanded={mode !== `closed`}
                aria-controls={mode === `closed` ? undefined : `settings-panel`}
                onClick={() => {
                    if (mode === `closed`) {
                        setMode(modeForViewport());
                    } else {
                        close(true);
                    }
                }}
            >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    {/* drawn for this site rather than taken from an icon set, so it needs no credit */}
                    <path d="M9.42 5.28L9.75 2.26L14.25 2.26L14.58 5.28L16.53 6.4L19.31 5.18L21.56 9.08L19.11 10.87L19.11 13.13L21.56 14.92L19.31 18.82L16.53 17.6L14.58 18.72L14.25 21.74L9.75 21.74L9.42 18.72L7.47 17.6L4.69 18.82L2.44 14.92L4.89 13.13L4.89 10.87L2.44 9.08L4.69 5.18L7.47 6.4ZM14.77 13.6L12 15.2L9.23 13.6L9.23 10.4L12 8.8L14.77 10.4Z" />
                </svg>
            </button>
            {mode === `closed` ? null : <SettingsPanel mode={mode} gear={gearRef} onClose={close} />}
        </>
    );
}

function SettingsPanel({ mode, gear, onClose }: {
    mode: OpenMode;
    gear: RefObject<HTMLButtonElement | null>;
    onClose: (returnFocus: boolean) => void;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    const [theme, chooseTheme] = useTheme();

    // Opening lands on the checked look, so arrows start from the current
    // choice; a rerun finds the dialog open and leaves it be.
    useLayoutEffect(() => {
        const dialog = ref.current;
        if (dialog === null || dialog.open) return;
        if (mode === `sheet`) {
            dialog.showModal();
        } else {
            dialog.show();
        }
        dialog.querySelector<HTMLInputElement>(`input[type="radio"]:checked`)?.focus();
    }, [mode]);

    // The popover leaves the page live, so Esc anywhere and a click
    // anywhere else close it; the browser routes both for the modal sheet.
    // A click on another control leaves focus with that control.
    useEffect(() => {
        if (mode !== `popover`) return;
        function onKey(event: KeyboardEvent) {
            if (event.key !== `Escape`) return;
            event.preventDefault();
            onClose(true);
        }
        function onClick(event: MouseEvent) {
            const target = event.target;
            if (!(target instanceof Element) || ref.current?.contains(target) || gear.current?.contains(target)) return;
            onClose(target.closest(controls) === null);
        }
        document.addEventListener(`keydown`, onKey);
        document.addEventListener(`click`, onClick);
        return () => {
            document.removeEventListener(`keydown`, onKey);
            document.removeEventListener(`click`, onClick);
        };
    }, [mode, gear, onClose]);

    return (
        <dialog
            ref={ref}
            id="settings-panel"
            className="settings"
            data-mode={mode}
            aria-labelledby="settings-title"
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
                if (mode === `popover` && next instanceof Element && !event.currentTarget.contains(next) && next !== gear.current) {
                    onClose(next.closest(controls) === null);
                }
            }}
        >
            {/* the dialog lifts and the panel inside takes the cut, since
                the cut would clip the lift */}
            <div className="settings-panel">
                <div className="settings-head">
                    <h2 id="settings-title" className="settings-title">
                        Settings
                    </h2>
                    <button
                        type="button"
                        className="settings-close"
                        aria-label="Close settings"
                        onClick={() => {
                            onClose(true);
                        }}
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                    </button>
                </div>
                <fieldset className="settings-group">
                    <legend className="settings-legend">Look</legend>
                    <div className="theme-cards">
                        {/* the name labels each look and the credit describes it,
                            so arrowing through reads the name first */}
                        {themes.map((candidate) => (
                            <label key={candidate.id} className="theme-card">
                                <input
                                    type="radio"
                                    name="settings-theme"
                                    value={candidate.id}
                                    checked={theme === candidate.id}
                                    aria-labelledby={`theme-name-${candidate.id}`}
                                    aria-describedby={`theme-credit-${candidate.id}`}
                                    onChange={() => {
                                        chooseTheme(candidate.id);
                                    }}
                                />
                                <ThemeSwatch theme={candidate.id} />
                                <span className="theme-text">
                                    <span id={`theme-name-${candidate.id}`}>{candidate.label}</span>
                                    <span className="theme-credit" id={`theme-credit-${candidate.id}`}>
                                        {candidate.credit}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </div>
                </fieldset>
                <fieldset className="settings-group">
                    <legend className="settings-legend">Board</legend>
                    <BoardToggles glare />
                </fieldset>
                <p className="note settings-foot">
                    Saved in this browser. Themes other than Ink come from community projects.{` `}
                    <Link
                        to="/credits"
                        onNavigate={() => {
                            onClose(false);
                        }}
                    >
                        Credits
                    </Link>
                </p>
            </div>
        </dialog>
    );
}
