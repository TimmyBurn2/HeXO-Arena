import { useId } from 'react';
import { text } from '../text';
import { levelFits, mantisLevels, type useMantis } from './mantis';

const words = text.analysis.mantis;

/** Mantis on this board: its level, the side it plays or the way to stop it, and where it stands. */
export function MantisCard({ mantis }: { mantis: ReturnType<typeof useMantis> }) {
    const titleId = useId();
    const levelId = useId();
    const { mode, info, level, thinking } = mantis;
    const status =
        mode.kind === `loading` ? words.loading : mode.kind === `playing` ? (thinking ? words.thinking : words.waiting) : null;
    return (
        <section className="an-mantis" aria-labelledby={titleId}>
            <h2 className="card-title" id={titleId}>
                {words.title}
            </h2>
            <p className="note">{words.note}</p>
            <div className="an-mantis-level">
                <label className="field-label" htmlFor={levelId}>
                    {words.level}
                </label>
                <select
                    id={levelId}
                    value={String(mantisLevels.indexOf(level))}
                    onChange={(event) => {
                        const picked = mantisLevels[Number(event.target.value)];
                        if (picked !== undefined) mantis.setLevel(picked);
                    }}
                >
                    {mantisLevels.map((each, index) =>
                        levelFits(each, info) ? (
                            <option key={index} value={String(index)}>
                                {`sims` in each ? words.sims(each.sims) : words.seconds(each.turnMs)}
                            </option>
                        ) : null,
                    )}
                </select>
            </div>
            <div className="card-actions">
                {mode.kind === `off` ? (
                    <>
                        <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => {
                                mantis.start(`o`);
                            }}
                        >
                            {words.plays(`o`)}
                        </button>
                        <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                                mantis.start(`x`);
                            }}
                        >
                            {words.plays(`x`)}
                        </button>
                    </>
                ) : (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={mantis.stop}>
                        {words.stop}
                    </button>
                )}
            </div>
            {mode.kind === `off` && mode.problem !== null ? (
                <p className="an-error" role="alert">
                    {words.problems[mode.problem]}
                </p>
            ) : (
                <p className="note an-mantis-status" role="status">
                    {status}
                    {info === null ? null : <span className="an-mantis-backend">{words.backend[info.backend]}</span>}
                </p>
            )}
        </section>
    );
}
