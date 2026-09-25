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
        const parsed = parseBoardSettings(
            JSON.stringify({ numbers: true, coords: true }),
        );
        expect(parsed).toEqual({ numbers: true, coords: true });
    });

    it('drop the palette and stone style stored by earlier versions', () => {
        const parsed = parseBoardSettings(JSON.stringify({ palette: `walnut`, stones: `glyph`, numbers: true }));
        expect(parsed).toEqual({ ...defaultBoardSettings, numbers: true });
    });

    it('treat absent booleans as false', () => {
        expect(parseBoardSettings(JSON.stringify({}))).toEqual(defaultBoardSettings);
    });
});

describe('boardSettingsStore', () => {
    beforeEach(() => {
        window.localStorage.clear();
        boardSettingsStore.update(defaultBoardSettings);
    });

    it('persist updates to localStorage', () => {
        boardSettingsStore.update({ coords: true });
        expect(window.localStorage.getItem(`hexarena.board-rendering.v1`)).toContain(`"coords":true`);
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
        boardSettingsStore.update({ coords: true });
        unsubscribe();
        boardSettingsStore.update({ coords: false });
        expect(notified).toBe(1);
    });
});
