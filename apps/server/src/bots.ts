import {
    acceptsSchema,
    botCapPerUser,
    levelsSchema,
    nameKeyOf,
    type Accepts,
    type AccountDeclaration,
    type Analyzer,
    type AnalyzerValues,
    type BotAccount,
    type JudgmentCuts,
    type Levels,
    type ValueMeaning,
} from '@hexo-arena/contract';
import { and, count, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { nowSeconds, type Query } from './db';
import { bots, nameReservations, ratings, users } from './db/schema';
import { seedRating, type PlayerRating } from './rating';
import { randomToken, sha256Hex } from './tokens';

export type CreateBotResult =
    | { kind: `created`; name: string; token: string }
    | { kind: `name_taken` }
    | { kind: `bot_limit` };

export interface BotRow {
    id: string;
    name: string;
    ownerId: string;
    ownerName: string;
    // Hidden from the directory and out of every new challenge or game, by
    // an explicit delist or by the owner's ban.
    delisted: boolean;
    about?: string;
    version?: string;
    repoUrl?: string;
    accepts?: Accepts;
    levels: Levels | null;
    analyzer: StoredAnalyzer | null;
}

/** An analyzer as the bot declared it; whether it can read now is the analysis session's to say. */
export type StoredAnalyzer = Omit<Analyzer, `ready`>;

interface DeclarationColumns {
    about: string | null;
    version: string | null;
    repoUrl: string | null;
    accepts: string | null;
    levels: string | null;
    analyzerMaxSeconds: number | null;
    analyzerLines: number | null;
    analyzerWhilePlaying: number | null;
    analyzerScale: number | null;
    analyzerCutInaccuracy: number | null;
    analyzerCutMistake: number | null;
    analyzerCutBlunder: number | null;
    analyzerMeaning: string | null;
}

/** The columns `storedAnalyzer` reads, to select beside others. */
export const analyzerColumns = {
    analyzerMaxSeconds: bots.analyzerMaxSeconds,
    analyzerLines: bots.analyzerLines,
    analyzerWhilePlaying: bots.analyzerWhilePlaying,
    analyzerScale: bots.analyzerScale,
    analyzerCutInaccuracy: bots.analyzerCutInaccuracy,
    analyzerCutMistake: bots.analyzerCutMistake,
    analyzerCutBlunder: bots.analyzerCutBlunder,
    analyzerMeaning: bots.analyzerMeaning,
};

const declarationColumns = {
    about: bots.about,
    version: bots.version,
    repoUrl: bots.repoUrl,
    accepts: bots.accepts,
    levels: bots.levels,
    ...analyzerColumns,
};

type DeclarationView = Pick<BotRow, `about` | `version` | `repoUrl` | `accepts` | `levels` | `analyzer`>;

/** Values as a table stores them: a scale and a meaning, null where none was declared, and three cuts, set together or not at all. */
export interface ValueColumns {
    readonly scale: number | null;
    readonly inaccuracy: number | null;
    readonly mistake: number | null;
    readonly blunder: number | null;
    readonly meaning: string | null;
}

/** How a heuristic reads by its stored columns: scale 1 and raw where none was declared, and no cuts unless all three are set. */
export function storedValues(columns: ValueColumns): AnalyzerValues {
    const { inaccuracy, mistake, blunder } = columns;
    return {
        scale: columns.scale ?? 1,
        cuts: inaccuracy === null || mistake === null || blunder === null ? null : { inaccuracy, mistake, blunder },
        meaning: columns.meaning === `expected` ? `expected` : `raw`,
    };
}

/** The columns that store values, all null for none. */
export function valueColumns(
    values: { readonly scale: number; readonly cuts?: JudgmentCuts | null | undefined; readonly meaning: ValueMeaning } | null | undefined,
): ValueColumns {
    const cuts = values?.cuts ?? null;
    return { scale: values?.scale ?? null, inaccuracy: cuts?.inaccuracy ?? null, mistake: cuts?.mistake ?? null, blunder: cuts?.blunder ?? null, meaning: values?.meaning ?? null };
}

type AnalyzerColumns = Pick<
    DeclarationColumns,
    `analyzerMaxSeconds` | `analyzerLines` | `analyzerWhilePlaying` | `analyzerScale` | `analyzerCutInaccuracy` | `analyzerCutMistake` | `analyzerCutBlunder` | `analyzerMeaning`
>;

/** The analyzer the columns hold, which the schema keeps all set or all null, with how its heuristic reads. */
export function storedAnalyzer(row: AnalyzerColumns): StoredAnalyzer | null {
    if (row.analyzerMaxSeconds === null || row.analyzerLines === null || row.analyzerWhilePlaying === null) return null;
    const values = storedValues({
        scale: row.analyzerScale,
        inaccuracy: row.analyzerCutInaccuracy,
        mistake: row.analyzerCutMistake,
        blunder: row.analyzerCutBlunder,
        meaning: row.analyzerMeaning,
    });
    return { maxSeconds: row.analyzerMaxSeconds, lines: row.analyzerLines, whilePlaying: row.analyzerWhilePlaying === 1, values };
}

// Absent, not null: the wire shape omits a text field or accepts the bot
// never declared, so the row nulls are dropped here and never cross a
// boundary again; levels and the analyzer alone read as null until declared.
function declarationView(row: DeclarationColumns): DeclarationView {
    const view: DeclarationView = {
        levels: row.levels === null ? null : levelsSchema.parse(JSON.parse(row.levels)),
        analyzer: storedAnalyzer(row),
    };
    if (row.about !== null) view.about = row.about;
    if (row.version !== null) view.version = row.version;
    if (row.repoUrl !== null) view.repoUrl = row.repoUrl;
    if (row.accepts !== null) view.accepts = acceptsSchema.parse(JSON.parse(row.accepts));
    return view;
}

// An empty string clears any text field, not only about and repoUrl: one
// rule, no special cases.
function clearableText(value: string): string | null {
    return value === `` ? null : value;
}

function mintBotToken(): string {
    return `hxo_${randomToken(32)}`;
}

export function createBot(query: Query, ownerId: string, name: string): CreateBotResult {
    const token = mintBotToken();
    return query.transaction((tx) => {
        // The cap is policy, not integrity: counted inside the transaction,
        // which the single-process, single-connection model serializes.
        const held = tx
            .select({ n: count() })
            .from(bots)
            .where(and(eq(bots.ownerId, ownerId), isNull(bots.deletedAt)))
            .all()[0]?.n ?? 0;
        if (held >= botCapPerUser) {
            return { kind: `bot_limit` };
        }
        const claimed = tx
            .insert(nameReservations)
            .values({ nameKey: nameKeyOf(name) })
            .onConflictDoNothing()
            .run().changes;
        if (claimed !== 1) return { kind: `name_taken` };
        tx.insert(bots)
            .values({
                id: randomUUID(),
                ownerId,
                name,
                nameKey: nameKeyOf(name),
                tokenHash: sha256Hex(token),
                scope: `bot:play`,
                createdAt: nowSeconds(),
            })
            .run();
        return { kind: `created`, name, token };
    });
}

export function listBots(query: Query): (BotRow & { rating: PlayerRating })[] {
    return query
        .select({
            id: bots.id,
            name: bots.name,
            ownerId: bots.ownerId,
            ownerName: users.name,
            ...declarationColumns,
            rating: ratings.rating,
            deviation: ratings.deviation,
            volatility: ratings.volatility,
        })
        .from(bots)
        .innerJoin(users, eq(bots.ownerId, users.id))
        .leftJoin(ratings, eq(ratings.botId, bots.id))
        .where(and(isNull(bots.delistedAt), isNull(bots.deletedAt), isNull(users.bannedAt)))
        .orderBy(bots.nameKey)
        .all()
        .map((row) => ({
            id: row.id,
            name: row.name,
            ownerId: row.ownerId,
            ownerName: row.ownerName,
            delisted: false,
            ...declarationView(row),
            // No row means no rated game yet: the bot still sits at its seed.
            rating:
                row.rating === null || row.deviation === null || row.volatility === null
                    ? seedRating(`bot`)
                    : { rating: row.rating, deviation: row.deviation, volatility: row.volatility },
        }));
}

export function findBot(query: Query, nameKey: string): BotRow | undefined {
    const row = query
        .select({
            id: bots.id,
            name: bots.name,
            ownerId: bots.ownerId,
            ownerName: users.name,
            delistedAt: bots.delistedAt,
            ownerBannedAt: users.bannedAt,
            ...declarationColumns,
        })
        .from(bots)
        .innerJoin(users, eq(bots.ownerId, users.id))
        .where(and(eq(bots.nameKey, nameKey), isNull(bots.deletedAt)))
        .get();
    return row === undefined
        ? undefined
        : {
              id: row.id,
              name: row.name,
              ownerId: row.ownerId,
              ownerName: row.ownerName,
              delisted: row.delistedAt !== null || row.ownerBannedAt !== null,
              ...declarationView(row),
          };
}

export type BotDeclaration = Omit<BotAccount, `rating` | `provisional` | `analyzer`> & { analyzer: StoredAnalyzer | null };

export function readBotDeclaration(query: Query, botId: string): BotDeclaration | undefined {
    const row = query
        .select({ name: bots.name, ...declarationColumns })
        .from(bots)
        .where(eq(bots.id, botId))
        .get();
    return row === undefined ? undefined : { name: row.name, ...declarationView(row) };
}

export function updateBotDeclaration(query: Query, botId: string, changes: AccountDeclaration): BotDeclaration {
    return query.transaction((tx) => {
        const set: Partial<DeclarationColumns> = {};
        if (changes.about !== undefined) set.about = clearableText(changes.about);
        if (changes.version !== undefined) set.version = clearableText(changes.version);
        if (changes.repoUrl !== undefined) set.repoUrl = clearableText(changes.repoUrl);
        if (changes.accepts !== undefined) set.accepts = JSON.stringify(changes.accepts);
        if (changes.levels !== undefined) set.levels = changes.levels === null ? null : JSON.stringify(changes.levels);
        if (changes.analyzer !== undefined) {
            set.analyzerMaxSeconds = changes.analyzer?.maxSeconds ?? null;
            set.analyzerLines = changes.analyzer?.lines ?? null;
            set.analyzerWhilePlaying = changes.analyzer === null ? null : Number(changes.analyzer.whilePlaying);
            const values = valueColumns(changes.analyzer?.values);
            set.analyzerScale = values.scale;
            set.analyzerCutInaccuracy = values.inaccuracy;
            set.analyzerCutMistake = values.mistake;
            set.analyzerCutBlunder = values.blunder;
            set.analyzerMeaning = values.meaning;
        }
        const [row] =
            Object.keys(set).length === 0
                ? tx
                      .select({ name: bots.name, ...declarationColumns })
                      .from(bots)
                      .where(eq(bots.id, botId))
                      .all()
                : tx
                      .update(bots)
                      .set(set)
                      .where(eq(bots.id, botId))
                      .returning({ name: bots.name, ...declarationColumns })
                      .all();
        // The bot id came from a token the lookup just resolved, so a
        // missing row means the delete raced the patch.
        if (!row) throw new Error(`bot row vanished while declaring: ${botId}`);
        return { name: row.name, ...declarationView(row) };
    });
}

export function rotateBotToken(
    query: Query,
    ownerId: string,
    nameKey: string,
): { name: string; token: string } | null {
    const token = mintBotToken();
    return query.transaction((tx) => {
        const [updated] = tx
            .update(bots)
            .set({ tokenHash: sha256Hex(token) })
            .where(and(eq(bots.nameKey, nameKey), eq(bots.ownerId, ownerId), isNull(bots.deletedAt)))
            .returning({ name: bots.name })
            .all();
        if (!updated) return null;
        return { name: updated.name, token };
    });
}
