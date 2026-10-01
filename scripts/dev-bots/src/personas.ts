import type { AccountDeclaration, OpeningPlies, TimeControl, devPersonas } from '@hexo-arena/contract';
import type { Strategy } from './player';

export type PersonaName = (typeof devPersonas)[number][`name`];

/** A bot one of the personas owns. */
export interface PersonaBot {
    readonly name: string;
    readonly owner: PersonaName;
    readonly strategy: Strategy;
    // Held online by the seed, and by pnpm dev:bots once the seed has run.
    readonly online: boolean;
    readonly declaration: AccountDeclaration | null;
}

const randomAbout = `Plays random turns next to the stones; a local development persona.`;

export const personaBots: readonly PersonaBot[] = [
    {
        name: `hextide`,
        owner: `ana`,
        strategy: `greedy`,
        online: true,
        declaration: {
            about: `Extends its longest line and blocks a line one stone short of six; a local development persona.`,
            version: `1.4.0`,
            repoUrl: `https://example.com/hextide`,
            accepts: { turnMs: [5_000, 120_000], match: true, unlimited: false },
        },
    },
    {
        name: `pebble`,
        owner: `ana`,
        strategy: `random`,
        online: true,
        declaration: { about: randomAbout, version: `0.3.1`, accepts: { turnMs: [5_000, 300_000], match: true, unlimited: true } },
    },
    // Never connects and declares nothing, so it shows a bot's empty states.
    { name: `lantern`, owner: `ana`, strategy: `random`, online: false, declaration: null },
    {
        name: `quietlake`,
        owner: `dmitri`,
        strategy: `random`,
        online: true,
        declaration: { about: randomAbout, accepts: { turnMs: [5_000, 300_000], match: false, unlimited: true } },
    },
];

/** How a seeded human leaves a game: played to its result, resigned after some turns, or left to time out. */
export type HumanEnding = { readonly kind: `play` } | { readonly kind: `resign`; readonly afterTurns: number } | { readonly kind: `idle` };

export interface HumanGame {
    readonly bot: string;
    readonly timeControl: TimeControl;
    readonly openingPlies: OpeningPlies;
    readonly ending: HumanEnding;
}

export interface BotGame {
    readonly timeControl: TimeControl;
    readonly openingPlies: OpeningPlies;
}

/** Challenges one bot sends another, counted by the challenger's games against bots. */
export interface BotSeries {
    readonly from: string;
    readonly to: string;
    readonly games: readonly BotGame[];
}

/**
 * The history the seed tops up to: each human's games in order, counted by
 * the games the human has finished, each series likewise, and the personas
 * banned once their games are played.
 */
export interface SeedPlan {
    readonly humans: Partial<Record<PersonaName, readonly HumanGame[]>>;
    readonly series: readonly BotSeries[];
    readonly banned: readonly PersonaName[];
}

const turn = (seconds: number): TimeControl => ({ mode: `turn`, turnTimeMs: seconds * 1_000 });
const match: TimeControl = { mode: `match`, mainTimeMs: 180_000, incrementMs: 2_000 };
const unlimited: TimeControl = { mode: `unlimited` };
const play: HumanEnding = { kind: `play` };

function series(from: string, to: string, clocks: readonly TimeControl[], count: number): BotSeries {
    const openings: readonly OpeningPlies[] = [5, 3, 1, 7, 9];
    return {
        from,
        to,
        games: Array.from({ length: count }, (_, index) => ({
            timeControl: clocks[index % clocks.length] ?? unlimited,
            openingPlies: openings[index % openings.length] ?? 5,
        })),
    };
}

// Each bot is offered only the clocks it declares.
export const seedPlan: SeedPlan = {
    humans: {
        ana: [
            { bot: `quietlake`, timeControl: turn(20), openingPlies: 5, ending: play },
            { bot: `quietlake`, timeControl: unlimited, openingPlies: 3, ending: play },
            { bot: `quietlake`, timeControl: turn(30), openingPlies: 7, ending: play },
            { bot: `quietlake`, timeControl: turn(20), openingPlies: 1, ending: play },
        ],
        bruno: [
            { bot: `hextide`, timeControl: turn(20), openingPlies: 5, ending: play },
            { bot: `pebble`, timeControl: turn(30), openingPlies: 3, ending: play },
            { bot: `quietlake`, timeControl: unlimited, openingPlies: 5, ending: play },
            { bot: `pebble`, timeControl: match, openingPlies: 1, ending: play },
            { bot: `hextide`, timeControl: match, openingPlies: 7, ending: play },
            { bot: `quietlake`, timeControl: turn(20), openingPlies: 5, ending: { kind: `resign`, afterTurns: 6 } },
            { bot: `pebble`, timeControl: unlimited, openingPlies: 9, ending: play },
            { bot: `hextide`, timeControl: turn(60), openingPlies: 3, ending: play },
            { bot: `quietlake`, timeControl: turn(30), openingPlies: 1, ending: play },
            { bot: `pebble`, timeControl: turn(20), openingPlies: 5, ending: play },
        ],
        dmitri: [
            { bot: `pebble`, timeControl: turn(20), openingPlies: 5, ending: play },
            { bot: `pebble`, timeControl: turn(5), openingPlies: 3, ending: { kind: `idle` } },
        ],
        eve: [
            { bot: `hextide`, timeControl: turn(20), openingPlies: 5, ending: play },
            { bot: `pebble`, timeControl: turn(30), openingPlies: 3, ending: { kind: `resign`, afterTurns: 3 } },
        ],
    },
    series: [series(`hextide`, `quietlake`, [turn(10), unlimited, turn(30)], 12), series(`pebble`, `quietlake`, [turn(10), unlimited], 8)],
    banned: [`eve`],
};
