import { useBoardSettings, type BoardPalette, type StoneStyle } from './board-settings';
import { Board } from './Board';
import { previewStones } from './preview-position';

// The same overlay showcase the mockup carried: rings on empty cells and
// on the final pair, so a palette choice judges ring colors too.
const previewOverlays = {
    pending: { x: 1, y: 2 },
    focus: { x: 0, y: -2 },
    lastMove: [{ x: 2, y: 1 }, { x: -4, y: 2 }],
};

const palettes: readonly { value: BoardPalette; label: string }[] = [
    { value: `slate`, label: `slate` },
    { value: `walnut`, label: `walnut` },
];

const stoneStyles: readonly { value: StoneStyle; label: string }[] = [
    { value: `disc`, label: `disc` },
    { value: `hex`, label: `hex` },
    { value: `glyph`, label: `x o` },
];

/**
 * The rendering controls with a live preview: one attribute swap on the
 * preview board is the whole mechanism, and the same attributes render
 * every game board from the stored settings.
 */
export function BoardSettingsCard() {
    const [settings, update] = useBoardSettings();
    return (
        <div className="card board-settings">
            <div className="controls">
                <fieldset>
                    <legend>palette</legend>
                    {palettes.map((palette) => (
                        <span className="opt" key={palette.value}>
                            <input
                                type="radio"
                                id={`palette-${palette.value}`}
                                name="board-palette"
                                value={palette.value}
                                checked={settings.palette === palette.value}
                                onChange={() => {
                                    update({ palette: palette.value });
                                }}
                            />
                            <label htmlFor={`palette-${palette.value}`}>{palette.label}</label>
                        </span>
                    ))}
                </fieldset>
                <fieldset>
                    <legend>stones</legend>
                    {stoneStyles.map((style) => (
                        <span className="opt" key={style.value}>
                            <input
                                type="radio"
                                id={`stones-${style.value}`}
                                name="board-stones"
                                value={style.value}
                                checked={settings.stones === style.value}
                                onChange={() => {
                                    update({ stones: style.value });
                                }}
                            />
                            <label htmlFor={`stones-${style.value}`}>{style.label}</label>
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
            <Board
                stones={previewStones}
                settings={settings}
                label="preview board"
                overlays={previewOverlays}
            />
            <p className="note">
                the preview uses the same rendering as the game screen; choices
                persist in this browser and apply to every game
            </p>
        </div>
    );
}
