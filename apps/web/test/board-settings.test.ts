// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
    boardSettingsStore,
    defaultBoardSettings,
    parseBoardSettings,
} from '../src/board/board-settings';

describe('defaultBoardSettings', () => {
    it('render stones as full hexagons until the viewer chooses otherwise', () => {
        expect(defaultBoardSettings.stones).toBe(`hex`);
    });
});

describe('parseBoardSettings', () => {
    it('default on nothing stored', () => {
        expect(parseBoardSettings(null)).toEqual(defaultBoardSettings);
    });

    it('default on garbage', () => {
        expect(parseBoardSettings(`{not json`)).toEqual(defaultBoardSettings);
    });

    it('default on unknown enum values', () => {
        const parsed = parseBoardSettings(JSON.stringify({ palette: `lava`, stones: `star` }));
        expect(parsed).toEqual(defaultBoardSettings);
    });

    it('keep the stored choices', () => {
        const parsed = parseBoardSettings(
            JSON.stringify({ palette: `walnut`, stones: `glyph`, numbers: true, coords: true }),
        );
        expect(parsed).toEqual({ palette: `walnut`, stones: `glyph`, numbers: true, coords: true });
    });

    it('treat absent booleans as false', () => {
        const parsed = parseBoardSettings(JSON.stringify({ palette: `walnut` }));
        expect(parsed).toEqual({ ...defaultBoardSettings, palette: `walnut` });
    });
});

describe('boardSettingsStore', () => {
    beforeEach(() => {
        window.localStorage.clear();
        boardSettingsStore.update(defaultBoardSettings);
    });

    it('persist updates to localStorage', () => {
        boardSettingsStore.update({ palette: `walnut` });
        expect(window.localStorage.getItem(`hexarena.board-rendering.v1`)).toContain(`walnut`);
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
