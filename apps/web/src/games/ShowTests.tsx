import { text } from '../text';

/** The Show tests switch beside a game list's tools. */
export function ShowTests({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
    return (
        <label className="checkline show-tests">
            <span>{text.games.showTests}</span>
            <input
                type="checkbox"
                role="switch"
                checked={on}
                onChange={(event) => {
                    onChange(event.target.checked);
                }}
            />
        </label>
    );
}
