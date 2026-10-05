import { analysisLinesMax, analysisSecondsChoices, analysisSecondsDefault, nameSyntaxSchema } from '@hexo-arena/contract';
import { z } from 'zod';
import { persistedStore, useStore } from '../store';
import { analysisSettingsStorageKey } from './storage-key';

/** The seconds a person may ask for a position. */
export type AnalysisSeconds = (typeof analysisSecondsChoices)[number];

/** How the analysis board asks analyzers: whom, for how many lines and how long, and whether their lines show on the board. */
export interface AnalysisSettings {
    /** An analyzer by name, or null for any one online. */
    readonly analyzer: string | null;
    readonly lines: 1 | 2 | 3;
    readonly seconds: AnalysisSeconds;
    readonly boardLines: boolean;
}

function isSeconds(value: number): value is AnalysisSeconds {
    return analysisSecondsChoices.some((choice) => choice === value);
}

const defaultSeconds: AnalysisSeconds = isSeconds(analysisSecondsDefault) ? analysisSecondsDefault : analysisSecondsChoices[0];

export const defaultAnalysisSettings: AnalysisSettings = { analyzer: null, lines: analysisLinesMax, seconds: defaultSeconds, boardLines: true };

const storedSchema = z.object({
    analyzer: nameSyntaxSchema.nullable().catch(defaultAnalysisSettings.analyzer),
    lines: z.union([z.literal(1), z.literal(2), z.literal(3)]).catch(defaultAnalysisSettings.lines),
    seconds: z.custom<AnalysisSeconds>((value) => typeof value === `number` && isSeconds(value)).catch(defaultAnalysisSettings.seconds),
    boardLines: z.boolean().catch(defaultAnalysisSettings.boardLines),
});

/**
 * The stored settings are this page's own earlier writes behind a versioned key,
 * so each field that does not read falls back to its default on its own.
 */
export function parseAnalysisSettings(raw: string | null): AnalysisSettings {
    if (raw === null) return defaultAnalysisSettings;
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return defaultAnalysisSettings;
    }
    const parsed = storedSchema.safeParse(value);
    return parsed.success ? parsed.data : defaultAnalysisSettings;
}

/**
 * The seconds a position is read for: the choice, held to the analyzer's most when it names one,
 * and never below the shortest choice.
 */
export function effectiveSeconds(chosen: AnalysisSeconds, cap: number | null): AnalysisSeconds {
    if (cap === null) return chosen;
    const allowed = analysisSecondsChoices.filter((choice) => choice <= Math.min(chosen, cap));
    return allowed.at(-1) ?? analysisSecondsChoices[0];
}

const stored = persistedStore(analysisSettingsStorageKey, parseAnalysisSettings, (settings) => JSON.stringify(settings));

/**
 * The analysis settings as a store: the analysis board's settings panel writes them, and they stay in this browser.
 * `reset` is a test seam that reads the browser's storage again.
 */
export const analysisSettingsStore = {
    read: stored.read,
    subscribe: stored.subscribe,
    update: (changes: Partial<AnalysisSettings>): void => {
        stored.set({ ...stored.read(), ...changes });
    },
    reset: stored.reset,
};

export function useAnalysisSettings(): readonly [AnalysisSettings, typeof analysisSettingsStore.update] {
    return [useStore(stored), analysisSettingsStore.update];
}
