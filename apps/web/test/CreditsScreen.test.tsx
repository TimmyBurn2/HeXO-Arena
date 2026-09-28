// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CreditsScreen } from '../src/screens/CreditsScreen';
import { themes } from '../src/theme/themes';

afterEach(() => {
    cleanup();
});

function row(name: string): HTMLElement {
    const item = screen.getByRole(`link`, { name }).closest(`li`);
    if (!(item instanceof HTMLElement)) throw new Error(`no credit row for ${name}`);
    return item;
}

describe('CreditsScreen', () => {
    it('run its sections from the game to the fine print', () => {
        render(<CreditsScreen />);
        expect(screen.getAllByRole(`heading`, { level: 2 }).map((heading) => heading.textContent)).toEqual([
            `The game`,
            `Themes`,
            `Font`,
            `Protocol and ratings`,
            `Inspiration`,
            `Discord`,
        ]);
    });

    it('credit the game where it is played, its maker as that site names it, and say the rules are its own', () => {
        render(<CreditsScreen />);
        expect(document.body.textContent).toContain(
            `HeXO is the game played here: 2 stones a turn, six in a row wins. People play it at hexo.did.science, a site made by WolverinDEV.`,
        );
        expect(screen.getByRole(`link`, { name: `hexo.did.science` }).getAttribute(`href`)).toBe(`https://hexo.did.science`);
        expect(screen.getByText(`HeXO Arena implements the rules independently and is not affiliated with the HeXO project.`)).toBeTruthy();
    });

    it('show every theme as a tile of its preview and its name alone, in picker order', () => {
        render(<CreditsScreen />);
        const tiles = [...document.querySelectorAll(`.theme-row .theme-tile`)];
        expect(tiles.map((tile) => tile.textContent)).toEqual(themes.map((theme) => theme.label));
        tiles.forEach((tile, index) => {
            expect(tile.querySelector(`svg`)?.getAttribute(`data-theme-preview`)).toBe(themes[index]?.id);
        });
    });

    it('give each source a row of who, what it colors here, and its MIT copyright', () => {
        render(<CreditsScreen />);
        for (const [name, repository, by, gives, copyright] of [
            [`HeXO Renderer`, `https://github.com/MineKing9534/HeXO`, `MineKing`, `HDS, HTTTX, Tyto, and Omok boards and stones`, `Copyright (c) 2026 MineKing`],
            [`Strix`, `https://github.com/SootyOwl/hexo-strix`, `Tyto (SootyOwl)`, `The Tyto page`, `Copyright (c) 2026 SootyOwl`],
            [`playsix`, `https://github.com/CixMango/Six`, `CixMango`, `The Six board, stones, and page`, `Copyright (c) 2026 CixMango`],
            [`Tailwind CSS`, `https://github.com/tailwindlabs/tailwindcss`, `Tailwind Labs`, `The HDS page`, `Copyright (c) Tailwind Labs, Inc.`],
        ] as const) {
            expect(screen.getByRole(`link`, { name }).getAttribute(`href`)).toBe(repository);
            const credit = within(row(name));
            expect(credit.getByText(by)).toBeTruthy();
            expect(credit.getByText(gives)).toBeTruthy();
            expect(credit.getByText(copyright)).toBeTruthy();
            expect(credit.getByRole(`link`, { name: `MIT License` }).getAttribute(`href`)).toBe(`#mit`);
        }
        expect(document.body.textContent).toContain(`The other themes take their colors, and only their colors, from these projects:`);
        expect(document.body.textContent).toContain(`No code, fonts, images, or logos come from these projects.`);
    });

    it('open the one MIT text from any MIT link', () => {
        render(<CreditsScreen />);
        const license = document.querySelector(`details#mit`);
        expect(license?.hasAttribute(`open`)).toBe(false);
        fireEvent.click(within(row(`Strix`)).getByRole(`link`, { name: `MIT License` }));
        expect(license?.hasAttribute(`open`)).toBe(true);
        expect(license?.textContent).toContain(`Permission is hereby granted, free of charge`);
    });

    it('credit the font under its own license, and the protocol, the ratings, and the site it learns from', () => {
        render(<CreditsScreen />);
        const font = within(row(`Chakra Petch`));
        expect(font.getByRole(`link`, { name: `SIL Open Font License 1.1` }).getAttribute(`href`)).toBe(`/fonts/chakra-petch-OFL.txt`);
        expect(font.getByText(`Copyright 2018 The Chakra Petch Project Authors`)).toBeTruthy();
        const protocol = within(row(`htttx bot protocol`));
        expect(protocol.getByRole(`link`, { name: `Bot API` })).toBeTruthy();
        expect(protocol.getByText(`Copyright (c) 2026 hex-tic-tac-toe`)).toBeTruthy();
        expect(within(row(`Glicko-2`)).getByText(`Published method`)).toBeTruthy();
        expect(within(row(`lichess`)).getByText(`Ideas and values only`)).toBeTruthy();
        expect(screen.queryByText(/RPS Strategy/)).toBe(null);
    });

    it('credit the Discord symbol, name the mark, and leave out a licenses file that does not exist yet', () => {
        render(<CreditsScreen />);
        expect(document.body.textContent).toContain(
            `Discord is a trademark of Discord Inc.; HeXO Arena is not affiliated with Discord.`,
        );
        expect(screen.queryByText(/Third-party licenses/)).toBe(null);
    });
});
