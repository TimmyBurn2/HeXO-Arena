import { gameExportGlobalLimit, gameExportLimit, tournamentListSchema, type Side } from '@hexo-arena/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBot, findBot } from '../src/bots';
import { createQuery, type Query } from '../src/db';
import { endDuel } from '../src/duel-store';
import { csvCell, csvText, fileSafe } from '../src/game-export';
import { insertBotGame, insertMove, recordFinish, type BotGameTag, type OpeningCell } from '../src/game-store';
import { defaultLimits } from '../src/request-limits';
import { createUserWithExactName } from '../src/users';
import { seedDuel, seedTournament } from './event-fixtures';
import { createTestApp, roomyLimits, type TestApp } from './helpers';
import { readZip, type ReadEntry } from './zip-reader';

describe('csvCell', () => {
    it.each([
        [`alpha`, `alpha`],
        [`a,b`, `"a,b"`],
        [`say "hi"`, `"say ""hi"""`],
        [`two\nlines`, `"two\nlines"`],
        [`=SUM(A1:A2)`, `'=SUM(A1:A2)`],
        [`+1`, `'+1`],
        [`-x`, `'-x`],
        [`@here`, `'@here`],
        [`=a,"b"`, `"'=a,""b"""`],
        [``, ``],
    ])('writes %j as %j', (value, written) => {
        expect(csvCell(value)).toBe(written);
    });

    it('writes numbers and booleans as they are, and ends every row with CRLF', () => {
        expect(csvText([[`number`, `rated`], [-1, false], [12, true]])).toBe(`number,rated\r\n-1,false\r\n12,true\r\n`);
    });
});

describe('fileSafe', () => {
    it('keeps letters, digits, dots, dashes, and underscores, and joins the rest into single dashes', () => {
        expect(fileSafe(`devbot-b`)).toBe(`devbot-b`);
        expect(fileSafe(`deleted bot`)).toBe(`deleted-bot`);
        expect(fileSafe(`Cup "final" / 2026-10-04`)).toBe(`Cup-final-2026-10-04`);
        expect(fileSafe(`..[]..`)).toBe(`game`);
    });
});

const match = { mode: `match` as const, mainTimeMs: 300_000, incrementMs: 3_000 };
const startedAt = Date.UTC(2026, 9, 1, 12) / 1000;

// Five opening stones: the origin, two for o, two for x, as a turn places them.
const opening: OpeningCell[] = [
    { x: 0, y: 0, player: 0 },
    { x: 0, y: 5, player: 1 },
    { x: 1, y: 5, player: 1 },
    { x: 1, y: 0, player: 0 },
    { x: 2, y: 0, player: 0 },
];

