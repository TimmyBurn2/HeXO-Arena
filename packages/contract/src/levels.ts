import { z } from 'zod';
import { durationText, plural } from './meta';
import { cleanText } from './names';

/** The fewest levels a declaration names. */
export const levelCountMin = 2;

/** The most levels a declaration names. */
export const levelCountMax = 8;

export const levelIdPattern = /^[a-z0-9-]{1,16}$/;

export const levelLabelMaxLength = 24;
export const levelAboutMaxLength = 120;
export const levelNoteMaxLength = 80;

// Printable ASCII, starting and ending on a visible character, so a label
// never hides or reorders the name it follows.
export const levelLabelPattern = new RegExp(`^[!-~](?:[ -~]{0,${String(levelLabelMaxLength - 2)}}[!-~])?$`);

/** The largest value each budget key takes. */
export const levelBudgetMax = { timeMs: 600_000, nodes: 1e12, depthTurns: 64, playouts: 1e9 } as const;

export const levelIdSchema = z
    .string()
    .regex(levelIdPattern)
    .meta({ id: `LevelId`, description: `A level's id: lowercase letters, digits, and hyphens, unique in the bot's list.` });
export type LevelId = z.infer<typeof levelIdSchema>;

const budgetValue = (max: number) => z.number().int().min(1).max(max);

// A closed set the site shows with units; an engine kind with another knob
// says so in the note until a key is added for it.
export const levelBudgetSchema = z
    .strictObject({
        timeMs: budgetValue(levelBudgetMax.timeMs).optional().meta({ description: `Think time per turn, in milliseconds.` }),
        nodes: budgetValue(levelBudgetMax.nodes).optional().meta({ description: `Search nodes per turn.` }),
        depthTurns: budgetValue(levelBudgetMax.depthTurns).optional().meta({ description: `Search depth in HeXO turns, not stones.` }),
        playouts: budgetValue(levelBudgetMax.playouts).optional().meta({ description: `Simulations or visits per turn.` }),
    })
    .refine((budget) => Object.values(budget).some((value) => value !== undefined), { message: `a budget names at least one key` })
    .meta({
        id: `LevelBudget`,
        minProperties: 1,
        description: `What a level spends per turn, as the bot states it, for display only; at least one key.`,
    });
export type LevelBudget = z.infer<typeof levelBudgetSchema>;

const labelSchema = z.string().regex(levelLabelPattern);

// Cleaned as a declaration's about is, the cap counting the cleaned text;
// text that cleans to nothing declares nothing.
const cleanedUpTo = (max: number) =>
    z
        .string()
        .transform(cleanText)
        .pipe(z.string().max(max))
        .transform((text) => (text === `` ? undefined : text))
        .optional();

export const levelSchema = z
    .strictObject({
        id: levelIdSchema,
        label: labelSchema.meta({
            description: `The name a player picks the level by, ${String(levelLabelMaxLength)} printable ASCII characters at most, starting and ending on a visible one.`,
        }),
        about: cleanedUpTo(levelAboutMaxLength).meta({ description: `At most ${String(levelAboutMaxLength)} characters once cleaned.` }),
        budget: levelBudgetSchema.optional(),
        note: cleanedUpTo(levelNoteMaxLength).meta({ description: `Anything about the level the budget keys cannot say, at most ${String(levelNoteMaxLength)} characters once cleaned.` }),
    })
    .meta({ id: `Level` });
export type Level = z.infer<typeof levelSchema>;

export const levelsSchema = z
    .strictObject({
        default: levelIdSchema.meta({ description: `The level the bot plays unless a player picks another: the one its rating belongs to.` }),
        list: z.array(levelSchema).min(levelCountMin).max(levelCountMax).meta({ description: `Weakest first.` }),
    })
    .refine((levels) => new Set(levels.list.map((level) => level.id)).size === levels.list.length, { message: `level ids are unique` })
    .refine((levels) => levels.list.some((level) => level.id === levels.default), { message: `the default is in the list` })
    .meta({
        id: `Levels`,
        description: [
            `The strengths a player on the website may pick, ${String(levelCountMin)} to ${String(levelCountMax)}, weakest first, each id unique; default names one of them.`,
            `A game at any level but the default is unrated for both sides.`,
            `Null until the bot declares levels, and once it clears them.`,
        ].join(` `),
    });
export type Levels = z.infer<typeof levelsSchema>;

/**
 * The level a bot seat plays at, as the bot declared it when the game was
 * created; a later declaration never changes it.
 */
export const seatLevelSchema = z
    .strictObject({ id: levelIdSchema, label: labelSchema, budget: levelBudgetSchema.optional(), note: z.string().min(1).max(levelNoteMaxLength).optional() })
    .meta({ id: `SeatLevel`, description: `The level a bot plays this game at, as it was declared when the game began.` });
export type SeatLevel = z.infer<typeof seatLevelSchema>;

/** The stored snapshot of a declared level, as a game seat keeps it. */
export function seatLevelOf(level: Level): SeatLevel {
    return {
        id: level.id,
        label: level.label,
        ...(level.budget === undefined ? {} : { budget: level.budget }),
        ...(level.note === undefined ? {} : { note: level.note }),
    };
}

const compactUnits = [
    [1e3, `k`],
    [1e6, `M`],
    [1e9, `B`],
    [1e12, `T`],
] as const;

// Figures below ten thousand, then three significant figures in the
// smallest unit that keeps them under a thousand: 800, 6400, 250k, 1M.
function compactCount(count: number): string {
    if (count < 10_000) return String(count);
    for (const [size, unit] of compactUnits) {
        const scaled = Number((count / size).toPrecision(3));
        if (scaled < 1000 || unit === `T`) return `${String(scaled)}${unit}`;
    }
    return String(count);
}

function thinkTimeText(ms: number): string {
    const time = ms >= 60_000 || ms % 1000 === 0 ? durationText(ms) : `${String(ms / 1000)} s`;
    return `${time} a turn`;
}

/** A budget as short facts, search limits before time: "depth 8 turns", "1M nodes", "800 playouts", "0.5 s a turn". */
export function budgetFacts(budget: LevelBudget | undefined): string[] {
    if (budget === undefined) return [];
    const facts: string[] = [];
    if (budget.depthTurns !== undefined) facts.push(`depth ${String(budget.depthTurns)} ${plural(budget.depthTurns, `turn`, `turns`)}`);
    if (budget.nodes !== undefined) facts.push(`${compactCount(budget.nodes)} ${plural(budget.nodes, `node`, `nodes`)}`);
    if (budget.playouts !== undefined) facts.push(`${compactCount(budget.playouts)} ${plural(budget.playouts, `playout`, `playouts`)}`);
    if (budget.timeMs !== undefined) facts.push(thinkTimeText(budget.timeMs));
    return facts;
}

/** A level's budget facts and note on one line, or the empty string when it declares neither. */
export function levelFacts(level: Pick<Level, `budget` | `note`>): string {
    return [budgetFacts(level.budget).join(`, `), level.note ?? ``].filter((part) => part !== ``).join(`; `);
}

/** The part of a seat's name that names its level: `@ label`. */
export function atLevel(level: Pick<SeatLevel, `label`>): string {
    return `@ ${level.label}`;
}

/** A seat's name as a game shows it: the plain name at the bot's default level, `name @ label` at any other. */
export function nameAtLevel(name: string, level: Pick<SeatLevel, `label`> | null | undefined): string {
    return level === null || level === undefined ? name : `${name} ${atLevel(level)}`;
}
