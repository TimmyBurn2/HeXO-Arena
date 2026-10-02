import type { Levels } from '@hexo-arena/contract';

/**
 * The dev bots' strengths: the same random play at three think times, so
 * a level shows in how fast a bot answers and in nothing else.
 */
export const devLevels: Levels = {
    default: `steady`,
    list: [
        { id: `quick`, label: `quick`, about: `Answers at once.`, budget: { timeMs: 200 } },
        { id: `steady`, label: `steady`, budget: { timeMs: 1_500 } },
        { id: `slow`, label: `slow`, about: `Waits before every turn; the play is no better.`, budget: { timeMs: 4_000 } },
    ],
};

/**
 * The pause before each answer at a level: the think time a level other
 * than the default declares, else the host's own pace, which is also how
 * a level the bot no longer declares plays.
 */
export function paceAt(levels: Levels, level: string | null, own: () => number): () => number {
    const picked = level === null || level === levels.default ? undefined : levels.list.find((entry) => entry.id === level);
    const ms = picked?.budget?.timeMs;
    return ms === undefined ? own : () => ms;
}
