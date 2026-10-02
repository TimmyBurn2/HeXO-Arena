import { text } from '../text';
import { useBoardSettings } from './board-settings';

/**
 * The board switches, the same wherever they appear, all writing the one
 * stored setting every board reads.
 * `glare` adds the stone glare switch, a look rather than a reading aid.
 */
export function BoardToggles({ glare = false }: { glare?: boolean }) {
    const [settings, update] = useBoardSettings();
    return (
        <div className="board-toggles">
            <label className="checkline">
                <input
                    type="checkbox"
                    role="switch"
                    checked={settings.numbers}
                    onChange={(event) => {
                        update({ numbers: event.target.checked });
                    }}
                />
                {text.settings.stoneNumbers}
            </label>
            {glare ? (
                <label className="checkline">
                    <input
                        type="checkbox"
                        role="switch"
                        checked={settings.glare}
                        onChange={(event) => {
                            update({ glare: event.target.checked });
                        }}
                    />
                    {text.settings.stoneGlare}
                </label>
            ) : null}
        </div>
    );
}
