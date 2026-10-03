import { useId } from 'react';
import { text } from '../text';

/**
 * The Rated switch, one quiet row for someone signed in: off plays the game
 * unrated for both sides.
 * At a strength other than the bot's default the game is practice, unrated
 * either way, so the switch stands off and disabled; against the person's
 * own bot, a test, it stands off and disabled too, saying why under it.
 */
export function RatedRow({ rated, practice, own, bot, onRated }: { rated: boolean; practice: boolean; own: boolean; bot: string; onRated: (rated: boolean) => void }) {
    const held = practice || own;
    const ids = useId();
    return (
        <div className="rated-row">
            <label className="checkline">
                <span>{text.play.ratedSwitch}</span>
                <input
                    type="checkbox"
                    role="switch"
                    checked={rated && !held}
                    disabled={held}
                    aria-describedby={own ? `${ids}-own` : undefined}
                    onChange={(event) => {
                        onRated(event.target.checked);
                    }}
                />
            </label>
            {own ? (
                <p className="note rated-line" id={`${ids}-own`}>
                    {text.play.ownBot(bot)}
                </p>
            ) : null}
        </div>
    );
}