describe('the duel and tournament exports', () => {
    let world: TestApp;
    let query: Query;
    let clock: number;
    const ids = new Map<string, string>();

    beforeEach(async () => {
        clock = Date.UTC(2026, 9, 4, 12);
        world = await createTestApp({ limits: roomyLimits, now: () => clock });
        query = createQuery(world.sqlite);
        for (const [owner, botNames] of [
            [`ann`, [`alpha`, `alpha2`]],
            [`bob`, [`beta`]],
            [`cid`, [`gamma`]],
        ] as const) {
            const user = createUserWithExactName(query, `dev:${owner}`, owner);
            if (user === `name_taken`) throw new Error(`seed name taken`);
            ids.set(owner, user.id);
            for (const name of botNames) {
                if (createBot(query, user.id, name).kind !== `created`) throw new Error(`seed failed`);
                ids.set(name, findBot(query, name)?.id ?? ``);
            }
        }
    });

    afterEach(async () => {
        await world.app.close();
    });

    function id(name: string): string {
        const found = ids.get(name);
        if (found === undefined) throw new Error(`no seed named ${name}`);
        return found;
    }

    // A game between two bots, x the first named, started at the given minute past noon on 2026-10-01.
    function played(x: string, o: string, tag: BotGameTag, minute: number, marks: { unratedByChoice?: boolean; test?: boolean } = {}): string {
        const gameId = insertBotGame(query, { challengerBotId: id(x), destBotId: id(o), challengerSide: `x`, timeControl: match, opening, tag, ...marks });
        world.sqlite.prepare(`update games set created_at = ? where id = ?`).run(startedAt + minute * 60, gameId);
        return gameId;
    }

    function finish(gameId: string, winner: Side | null, reason: Parameters<typeof recordFinish>[2][`reason`], minute: number): void {
        recordFinish(query, gameId, { winner, reason });
        world.sqlite.prepare(`update games set finished_at = ? where id = ?`).run(startedAt + minute * 60, gameId);
    }

    // x lines up six along its row from the origin, the sixth on the first stone of its last turn.
    function sixInARow(gameId: string): void {
        const turns: [OpeningCell, OpeningCell][] = [
            [{ x: 0, y: 6, player: 1 }, { x: 1, y: 6, player: 1 }],
            [{ x: 3, y: 0, player: 0 }, { x: 4, y: 0, player: 0 }],
            [{ x: 0, y: 7, player: 1 }, { x: 1, y: 7, player: 1 }],
            [{ x: 5, y: 0, player: 0 }, { x: 6, y: 1, player: 0 }],
        ];
        for (const [index, cells] of turns.entries()) insertMove(query, { gameId, seq: index + 1, side: index % 2 === 0 ? `o` : `x`, cells });
    }

    async function download(url: string, address?: string) {
        const answer = await world.app.inject({ method: `GET`, url, ...(address === undefined ? {} : { headers: { 'x-forwarded-for': address } }) });
        return answer;
    }

    async function exported(url: string): Promise<{ fileName: string; entries: ReadEntry[] }> {
        const answer = await download(url);
        expect(answer.statusCode).toBe(200);
        expect(answer.headers[`content-type`]).toBe(`application/zip`);
        const disposition = String(answer.headers[`content-disposition`]);
        const fileName = /^attachment; filename="([ -~]+)"$/u.exec(disposition)?.[1] ?? ``;
        expect(fileName).toMatch(/^[A-Za-z0-9._-]+\.zip$/u);
        return { fileName, entries: readZip(answer.rawPayload) };
    }

    function finishedDuel(): string {
        const duelId = seedDuel(query, { startedBy: id(`cid`), first: id(`alpha`), second: id(`beta`), createdAt: startedAt, timeControl: match });
        const first = played(`alpha`, `beta`, { kind: `duel`, id: duelId, game: 1 }, 0, { unratedByChoice: true });
        sixInARow(first);
        finish(first, `x`, `six-in-a-row`, 9);
        const second = played(`beta`, `alpha`, { kind: `duel`, id: duelId, game: 2 }, 10, { unratedByChoice: true });
        finish(second, `o`, `surrender`, 11);
        endDuel(query, duelId, { status: `finished` }, startedAt + 660);
        return duelId;
    }

    it('downloads a duel as one HTTTX file per game, the opening written as its turns, beside games.csv', async () => {
        const duelId = finishedDuel();
        const { fileName, entries } = await exported(`/api/duels/${duelId}/export`);
        expect(fileName).toBe(`hexo-arena-duel-alpha-vs-beta-2026-10-01.zip`);
        expect(entries.map((entry) => entry.name)).toEqual([`01-alpha-vs-beta.htttx`, `02-beta-vs-alpha.htttx`, `games.csv`]);
        expect(entries[0]?.text).toBe(
            [
                `version[1]name[Duel, game 1 of 2]platform[HeXO Arena]utcdatetime[2026-10-01 12:00:00]playercross[alpha]playercircle[beta]timecontrol[300+3]endreason[win]winner[cross];`,
                `1. [5,-5][6,-5];`,
                `2. [1,0][2,0];`,
                `3. [6,-6][7,-6];`,
                `4. [3,0][4,0];`,
                `5. [7,-7][8,-7];`,
                `6. [5,0];`,
                ``,
            ].join(`\n`),
        );
        expect(entries[1]?.text).toBe(
            `version[1]name[Duel, game 2 of 2]platform[HeXO Arena]utcdatetime[2026-10-01 12:10:00]playercross[beta]playercircle[alpha]timecontrol[300+3]endreason[resign]winner[circle];\n1. [5,-5][6,-5];\n2. [1,0][2,0];\n`,
        );
        expect(entries[2]?.text).toBe(
            [
                `number,pair,x,o,winner,reason,turns,rated,test,started,finished`,
                `1,1,alpha,beta,x,six-in-a-row,6,false,false,2026-10-01T12:00:00Z,2026-10-01T12:09:00Z`,
                `2,1,beta,alpha,o,surrender,2,false,false,2026-10-01T12:10:00Z,2026-10-01T12:11:00Z`,
                ``,
            ].join(`\r\n`),
        );
    });

    it('downloads a running duel\'s games finished so far, leaving the live one out', async () => {
        const duelId = seedDuel(query, { startedBy: id(`cid`), first: id(`alpha`), second: id(`gamma`), games: 4, createdAt: startedAt });
        const first = played(`alpha`, `gamma`, { kind: `duel`, id: duelId, game: 1 }, 0, { unratedByChoice: true });
        finish(first, null, `terminated`, 5);
        played(`gamma`, `alpha`, { kind: `duel`, id: duelId, game: 2 }, 6, { unratedByChoice: true });
        const { entries } = await exported(`/api/duels/${duelId}/export`);
        expect(entries.map((entry) => entry.name)).toEqual([`01-alpha-vs-gamma.htttx`, `games.csv`]);
        expect(entries[0]?.text.split(`\n`)[0]).toBe(
            `version[1]name[Duel, game 1 of 4]platform[HeXO Arena]utcdatetime[2026-10-01 12:00:00]playercross[alpha]playercircle[gamma]timecontrol[300+3]endreason[draw];`,
        );
        expect(entries[1]?.text.split(`\r\n`)[1]).toBe(`1,1,alpha,gamma,,terminated,2,false,false,2026-10-01T12:00:00Z,2026-10-01T12:05:00Z`);
    });

    it('adds each bot\'s version as the test began to a test\'s games.csv, kept as text a spreadsheet will not run', async () => {
        const duelId = seedDuel(query, {
            startedBy: id(`ann`),
            first: id(`alpha`),
            second: id(`alpha2`),
            test: true,
            games: 20,
            createdAt: startedAt,
            versions: { first: `=1+1`, second: `v2, "fast"` },
        });
        finish(played(`alpha`, `alpha2`, { kind: `duel`, id: duelId, game: 1 }, 0, { unratedByChoice: true, test: true }), `o`, `timeout`, 2);
        finish(played(`alpha2`, `alpha`, { kind: `duel`, id: duelId, game: 2 }, 3, { unratedByChoice: true, test: true }), `x`, `six-in-a-row`, 4);
        const { fileName, entries } = await exported(`/api/duels/${duelId}/export`);
        expect(fileName).toBe(`hexo-arena-test-alpha-vs-alpha2-2026-10-01.zip`);
        expect(entries.at(-1)?.text.split(`\r\n`)).toEqual([
            `number,pair,x,o,winner,reason,turns,rated,test,started,finished,x_version,o_version`,
            `1,1,alpha,alpha2,o,timeout,2,false,true,2026-10-01T12:00:00Z,2026-10-01T12:02:00Z,'=1+1,"v2, ""fast"""`,
            `2,1,alpha2,alpha,x,six-in-a-row,2,false,true,2026-10-01T12:03:00Z,2026-10-01T12:04:00Z,"v2, ""fast""",'=1+1`,
            ``,
        ]);
        expect(entries[0]?.text.split(`\n`)[0]).toContain(`name[Test, game 1 of 20]`);
    });

    function runningTournament(): string {
        const tournamentId = `t_autumnrobin1`;
        seedTournament(query, {
            id: tournamentId,
            name: `Autumn [round] robin`,
            status: `running`,
            startsAt: startedAt,
            entries: [
                { botId: id(`alpha`), ownerId: id(`ann`), state: `playing` },
                { botId: id(`beta`), ownerId: id(`bob`), state: `playing` },
                { botId: id(`gamma`), ownerId: id(`cid`), state: `playing` },
            ],
            pairings: [
                { id: `p_r1`, round: 1, first: id(`alpha`), second: id(`beta`), game1: `played`, game1Seat: `first`, game2: `played`, game2Seat: `first` },
                { id: `p_r2`, round: 2, first: id(`gamma`), second: id(`alpha`), game1: `played`, game1Seat: `second`, game2: `live` },
                { id: `p_r3`, round: 3, first: id(`beta`), second: id(`gamma`) },
            ],
        });
        // Game 1 of each pairing seats its first bot on x, game 2 its second.
        finish(played(`alpha`, `beta`, { kind: `pairing`, id: `p_r1`, game: 1 }, 0), `x`, `six-in-a-row`, 3);
        finish(played(`beta`, `alpha`, { kind: `pairing`, id: `p_r1`, game: 2 }, 4), `o`, `timeout`, 6);
        finish(played(`gamma`, `alpha`, { kind: `pairing`, id: `p_r2`, game: 1 }, 7), `o`, `surrender`, 8);
        played(`alpha`, `gamma`, { kind: `pairing`, id: `p_r2`, game: 2 }, 9);
        return tournamentId;
    }

    it('downloads a tournament\'s games finished so far by round and pairing, with games.csv by round and standings.csv', async () => {
        const tournamentId = runningTournament();
        const { fileName, entries } = await exported(`/api/tournaments/${tournamentId}/export`);
        expect(fileName).toBe(`hexo-arena-tournament-Autumn-round-robin-2026-10-01.zip`);
        expect(entries.map((entry) => entry.name)).toEqual([`01-alpha-vs-beta.htttx`, `02-beta-vs-alpha.htttx`, `03-gamma-vs-alpha.htttx`, `games.csv`, `standings.csv`]);
        expect(entries[2]?.text.split(`\n`)[0]).toBe(
            `version[1]name[Autumn (round) robin, round 2, game 1 of 2]platform[HeXO Arena]utcdatetime[2026-10-01 12:07:00]playercross[gamma]playercircle[alpha]timecontrol[300+3]endreason[resign]winner[circle];`,
        );
        expect(entries[3]?.text.split(`\r\n`).map((line) => line.split(`,`).slice(0, 6).join(`,`))).toEqual([
            `number,round,x,o,winner,reason`,
            `1,1,alpha,beta,x,six-in-a-row`,
            `2,1,beta,alpha,o,timeout`,
            `3,2,gamma,alpha,o,surrender`,
            ``,
        ]);
        expect(entries[3]?.text.split(`\r\n`)[1]?.split(`,`)[7]).toBe(`true`);
        const [head, leader, ...tied] = entries[4]?.text.split(`\r\n`) ?? [];
        expect([head, leader]).toEqual([`rank,bot,owner,points,as_x,as_o,withdrawn`, `1,alpha,ann,3,1,2,false`]);
        // Two bots tied on nothing share second place, in no order of their own.
        expect(tied.sort()).toEqual([``, `2,beta,bob,0,0,0,false`, `2,gamma,cid,0,0,0,false`]);
    });

    it('answers not_found for an unknown or malformed duel or tournament', async () => {
        for (const url of [`/api/duels/d_aaaaaaaaaaaa/export`, `/api/duels/nope/export`, `/api/tournaments/t_aaaaaaaaaaaa/export`, `/api/tournaments/nope/export`]) {
            const answer = await download(url);
            expect(answer.statusCode).toBe(404);
            expect(answer.json()).toMatchObject({ code: `not_found` });
        }
    });

    it('lists the tournaments a bot entered with its place, newest over first, and answers not_found for an unknown bot', async () => {
        const runningId = runningTournament();
        seedTournament(query, {
            id: `t_springcup001`,
            name: `Spring cup`,
            status: `finished`,
            startsAt: startedAt - 86_400 * 7,
            endedAt: startedAt - 86_400 * 7 + 5_400,
            entries: [
                { botId: id(`alpha`), ownerId: id(`ann`), state: `withdrawn`, reason: `missed` },
                { botId: id(`gamma`), ownerId: id(`cid`), state: `playing` },
            ],
            pairings: [{ id: `p_spring1`, round: 1, first: id(`alpha`), second: id(`gamma`), game1: `no_show`, game1Seat: `first`, game2: `forfeit`, game2Seat: `first` }],
        });
        seedTournament(query, {
            id: `t_wintercup001`,
            name: `Winter cup`,
            status: `called_off`,
            startsAt: startedAt - 86_400 * 14,
            entries: [{ botId: id(`alpha`), ownerId: id(`ann`), state: `absent` }],
        });
        seedTournament(query, { id: `t_othercup0001`, name: `Other cup`, status: `finished`, startsAt: startedAt - 86_400, entries: [{ botId: id(`beta`), ownerId: id(`bob`), state: `playing` }] });
        const answer = await world.app.inject({ method: `GET`, url: `/api/tournaments?bot=ALPHA` });
        expect(answer.statusCode).toBe(200);
        const list = tournamentListSchema.parse(answer.json());
        expect(list.running).toMatchObject([{ id: runningId, bot: { state: `playing`, rank: 1, points: 3 } }]);
        expect(list.running[0]?.endedAt).toBeUndefined();
        expect(list.scheduled).toEqual([]);
        expect(list.past.map((tournament) => [tournament.id, tournament.endedAt, tournament.bot])).toEqual([
            [`t_springcup001`, `2026-09-24T13:30:00Z`, { state: `withdrawn`, reason: `missed`, rank: 2, points: 0 }],
            [`t_wintercup001`, `2026-09-17T13:00:00Z`, { state: `absent`, rank: null, points: null }],
        ]);
        const every = tournamentListSchema.parse((await world.app.inject({ method: `GET`, url: `/api/tournaments` })).json());
        expect(every.past.map((tournament) => tournament.id)).toEqual([`t_othercup0001`, `t_springcup001`, `t_wintercup001`]);
        expect(every.past.every((tournament) => tournament.bot === undefined)).toBe(true);
        expect((await world.app.inject({ method: `GET`, url: `/api/tournaments?bot=nobody` })).statusCode).toBe(404);
    });
});

