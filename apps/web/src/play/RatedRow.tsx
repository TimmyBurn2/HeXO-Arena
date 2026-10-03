import { text } from '../text';

/**
 * The Rated switch, one quiet row for someone signed in: off plays the game
 * unrated for both sides.
 * At a strength other than the bot's default the game is practice, unrated
 * either way, so the switch stands off and disabled; against the person's
 * own bot it stands off and disabled too, saying why.
 */
export function RatedRow({ rated, practice, own, onRated }: { rated: boolean; practice: boolean; own: boolean; onRated: (rated: boolean) => void }) {
    const held = practice || own;
    return (
        <div className="rated-row">
            <label className="checkline">
                <span>{text.play.ratedSwitch}</span>
                <span className="rated-control">
                    {own ? <span className="rated-reason">{text.play.ownBot}</span> : null}
                    <input
                        type="checkbox"
                        role="switch"
                        checked={rated && !held}
                        disabled={held}
                        onChange={(event) => {
                            onRated(event.target.checked);
                        }}
                    />
                </span>
            </label>
        </div>
    );
}
