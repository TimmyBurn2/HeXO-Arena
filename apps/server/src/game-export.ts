import {
    boardCellSchema,
    htttxLineOf,
    htttxTags,
    siteName,
    turnClocks,
    turnsOfStones,
    writeHtttx,
    type AnalysisTurn,
    type AnalyzerValues,
    type FinishedGameEntry,
    type HtttxCells,
    type HtttxDocument,
    type HtttxEvaluation,
    type HtttxHeader,
    type Side,
    type TimeControl,
    type TournamentDetail,
} from '@hexo-arena/contract';
import { replay, type Coord } from '@hexo-arena/rules';
import { asc, inArray } from 'drizzle-orm';
import { ownLinesOf, ownValuesOf } from './analysis-store';
import type { Query } from './db';
import { games, moves } from './db/schema';
import { finishedEntriesOf } from './finished-games';
import { zipStore, type ZipEntry } from './zip';

/** A downloadable archive: its file name, plain ASCII, and its bytes. */
export interface GameExport {
    readonly fileName: string;
    readonly body: Buffer;
}

/** A game an export holds: its number in the export, its round, pair, opening, and number within the pair, and the name its file gives it. */
interface Slot {
    readonly gameId: string;
    readonly number: number;
    readonly round: number;
    readonly pair: string;
    readonly opening: number;
    readonly game: number;
    readonly title: string;
    readonly versions?: { readonly x: string; readonly o: string };
}

type CsvCell = string | number | boolean;

// A cell a spreadsheet would read as a formula starts with one of these.
const formulaStart = /^[=+\-@\t\r]/u;

/**
 * One CSV cell: text that opens like a formula is kept as text, and a cell
 * holding a comma, a quote, or a line break is quoted, its quotes doubled.
 */
export function csvCell(value: CsvCell): string {
    if (typeof value !== `string`) return String(value);
    const text = formulaStart.test(value) ? `'${value}` : value;
    return /[",\r\n]/u.test(text) ? `"${text.replaceAll(`"`, `""`)}"` : text;
}

/** CSV text: a line per row, each ended as RFC 4180 ends it. */
export function csvText(rows: readonly (readonly CsvCell[])[]): string {
    return rows.map((row) => `${row.map(csvCell).join(`,`)}\r\n`).join(``);
}

/** A name as a file name takes it: letters, digits, dots, dashes, and underscores. */
export function fileSafe(text: string): string {
    const safe = text.replace(/[^A-Za-z0-9._-]+/gu, `-`).replace(/-{2,}/gu, `-`).replace(/^[-.]+|[-.]+$/gu, ``);
    return safe === `` ? `game` : safe;
}

const isoSecond = (seconds: number) => new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/u, `Z`);

interface Played {
    readonly startedAt: number;
    readonly openingPlies: number;
    readonly stones: readonly Coord[];
    readonly turnTimes: readonly { readonly side: Side; readonly at: number }[];
}

// Every stone of each game in placement order, the opening's first; a
// winning stone ends the replay, as the game ended on it.
function playedGames(query: Query, ids: readonly string[]): Map<string, Played> {
    if (ids.length === 0) return new Map();
    const placed = new Map<string, { cells: Coord[]; turnTimes: { side: Side; at: number }[] }>();
    const rows = query
        .select({ gameId: moves.gameId, side: moves.side, at: moves.createdAt, firstX: moves.firstX, firstY: moves.firstY, secondX: moves.secondX, secondY: moves.secondY })
        .from(moves)
        .where(inArray(moves.gameId, [...ids]))
        .orderBy(asc(moves.gameId), asc(moves.seq))
        .all();
    for (const row of rows) {
        const game = placed.get(row.gameId) ?? { cells: [], turnTimes: [] };
        game.cells.push({ x: row.firstX, y: row.firstY }, { x: row.secondX, y: row.secondY });
        game.turnTimes.push({ side: row.side, at: row.at });
        placed.set(row.gameId, game);
    }
    const played = new Map<string, Played>();
    for (const row of query.select({ id: games.id, createdAt: games.createdAt, openingCells: games.openingCells }).from(games).where(inArray(games.id, [...ids])).all()) {
        const opening = boardCellSchema.array().parse(JSON.parse(row.openingCells));
        const moved = placed.get(row.id);
        const replayed = replay([...opening, ...(moved?.cells ?? [])]);
        if (!replayed.ok) throw new Error(`stored cell is illegal: ${row.id}`);
        played.set(row.id, { startedAt: row.createdAt, openingPlies: opening.length, stones: replayed.position.stones, turnTimes: moved?.turnTimes ?? [] });
    }
    return played;
}

