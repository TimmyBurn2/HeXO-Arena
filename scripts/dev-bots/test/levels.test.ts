import { levelsSchema } from '@hexo-arena/contract';
import { describe, expect, it } from 'vitest';
import { devLevels, paceAt } from '../src/levels';

describe('the dev bots\' strengths', () => {
    const own = () => 900;

    it('declare three levels the contract takes, the middle one the default', () => {
        expect(levelsSchema.parse(devLevels)).toEqual(devLevels);
        expect(devLevels.list).toHaveLength(3);
        expect(devLevels.list[1]?.id).toBe(devLevels.default);
    });

    it('pause as long as a level other than the default declares, and at the default as the host paces', () => {
        expect(paceAt(devLevels, `quick`, own)()).toBe(200);
        expect(paceAt(devLevels, `slow`, own)()).toBe(4_000);
        expect(paceAt(devLevels, null, own)).toBe(own);
        expect(paceAt(devLevels, devLevels.default, own)).toBe(own);
    });

    it('play a level it no longer declares at its default', () => {
        expect(paceAt(devLevels, `gone`, own)).toBe(own);
    });
});
