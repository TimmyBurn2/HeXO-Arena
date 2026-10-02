import { judgmentGlyphs, type JudgmentSeverity } from '@hexo-arena/contract';
import { text } from '../text';
import './Judgment.css';

/**
 * A judged turn's mark: its glyph to the eye, and its severity to assistive tech
 * unless the words beside it already say it; the blunder is the one filled chip.
 */
export function JudgmentChip({ severity, spoken = true }: { severity: JudgmentSeverity; spoken?: boolean }) {
    return (
        <span className={`jd jd-${severity}`}>
            <span aria-hidden="true">{judgmentGlyphs[severity]}</span>
            {spoken ? <span className="sr-only">{text.analysis.judged.severities[severity]}</span> : null}
        </span>
    );
}