// The evaluation a seat's own view gives the board after a turn it played, where its values mean x's expected result:
// a forced win as its win_in, else the heuristic as a percentage of its scale; a raw seat's numbers say nothing outside it.
function ownEvaluation(view: AnalysisTurn | undefined, values: AnalyzerValues): HtttxEvaluation | null {
    const played = view?.lines[0];
    if (played === undefined || values.meaning !== `expected`) return null;
    if (played.winIn !== undefined && played.winIn !== 0) return { kind: `closed`, turns: played.winIn };
    if (played.heuristic === undefined) return null;
    // The trailing + 0 turns -0 into 0.
    return { kind: `open`, value: Math.round(100 * Math.max(-1, Math.min(1, played.heuristic / values.scale))) + 0 };
}

// A game as v2 text, each chosen turn with its mover's clock and own evaluation, which the opening's drawn turns lack;
// a game of no turns, which v2 cannot write, is v1.
function gameText(query: Query, gameId: string, game: Played, timeControl: TimeControl, header: HtttxHeader): string {
    const openingTurns = (game.openingPlies - 1) / 2;
    const clocks = turnClocks(timeControl, game.startedAt, game.turnTimes);
    const views = ownLinesOf(query, gameId, game.openingPlies);
    const values = ownValuesOf(query, gameId);
    const line = htttxLineOf(
        turnsOfStones(game.stones).flatMap(([first, second], index) => {
            if (first === undefined) return [];
            const cells: HtttxCells = second === undefined ? [first] : [first, second];
            const chosen = index - openingTurns;
            const side = chosen < 0 ? undefined : game.turnTimes[chosen]?.side;
            if (side === undefined) return [{ cells, info: null }];
            const clockMs = clocks?.[chosen] ?? null;
            const evaluation = ownEvaluation(views[side].find((view) => view.turn === index + 1), values[side]);
            return [{ cells, info: clockMs === null && evaluation === null ? null : { clockMs, evaluation } }];
        }),
    );
    const tags = htttxTags(header);
    const document: HtttxDocument = line === null ? { version: 1, tags, turns: [] } : { version: 2, tags, line };
    return writeHtttx(document);
}

const csvHead = [`x`, `o`, `winner`, `reason`, `turns`, `rated`, `test`, `started`, `finished`] as const;

// Each game's file and its row in games.csv, in the slots' order; a game
// missing from either read was never finished, which the slots rule out.
function gameEntries(query: Query, slots: readonly Slot[], finished: readonly FinishedGameEntry[]): { files: ZipEntry[]; csv: string } {
    const ids = slots.map((slot) => slot.gameId);
    const entries = new Map(finished.map((entry) => [entry.gameId, entry]));
    const played = playedGames(query, ids);
    const width = Math.max(2, String(slots.at(-1)?.number ?? 0).length);
    const versioned = slots.some((slot) => slot.versions !== undefined);
    const rows: CsvCell[][] = [[`number`, `round`, `pair`, `opening`, `game`, ...csvHead, ...(versioned ? [`x_version`, `o_version`] : [])]];
    const files = slots.map((slot): ZipEntry => {
        const entry = entries.get(slot.gameId);
        const game = played.get(slot.gameId);
        if (entry === undefined || game === undefined) throw new Error(`an exported game is not finished: ${slot.gameId}`);
        const { x, o } = entry.players;
        rows.push([
            slot.number,
            slot.round,
            slot.pair,
            slot.opening,
            slot.game,
            x.name,
            o.name,
            entry.winner ?? ``,
            entry.reason,
            entry.turns,
            entry.rated,
            entry.test === true,
            isoSecond(game.startedAt),
            entry.finishedAt,
            ...(versioned ? [slot.versions?.x ?? ``, slot.versions?.o ?? ``] : []),
        ]);
        const text = gameText(query, slot.gameId, game, entry.timeControl, {
            name: slot.title,
            platform: siteName,
            startedAt: new Date(game.startedAt * 1000),
            cross: x.name,
            circle: o.name,
            timeControl: entry.timeControl,
            result: { winner: entry.winner, reason: entry.reason },
        });
        return { name: `${String(slot.number).padStart(width, `0`)}-${fileSafe(x.name)}-vs-${fileSafe(o.name)}.htttx`, data: text, modified: new Date(entry.finishedAt) };
    });
    return { files, csv: csvText(rows) };
}

