import { BoardToggles } from '../board/BoardToggles';
import { ThemeSwatch } from '../board/ThemeSwatch';
import { TopbarPanel, usePanel } from '../components/TopbarPanel';
import { Link } from '../router/Link';
import { themes, useTheme } from '../theme/themes';
import './Settings.css';

/**
 * The look and the board aids from any framed screen: a gear in the top
 * bar that opens a popover, or a modal bottom sheet on phones.
 * Every choice applies at once and persists in this browser.
 */
export function Settings() {
    const control = usePanel(`settings`);
    const [theme, chooseTheme] = useTheme();

    return (
        <>
            <button
                ref={control.button}
                type="button"
                className="settings-gear"
                aria-label="Settings"
                aria-haspopup="dialog"
                aria-expanded={control.mode !== `closed`}
                aria-controls={control.mode === `closed` ? undefined : `settings-panel`}
                onClick={control.toggle}
            >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    {/* drawn for this site rather than taken from an icon set, so it needs no credit */}
                    <path d="M9.42 5.28L9.75 2.26L14.25 2.26L14.58 5.28L16.53 6.4L19.31 5.18L21.56 9.08L19.11 10.87L19.11 13.13L21.56 14.92L19.31 18.82L16.53 17.6L14.58 18.72L14.25 21.74L9.75 21.74L9.42 18.72L7.47 17.6L4.69 18.82L2.44 14.92L4.89 13.13L4.89 10.87L2.44 9.08L4.69 5.18L7.47 6.4ZM14.77 13.6L12 15.2L9.23 13.6L9.23 10.4L12 8.8L14.77 10.4Z" />
                </svg>
            </button>
            {/* Opening lands on the checked look, so arrows start from the
                current choice. */}
            <TopbarPanel
                id="settings-panel"
                className="settings"
                control={control}
                labelledBy="settings-title"
                head={
                    <h2 id="settings-title" className="settings-title">
                        Settings
                    </h2>
                }
                closeLabel="Close settings"
                initialFocus={`input[type="radio"]:checked`}
            >
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
                            control.close(false);
                        }}
                    >
                        Credits
                    </Link>
                </p>
            </TopbarPanel>
        </>
    );
}
