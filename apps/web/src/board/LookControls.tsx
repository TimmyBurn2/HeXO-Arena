import { useId } from 'react';
import { themes, useTheme } from '../theme/themes';
import { useBoardSettings } from './board-settings';

/**
 * The theme and the board study aids, the same controls in Profile and in
 * the game drawer; every choice applies at once, everywhere.
 */
export function LookControls() {
    const [settings, update] = useBoardSettings();
    const [theme, chooseTheme] = useTheme();
    // Two sets of controls may share a page, so ids carry an instance prefix.
    const prefix = useId();
    return (
        <div className="controls">
            <fieldset>
                <legend>Theme</legend>
                {themes.map((candidate) => (
                    <span className="opt" key={candidate.id}>
                        <input
                            type="radio"
                            id={`${prefix}-theme-${candidate.id}`}
                            name={`${prefix}-theme`}
                            value={candidate.id}
                            checked={theme === candidate.id}
                            onChange={() => {
                                chooseTheme(candidate.id);
                            }}
                        />
                        <label htmlFor={`${prefix}-theme-${candidate.id}`}>{candidate.label}</label>
                    </span>
                ))}
            </fieldset>
            <label className="checkline">
                <input
                    type="checkbox"
                    checked={settings.numbers}
                    onChange={(event) => {
                        update({ numbers: event.target.checked });
                    }}
                />
                stone numbers
            </label>
            <label className="checkline">
                <input
                    type="checkbox"
                    checked={settings.coords}
                    onChange={(event) => {
                        update({ coords: event.target.checked });
                    }}
                />
                coordinates
            </label>
        </div>
    );
}
