import { useRef, type CSSProperties } from 'react';
import type { HtttxEvaluation, HtttxInfo } from '@hexo-arena/contract';
import type { BoardVisual } from '../board/Board';
import { boardVisual } from './board-view';
import { text } from '../text';
import { useChipRoom } from './chip-room';
import { cellText } from './notation';
import { SpokenText } from './SpokenText';
import { shownNotes } from './study';
import type { TreeNode } from './tree';
import { clockText, importedWords } from './words';

const words = text.analysis.notes;

/**
 * What an imported text said of the turn shown, named as the text's own and never judged:
 * after each of its stones, the evaluation in words and the clock left; and whether the board shows its highlights and labels.
 * Nothing for a turn the text said nothing of.
 */
export function ImportedNotes({ node }: { node: TreeNode | undefined }) {
    if (node === undefined || node.kind === `root` || node.notes === null) return null;
    const cells = node.kind === `half` ? [node.cell] : node.cells;
    const said = [node.notes.first, node.notes.second].flatMap((notes, index) => {
        const cell = cells[index];
        return notes === null || notes.info === null || cell === undefined ? [] : [{ cell: cellText(cell), info: notes.info }];
    });
    const visuals = (shownNotes(node)?.visuals ?? []).map(boardVisual);
    if (said.length === 0 && visuals.length === 0) return null;
    return (
        <section className="an-notes" aria-label={words.title}>
            <p className="an-notes-title">{words.title}</p>
            {said.map(({ cell, info }) => (
                <p key={cell} className="an-notes-row">
                    <span className="an-notes-after">{words.after(cell)}</span> <InfoWords info={info} />
                </p>
            ))}
            {visuals.length === 0 ? null : <VisualWords visuals={visuals} />}
        </section>
    );
}

// What the board draws for the text, named in short to the eye and listed in full for assistive tech:
// each highlight's cells by its tone, and each label with its cell.
function VisualWords({ visuals }: { visuals: readonly BoardVisual[] }) {
    const tones = ([`neutral`, `x`, `o`] as const).flatMap((tone) => {
        const cells = visuals.filter((visual) => visual.tone === tone).map((visual) => cellText(visual.cell));
        return cells.length === 0 ? [] : [words.tone(cells, tone)];
    });
    const labels = visuals.flatMap((visual) => (visual.label === null ? [] : [words.labelOn(visual.label, cellText(visual.cell))]));
    const shown = tones.length > 0 && labels.length > 0 ? words.both : tones.length > 0 ? words.highlights : words.labels;
    return (
        <p className="an-notes-row">
            <span aria-hidden="true">{shown}</span>
            <span className="sr-only">{[tones.length === 0 ? `` : words.highlightsSpoken(tones), labels.length === 0 ? `` : words.labelsSpoken(labels)].filter((part) => part !== ``).join(` `)}</span>
        </p>
    );
}

function InfoWords({ info }: { info: HtttxInfo }) {
    const clock = info.clockMs === null ? null : words.clock(clockText(info.clockMs));
    return (
        <span className="an-notes-info">
            {info.evaluation === null ? null : <SpokenText words={importedWords(info.evaluation)} className="an-notes-value" />}
            {info.evaluation !== null && clock !== null ? `; ` : null}
            {clock}
        </span>
    );
}

/**
 * The eval bar for an imported evaluation, where no analyzer's line holds it: an open one at x's share, held to -100 to 100,
 * a closed one at its winner's edge; marked as the text's own. Nothing for `#0`, which names no side.
 */
export function ImportedEvalBar({ evaluation }: { evaluation: HtttxEvaluation }) {
    const ref = useRef<HTMLDivElement>(null);
    const share = evaluation.kind === `open` ? (Math.max(-100, Math.min(100, evaluation.value)) + 100) / 200 : evaluation.turns === 0 ? null : evaluation.turns > 0 ? 1 : 0;
    useChipRoom(ref, share !== null);
    if (share === null) return null;
    // React passes custom properties through as written; CSSProperties only lacks their names.
    const style = { '--x-share': `${(share * 100).toFixed(1)}%` } as CSSProperties;
    return (
        <div ref={ref} className="an-evalbar an-evalbar-imported" style={style} aria-hidden="true">
            <span className="an-evalbar-x" />
            <span className="an-evalbar-chip">{words.chip(importedWords(evaluation).shown)}</span>
        </div>
    );
}
