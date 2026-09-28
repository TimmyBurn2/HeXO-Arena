import { describe, expect, it } from 'vitest';
import {
    botMeta,
    botsMeta,
    clockText,
    durationText,
    finishReasonLabels,
    gameMeta,
    ladderMeta,
    notFoundMeta,
    pageTitle,
    plural,
    resultSentence,
    siteMeta,
} from '../src';

const names = { x: `alpha`, o: `beta` };

describe('page meta', () => {
    it('titles the root with the site and its tagline, and every other page with its name first', () => {
        expect(siteMeta().title).toBe(`HeXO Arena - one ladder for bots and humans`);
        expect(ladderMeta().title).toBe(`Ladder - HeXO Arena`);
        expect(botsMeta).toEqual({ title: `Bots - HeXO Arena`, description: `Every bot on HeXO Arena, online or not` });
        expect(pageTitle(`Credits`)).toBe(`Credits - HeXO Arena`);
        expect(notFoundMeta).toEqual({ title: `Not found - HeXO Arena`, description: `That page does not exist` });
    });

    it('describes the root and the ladder by the roster when it is known, and by the site otherwise', () => {
        const roster = { listed: 3, online: 1, leader: { name: `sealbot`, rating: 1712.4 } };
        expect(siteMeta(roster).description).toBe(`3 bots listed, 1 online; first on the ladder: sealbot (1712)`);
        expect(ladderMeta({ listed: 1, online: 0 }).description).toBe(`1 bot listed, none online`);
        expect(ladderMeta({ listed: 0, online: 0 }).description).toBe(`Connect a HeXO bot, or play one in the browser`);
        expect(ladderMeta().description).toBe(siteMeta().description);
    });

    it('titles a bot by its name alone and describes owner, rating, presence, and the start of its about', () => {
        const bot = { name: `sealbot`, ownerName: `alice`, rating: 1500, provisional: true, online: false, openForChallenges: false };
        expect(botMeta({ ...bot, about: `x`.repeat(130) })).toEqual({
            title: `sealbot - HeXO Arena`,
            description: `HeXO bot by alice, rated 1500 (provisional), offline. ${`x`.repeat(120)}...`,
        });
        expect(botMeta({ ...bot, provisional: false, online: true, openForChallenges: true }).description).toBe(
            `HeXO bot by alice, rated 1500, online and open for challenges`,
        );
        expect(botMeta({ ...bot, ownerName: null, online: true, about: `plays fast` }).description).toBe(
            `HeXO bot, rated 1500 (provisional), online, closed for challenges. plays fast`,
        );
    });

    it('titles a game by both names and describes it live by mover and clock, finished by its result', () => {
        expect(gameMeta({ status: `live`, names, toMove: `o`, timeControl: { mode: `match`, mainTimeMs: 300_000, incrementMs: 3_000 } })).toEqual({
            title: `alpha vs beta - HeXO Arena`,
            description: `Live; beta to move; match clock 5 min + 3 s`,
        });
        expect(gameMeta({ status: `live`, names, toMove: `x`, timeControl: `turn` }).description).toBe(`Live; alpha to move; turn clock`);
        expect(gameMeta({ status: `finished`, names, winner: `x`, reason: `surrender` }).description).toBe(`alpha won; beta resigned`);
    });
});

describe('resultSentence', () => {
    it('names the winner and how, in the contract words', () => {
        const said = (winner: `x` | `o` | null, reason: Parameters<typeof resultSentence>[0][`reason`]) => resultSentence({ winner, reason }, names);
        expect(said(`x`, `six-in-a-row`)).toBe(`alpha won with six in a row`);
        expect(said(`o`, `timeout`)).toBe(`beta won on time`);
        expect(said(`x`, `surrender`)).toBe(`alpha won; beta resigned`);
        expect(said(`o`, `disconnect`)).toBe(`beta won; alpha disconnected`);
        expect(said(`x`, `terminated`)).toBe(`alpha won; beta played an illegal move`);
        expect(said(null, `terminated`)).toBe(`No winner; the game reached the 24-hour limit`);
        expect(said(null, `aborted`)).toBe(`No winner; the game was aborted`);
    });

    it('reads the reader own side as you, capitalized only where it opens the sentence', () => {
        expect(resultSentence({ winner: `x`, reason: `six-in-a-row` }, names, `x`)).toBe(`You won with six in a row`);
        expect(resultSentence({ winner: `o`, reason: `surrender` }, names, `x`)).toBe(`beta won; you resigned`);
    });

    it('keeps a player name as written, even one that reads as a word', () => {
        expect(resultSentence({ winner: `x`, reason: `timeout` }, { x: `nobody`, o: `you` })).toBe(`nobody won on time`);
    });
});

describe('shared words', () => {
    it('labels every finish reason', () => {
        expect(Object.values(finishReasonLabels)).toEqual([`Six in a row`, `On time`, `Resignation`, `Disconnect`, `Terminated`, `Aborted`]);
    });

    it('words durations and clocks with a space before each unit', () => {
        expect([durationText(12_345), durationText(60_000), durationText(100_000)]).toEqual([`12 s`, `1 min`, `1 min 40 s`]);
        expect(clockText({ mode: `turn`, turnTimeMs: 20_000 })).toBe(`turn clock 20 s`);
        expect(clockText({ mode: `match`, mainTimeMs: 60_000, incrementMs: 0 })).toBe(`match clock 1 min`);
        expect(clockText({ mode: `unlimited` })).toBe(`unlimited`);
        expect(clockText(`match`)).toBe(`match clock`);
    });

    it('picks the singular noun for exactly one', () => {
        expect([0, 1, 2].map((count) => plural(count, `stone`, `stones`))).toEqual([`stones`, `stone`, `stones`]);
    });
});
