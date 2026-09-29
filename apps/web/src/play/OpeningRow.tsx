import { useId, useState } from 'react';
import { openingPliesValues, type OpeningPlies } from '@hexo-arena/contract';
import { text } from '../text';
import { OpeningPreview } from './OpeningPreview';

/**
 * The opening, one quiet row until opened: the count, and an example the
 * server could deal for it.
 */
export function OpeningRow({ opening, onOpening }: { opening: OpeningPlies; onOpening: (opening: OpeningPlies) => void }) {
    const [draws, setDraws] = useState(0);
    const [open, setOpen] = useState(false);
    const ids = useId();
    return (
        <details
            className="opening"
            open={open}
            onToggle={(event) => {
                setOpen(event.currentTarget.open);
            }}
        >
            <summary>
                <span>{text.play.opening}</span>
                <span className="opening-value">{text.play.openingValue(opening)}</span>
                <svg className="chevron" viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M2 4.5l4 4 4-4" />
                </svg>
            </summary>
            {open ? (
                <div className="opening-body">
                    <OpeningPreview plies={opening} draw={draws} />
                    <div className="opening-controls">
                        <fieldset>
                            <legend>{text.play.openingStones}</legend>
                            <div className="opening-counts">
                                {openingPliesValues.map((count) => (
                                    <span className="opt" key={count}>
                                        <input
                                            type="radio"
                                            id={`${ids}-${String(count)}`}
                                            name={`${ids}-opening`}
                                            value={count}
                                            checked={opening === count}
                                            onChange={() => {
                                                onOpening(count);
                                                setDraws((current) => current + 1);
                                            }}
                                            onClick={() => {
                                                // A press on the count already picked is still the person's pick.
                                                if (opening === count) onOpening(count);
                                            }}
                                            onKeyUp={(event) => {
                                                // Space on a radio already checked fires no click.
                                                if (event.key === ` ` && opening === count) onOpening(count);
                                            }}
                                        />
                                        <label htmlFor={`${ids}-${String(count)}`}>{String(count)}</label>
                                    </span>
                                ))}
                            </div>
                        </fieldset>
                        <p className="opening-caption">{opening === 1 ? text.play.originOnly : text.play.randomStones(opening - 1)}</p>
                    </div>
                </div>
            ) : null}
        </details>
    );
}
