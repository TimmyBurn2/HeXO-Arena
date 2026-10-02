import { text } from '../text';

/**
 * The Rated switch, one quiet row for someone signed in: off plays the game
 * unrated for both sides.
 * At a strength other than the bot's default the game is practice, unrated
 * either way, so the switch stands off and disabled.
 */
export function RatedRow({ rated, practice, onRated }: { rated: boolean; practice: boolean; onRated: (rated: boolean) => void }) {
    return (
        <div className="rated-row">
            <label className="checkline">
                <span>{text.play.ratedSwitch}</span>
                <input
                    type="checkbox"
                    role="switch"
                    checked={rated && !practice}
                    disabled={practice}
                    onChange={(event) => {
                        onRated(event.target.checked);
                    }}
                />
            </label>
        </div>
    );
}