describe('the export rate limits', () => {
    let world: TestApp;

    afterEach(async () => {
        await world.app.close();
    });

    it('hold one client to its burst of exports and every caller together to theirs, refusing as rate_limited', async () => {
        world = await createTestApp({ trustedProxy: `127.0.0.1`, now: () => 1_000_000, limits: { ...defaultLimits, public: roomyLimits.public } });
        const download = (address: string) => world.app.inject({ method: `GET`, url: `/api/duels/d_aaaaaaaaaaaa/export`, headers: { 'x-forwarded-for': address } });
        for (let taken = 0; taken < gameExportLimit.burst; taken += 1) expect((await download(`203.0.113.90`)).statusCode).toBe(404);
        const refused = await download(`203.0.113.90`);
        expect(refused.statusCode).toBe(429);
        expect(refused.json()).toMatchObject({ code: `rate_limited` });
        expect(refused.headers[`retry-after`]).toBe(String(gameExportLimit.refillMs / 1000));
        for (let taken = gameExportLimit.burst; taken < gameExportGlobalLimit.burst; taken += 1) {
            expect((await download(`203.0.113.${String(100 + Math.floor(taken / gameExportLimit.burst))}`)).statusCode).toBe(404);
        }
        expect((await download(`203.0.113.200`)).statusCode).toBe(429);
    });
});
