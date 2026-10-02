// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { analysisSettingsStore, defaultAnalysisSettings, effectiveSeconds, parseAnalysisSettings } from '../src/analysis/analysis-settings';
import { analysisSettingsStorageKey } from '../src/analysis/storage-key';

beforeEach(() => {
    window.localStorage.clear();
    analysisSettingsStore.reset();
});

describe('the analysis settings', () => {
    it('start on any online analyzer, three lines, two seconds, and lines on the board', () => {
        expect(parseAnalysisSettings(null)).toEqual({ analyzer: null, lines: 3, seconds: 2, boardLines: true });
        expect(analysisSettingsStore.read()).toEqual(defaultAnalysisSettings);
    });

    it('keep each stored field that reads, and fall back field by field', () => {
        expect(parseAnalysisSettings(JSON.stringify({ analyzer: `kestrel`, lines: 1, seconds: 5, boardLines: false }))).toEqual({
            analyzer: `kestrel`,
            lines: 1,
            seconds: 5,
            boardLines: false,
        });
        expect(parseAnalysisSettings(JSON.stringify({ analyzer: `not a name`, lines: 4, seconds: 3, boardLines: `no` }))).toEqual(defaultAnalysisSettings);
        expect(parseAnalysisSettings(`{broken`)).toEqual(defaultAnalysisSettings);
        expect(parseAnalysisSettings(`[]`)).toEqual(defaultAnalysisSettings);
    });

    it('persist each change in this browser', () => {
        analysisSettingsStore.update({ analyzer: `driftwood`, lines: 2 });
        expect(JSON.parse(window.localStorage.getItem(analysisSettingsStorageKey) ?? `null`)).toEqual({ analyzer: `driftwood`, lines: 2, seconds: 2, boardLines: true });
        analysisSettingsStore.reset();
        expect(analysisSettingsStore.read()).toMatchObject({ analyzer: `driftwood`, lines: 2 });
    });

    it('hold the seconds to the analyzer\'s most, never below the shortest choice', () => {
        expect(effectiveSeconds(5, null)).toBe(5);
        expect(effectiveSeconds(5, 10)).toBe(5);
        expect(effectiveSeconds(5, 2)).toBe(2);
        expect(effectiveSeconds(5, 3)).toBe(2);
        expect(effectiveSeconds(2, 1)).toBe(1);
        expect(effectiveSeconds(1, 1)).toBe(1);
    });
});
