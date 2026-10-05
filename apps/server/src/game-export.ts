import { boardCellSchema, siteName, turnsOfStones, writeHtttx, type DuelDetail, type TournamentDetail } from '@hexo-arena/contract';
import { replay, type Coord } from '@hexo-arena/rules';
import { asc, inArray } from 'drizzle-orm';
import type { Query } from './db';
import { games, moves } from './db/schema';
import { finishedEntriesOf } from './finished-games';
import { zipStore, type ZipEntry } from './zip';

// A downloadable archive: its file name, plain ASCII, and its bytes.
interface GameExport {
    readonly fileName: string;
    readonly body: Buffer;
}

/** A game an export holds: its number, the pair or round it belongs to, and the name its file gives it. */
interface Slot {
    readonly gameId: string;
    readonly number: number;
    readonly group: number;
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
    readonly stones: readonly Coord[];
}

// Every stone of each game in placement order, the opening's first; a
// winning stone ends the replay, as the game ended on it.
function playedGames(query: Query, ids: readonly string[]): Map<string, Played> {
    if (ids.length === 0) return new Map();
    const placed = new Map<string, Coord[]>();
    const rows = query
        .select({ gameId: moves.gameId, firstX: moves.firstX, firstY: moves.firstY, secondX: moves.secondX, secondY: moves.secondY })
        .from(moves)
        .where(inArray(moves.gameId, [...ids]))
        .orderBy(asc(moves.gameId), asc(moves.seq))
        .all();
    for (const row of rows) {
        const cells = placed.get(row.gameId) ?? [];
        cells.push({ x: row.firstX, y: row.firstY }, { x: row.secondX, y: row.secondY });
        placed.set(row.gameId, cells);
    }
    const played = new Map<string, Played>();
    for (const row of query.select({ id: games.id, createdAt: games.createdAt, openingCells: games.openingCells }).from(games).where(inArray(games.id, [...ids])).all()) {
        const opening = boardCellSchema.array().parse(JSON.parse(row.openingCells));
        const replayed = replay([...opening, ...(placed.get(row.id) ?? [])]);
        if (!replayed.ok) throw new Error(`stored cell is illegal: ${row.id}`);
        played.set(row.id, { startedAt: row.createdAt, stones: replayed.position.stones });
    }
    return played;
}

const csvHead = [`x`, `o`, `winner`, `reason`, `turns`, `rated`, `test`, `started`, `finished`] as const;

// Each game's file and its row in games.csv, in the slots' order; a game
// missing from either read was never finished, which the slots rule out.
function gameEntries(query: Query, slots: readonly Slot[], group: `pair` | `round`): { files: ZipEntry[]; csv: string } {
    const ids = slots.map((slot) => slot.gameId);
    const entries = new Map(finishedEntriesOf(query, ids).map((entry) => [entry.gameId, entry]));
    const played = playedGames(query, ids);
    const width = Math.max(2, String(slots.at(-1)?.number ?? 0).length);
    const versioned = slots.some((slot) => slot.versions !== undefined);
    const rows: CsvCell[][] = [[`number`, group, ...csvHead, ...(versioned ? [`x_version`, `o_version`] : [])]];
    const files = slots.map((slot): ZipEntry => {
        const entry = entries.get(slot.gameId);
        const game = played.get(slot.gameId);
        if (entry === undefined || game === undefined) throw new Error(`an exported game is not finished: ${slot.gameId}`);
        const { x, o } = entry.players;
        rows.push([
            slot.number,
            slot.group,
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
        const text = writeHtttx(turnsOfStones(game.stones), {
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

/** A duel's or a test's finished games, numbered as the duel numbers them, with games.csv. */
export function duelExport(query: Query, duel: DuelDetail, now: number): GameExport {
    const kind = duel.kind === `test` ? `Test` : `Duel`;
    const version = (side: `first` | `second`) => duel[side].version ?? ``;
    const slots = duel.games.flatMap((game): Slot[] =>
        game.gameId === null || (game.state !== `played` && game.state !== `aborted`)
            ? []
            : [
                  {
                      gameId: game.gameId,
                      number: game.game,
                      group: Math.ceil(game.game / 2),
                      title: `${kind}, game ${String(game.game)} of ${String(duel.terms.games)}`,
                      ...(duel.kind === `test` ? { versions: { x: version(game.x), o: version(game.x === `first` ? `second` : `first`) } } : {}),
                  },
              ],
    );
    const { files, csv } = gameEntries(query, slots, `pair`);
    const day = duel.createdAt.slice(0, 10);
    return {
        fileName: `hexo-arena-${duel.kind}-${fileSafe(duel.first.name)}-vs-${fileSafe(duel.second.name)}-${day}.zip`,
        body: zipStore([...files, { name: `games.csv`, data: csv, modified: new Date(now) }]),
    };
}

/** A tournament's finished games by round, pairing, and game, with games.csv and standings.csv. */
export function tournamentExport(query: Query, tournament: TournamentDetail, now: number): GameExport {
    const slots: Slot[] = [];
    for (const round of tournament.rounds) {
        for (const pairing of round.pairings) {
            for (const [index, game] of pairing.games.entries()) {
                if (game.gameId === null || (game.outcome !== `played` && game.outcome !== `aborted`)) continue;
                slots.push({ gameId: game.gameId, number: slots.length + 1, group: round.round, title: `${tournament.name}, round ${String(round.round)}, game ${String(index + 1)} of 2` });
            }
        }
    }
    const { files, csv } = gameEntries(query, slots, `round`);
    const standings = csvText([
        [`rank`, `bot`, `owner`, `points`, `as_x`, `as_o`, `withdrawn`],
        ...tournament.standings.map((line) => [line.rank, line.bot, line.ownerName, line.points, line.asX, line.asO, line.withdrawn]),
    ]);
    const at = new Date(now);
    return {
        fileName: `hexo-arena-tournament-${fileSafe(tournament.name)}-${tournament.startsAt.slice(0, 10)}.zip`,
        body: zipStore([...files, { name: `games.csv`, data: csv, modified: at }, { name: `standings.csv`, data: standings, modified: at }]),
    };
}
