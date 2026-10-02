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
            `Community`,
            `Themes`,
            `Font`,
            `Protocol and ratings`,
            `Inspiration`,
            `Licenses`,
        ]);
    });

    it('point to the third-party licenses the build ships, under the name the footer gives them', () => {
        render(<CreditsScreen />);
        const link = screen.getByRole(`link`, { name: `Licenses` });
        expect(link.getAttribute(`href`)).toBe(`/third-party-licenses.txt`);
        expect(link.closest(`p`)?.textContent).toBe(
            `The open-source code your browser receives, such as React and zod, the font, and GitHub's mark are listed with their license texts under Licenses.`,
        );
    });

    it('credit the game to the creator who came up with it, with the video, and to the site where it is played', () => {
        render(<CreditsScreen />);
        expect(document.body.textContent).toContain(`HeXO is the game played here: each turn places 2 stones, and 6 in a row wins.`);
        expect(screen.getByRole(`link`, { name: `webgoatguy` }).getAttribute(`href`)).toBe(`https://www.youtube.com/@webgoatguy`);
        const creator = within(row(`webgoatguy`));
        expect(creator.getByRole(`link`, { name: `can tic-tac-toe, with hexagons?` }).getAttribute(`href`)).toBe(
            `https://www.youtube.com/watch?v=Ob6QINTMIOA`,
        );
        expect(row(`webgoatguy`).textContent).toContain(`Came up with HeXO in the video can tic-tac-toe, with hexagons?`);
        expect(creator.getByText(`YouTube`).querySelector(`svg.youtube-icon`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `hexo.did.science` }).getAttribute(`href`)).toBe(`https://hexo.did.science`);
        expect(within(row(`hexo.did.science`)).getByText(`WolverinDEV`)).toBeTruthy();
        expect(document.body.textContent).not.toContain(`not affiliated`);
    });

    it('link the community servers by their invites, each marked as Discord', () => {
        render(<CreditsScreen />);
        for (const [name, invite, gives] of [
            [`HeXO - Official`, `https://discord.gg/M3TdwYzM2w`, `The game's official community`],
            [`HexO Bot Dev`, `https://discord.gg/7RDwUEt9rc`, `Where people build HeXO bots`],
        ] as const) {
            expect(screen.getByRole(`link`, { name }).getAttribute(`href`)).toBe(invite);
            const server = within(row(name));
            expect(server.getByText(gives)).toBeTruthy();
            expect(server.getByText(`Discord`).querySelector(`svg.discord-symbol`)).toBeTruthy();
        }
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
        expect(document.body.textContent).toContain(`Ink is HeXO Arena's own. The other themes take their colors from these projects:`);
    });

    it('open the one MIT text from any MIT link', () => {
        render(<CreditsScreen />);
        const license = document.querySelector(`details#mit`);
        expect(license?.hasAttribute(`open`)).toBe(false);
        fireEvent.click(within(row(`Strix`)).getByRole(`link`, { name: `MIT License` }));
        expect(license?.hasAttribute(`open`)).toBe(true);
        expect(license?.textContent).toContain(`Permission is hereby granted, free of charge`);
    });

    it('credit the font under its own license, and the protocol, the ratings, and the sites it learns from', () => {
        render(<CreditsScreen />);
        const font = within(row(`Chakra Petch`));
        expect(font.getByRole(`link`, { name: `SIL Open Font License 1.1` }).getAttribute(`href`)).toBe(`/fonts/chakra-petch-OFL.txt`);
        expect(font.getByText(`Copyright 2018 The Chakra Petch Project Authors`)).toBeTruthy();
        const protocol = within(row(`htttx bot protocol`));
        expect(protocol.getByRole(`link`, { name: `Bot API` })).toBeTruthy();
        expect(protocol.getByText(`Copyright (c) 2026 hex-tic-tac-toe`)).toBeTruthy();
        expect(within(row(`Glicko-2`)).getByText(`Published method`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Glicko-2` }).getAttribute(`href`)).toBe(`https://www.glicko.net/glicko.html`);
        expect(within(row(`lichess`)).getByText(`Ideas and values only`)).toBeTruthy();
        expect(within(row(`RPS Strategy`)).getByText(`Henry Abrahamsen`)).toBeTruthy();
        expect(within(row(`RPS Strategy`)).getByText(`Ideas only`)).toBeTruthy();
        expect(within(row(`RPS Strategy`)).getByRole(`link`, { name: `RPS Strategy` }).getAttribute(`href`)).toBe(`https://rps.henhen1227.com`);
    });

    it('name the owners of the marks it shows, once, under the community', () => {
        render(<CreditsScreen />);
        const marks = screen.getByText(`Discord, GitHub, and YouTube are trademarks of Discord Inc., GitHub Inc., and Google LLC.`);
        expect(marks.closest(`section`)?.getAttribute(`aria-labelledby`)).toBe(`credits-community`);
    });
});
