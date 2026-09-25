import { useBoardSettings } from './board-settings';
import { LookControls } from './LookControls';
import { Board } from './Board';
import { previewStones } from './preview-position';
import './BoardSettingsCard.css';

// Rings on empty cells and on the final pair, so a theme choice judges
// ring colors too.
const previewOverlays = {
    pending: { x: 1, y: 2 },
    focus: { x: 0, y: -2 },
    lastMove: [{ x: 2, y: 1 }, { x: -4, y: 2 }],
};

/**
 * The look controls with a live preview: the theme restyles the whole
 * site at once, the overlays add study aids to every board.
 */
export function BoardSettingsCard() {
    const [settings] = useBoardSettings();
    return (
        <div className="card board-settings">
            <LookControls />
            <Board
                stones={previewStones}
                settings={settings}
                label="preview board"
                overlays={previewOverlays}
            />
            <p className="note">
                the theme restyles the whole site; the preview uses the same
                rendering as the game screen, and choices persist in this browser
            </p>
        </div>
    );
}
