// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
    boardSettingsStore,
    defaultBoardSettings,
    parseBoardSettings,
} from '../src/board/board-settings';

describe('parseBoardSettings', () => {
    it('default on nothing stored', () => {
        expect(parseBoardSettings(null)).toEqual(defaultBoardSettings);
    });

    it('default on garbage', () => {
        expect(parseBoardSettings(`{not json`)).toEqual(defaultBoardSettings);
    });

    it('keep the stored choices', () => {
        expect(parseBoardSettings(JSON.stringify({ numbers: true, glare: false }))).toEqual({ numbers: true, glare: false });
    });

    it('ignore the edge coordinates choice stored by earlier versions', () => {
        expect(parseBoardSettings(JSON.stringify({ numbers: true, coords: true }))).toEqual({ numbers: true, glare: true });
    });

    it('drop the palette and stone style stored by earlier versions', () => {
        const parsed = parseBoardSettings(JSON.stringify({ palette: `walnut`, stones: `glyph`, numbers: true }));
        expect(parsed).toEqual({ ...defaultBoardSettings, numbers: true });
    });

    it('treat absent numbers as off and absent glare as on', () => {
        expect(parseBoardSettings(JSON.stringify({}))).toEqual({ numbers: false, glare: true });
    });
});

describe('boardSettingsStore', () => {
    beforeEach(() => {
        window.localStorage.clear();
        boardSettingsStore.update(defaultBoardSettings);
    });

    it('persist updates to localStorage', () => {
        boardSettingsStore.update({ numbers: true });
        expect(window.localStorage.getItem(`hexarena.board-rendering.v1`)).toBe(`{"numbers":true,"glare":true}`);
    });

    it('put the glare choice on the root, where every stone and preview reads it', () => {
        expect(document.documentElement.dataset.glare).toBe(`on`);
        boardSettingsStore.update({ glare: false });
        expect(document.documentElement.dataset.glare).toBe(`off`);
        delete document.documentElement.dataset.glare;
        boardSettingsStore.start();
        expect(document.documentElement.dataset.glare).toBe(`off`);
    });

    it('read back what was written', () => {
        boardSettingsStore.update({ numbers: true });
        expect(boardSettingsStore.read().numbers).toBe(true);
    });

    it('notify subscribers on change', () => {
        let notified = 0;
        const unsubscribe = boardSettingsStore.subscribe(() => {
            notified += 1;
        });
        boardSettingsStore.update({ numbers: true });
        unsubscribe();
        boardSettingsStore.update({ numbers: false });
        expect(notified).toBe(1);
    });
});