// A tournament's finished games in the order played, by round, pairing, and game.
function slotsOf(tournament: TournamentDetail): Slot[] {
    const slots: Slot[] = [];
    const duel = tournament.format === `duel`;
    const kind = tournament.test ? `Test` : `Duel`;
    const version = (key: number) => tournament.entries.find((entry) => entry.key === key)?.version ?? ``;
    for (const round of tournament.rounds) {
        for (const pairing of round.pairings) {
            const of = pairing.games.length;
            for (const [index, game] of pairing.games.entries()) {
                if (game.gameId === null || (game.outcome !== `played` && game.outcome !== `aborted`)) continue;
                const place = `game ${String(index + 1)} of ${String(of)}`;
                const o = game.x === pairing.first.key ? pairing.second.key : pairing.first.key;
                slots.push({
                    gameId: game.gameId,
                    number: slots.length + 1,
                    round: round.round,
                    pair: `${pairing.first.name} vs ${pairing.second.name}`,
                    opening: Math.floor(index / 2) + 1,
                    game: index + 1,
                    title: duel ? `${kind}, ${place}` : `${tournament.name}, round ${String(round.round)}, ${place}`,
                    ...(tournament.test ? { versions: { x: version(game.x), o: version(o) } } : {}),
                });
            }
        }
    }
    return slots;
}

// The zip: each game's file, named for its number in the export and its players, then games.csv and standings.csv.
function built(query: Query, tournament: TournamentDetail, slots: readonly Slot[], finished: readonly FinishedGameEntry[], now: number): GameExport {
    const duel = tournament.format === `duel`;
    const { files, csv } = gameEntries(query, slots, finished);
    const standings = csvText([
        [`rank`, `bot`, `owner`, `points`, `as_x`, `as_o`, `withdrawn`],
        ...tournament.standings.map((line) => [line.rank, line.bot, line.ownerName, line.points, line.asX, line.asO, line.withdrawn]),
    ]);
    const at = new Date(now);
    const [first, second] = tournament.entries;
    const day = tournament.startsAt.slice(0, 10);
    const fileName =
        duel && first !== undefined && second !== undefined
            ? `hexo-arena-${tournament.test ? `test` : `duel`}-${fileSafe(first.bot)}-vs-${fileSafe(second.bot)}-${day}.zip`
            : `hexo-arena-tournament-${fileSafe(tournament.name)}-${day}.zip`;
    return { fileName, body: zipStore([...files, { name: `games.csv`, data: csv, modified: at }, { name: `standings.csv`, data: standings, modified: at }]) };
}

/** Finished tournaments whose exports stay built, the least recently downloaded dropped first. */
export const finishedExportCap = 8;

/**
 * Tournaments' exports, a finished one's built once:
 * its games never change, so its zip is kept while what it names stands,
 * and is built again only once a deletion or the operator changes a name or a game's rating;
 * a tournament still running is built on every download.
 */
export class TournamentExports {
    readonly #held = new Map<string, { readonly shown: string; readonly file: GameExport }>();

    /**
     * The tournament's finished games in the order played, by round, pairing,
     * and game, each numbered within its pair, with games.csv and
     * standings.csv; a duel's titled and named for its two bots, and a test's
     * naming each bot's version.
     */
    read(query: Query, tournament: TournamentDetail, now: number): GameExport {
        const slots = slotsOf(tournament);
        const finished = finishedEntriesOf(query, slots.map((slot) => slot.gameId));
        if (tournament.status === `scheduled` || tournament.status === `running`) return built(query, tournament, slots, finished, now);
        // Everything the zip says but the moves, which a finished game never changes.
        const shown = JSON.stringify([tournament, finished.map((entry) => [entry.gameId, entry.players.x.name, entry.players.o.name, entry.rated, entry.voided])]);
        const held = this.#held.get(tournament.id);
        // Deleted first either way, so the map's order is the order tournaments were last downloaded.
        this.#held.delete(tournament.id);
        if (held?.shown === shown) {
            this.#held.set(tournament.id, held);
            return held.file;
        }
        const file = built(query, tournament, slots, finished, now);
        this.#held.set(tournament.id, { shown, file });
        for (const id of this.#held.keys()) {
            if (this.#held.size <= finishedExportCap) break;
            this.#held.delete(id);
        }
        return file;
    }
}
