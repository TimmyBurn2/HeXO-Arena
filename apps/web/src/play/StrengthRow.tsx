import { useId } from 'react';
import { levelFacts, type BotListing, type Level } from '@hexo-arena/contract';
import { text } from '../text';

/**
 * The bot's strengths, weakest first, one chip each by its author's label,
 * the default marked as the rated one; what the picked one spends a turn
 * stands under the row. A bot that declares none shows no row.
 */
export function StrengthRow({ bot, level, onLevel }: { bot: BotListing; level: Level | null; onLevel: (id: string) => void }) {
    const ids = useId();
    const levels = bot.levels;
    if (levels === null) return null;
    const picked = levels.list.find((entry) => entry.id === (level?.id ?? levels.default));
    const facts = picked === undefined ? `` : levelFacts(picked);
    return (
        <div className="setup-block">
            <h3 className="play-label" id={`${ids}-strength`}>
                {text.play.strength}
            </h3>
            <div className="strength-chips" role="radiogroup" aria-labelledby={`${ids}-strength`}>
                {levels.list.map((entry) => (
                    <label key={entry.id} className="strength-chip">
                        <input
                            type="radio"
                            name={`${ids}-level`}
                            value={entry.id}
                            checked={entry.id === picked?.id}
                            aria-describedby={entry.id === picked?.id && (facts !== `` || picked.about !== undefined) ? `${ids}-facts` : undefined}
                            onChange={() => {
                                onLevel(entry.id);
                            }}
                        />
                        <span className="strength-label">{entry.label}</span>
                        {entry.id === levels.default ? <span className="strength-rated">{text.play.strengthRated}</span> : null}
                    </label>
                ))}
            </div>
            {picked === undefined || (facts === `` && picked.about === undefined) ? null : (
                <div className="strength-facts" id={`${ids}-facts`}>
                    {facts === `` ? null : <p className="note">{facts}</p>}
                    {picked.about === undefined ? null : <p className="note">{picked.about}</p>}
                </div>
            )}
        </div>
    );
}
