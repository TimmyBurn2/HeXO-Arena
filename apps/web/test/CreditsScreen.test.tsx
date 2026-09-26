// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CreditsScreen } from '../src/screens/CreditsScreen';
import { themes } from '../src/theme/themes';

afterEach(() => {
    cleanup();
});

describe('CreditsScreen', () => {
    it('list every theme in picker order, each with its own preview and origin', () => {
        render(<CreditsScreen />);
        const rows = [...document.querySelectorAll(`.credit-theme`)];
        expect(rows.map((row) => row.querySelector(`h3`)?.textContent)).toEqual(themes.map((theme) => theme.label));
        rows.forEach((row, index) => {
            expect(row.querySelector(`svg`)?.getAttribute(`data-theme-preview`)).toBe(themes[index]?.id);
            expect(row.querySelector(`.credit-line`)?.textContent.length).toBeGreaterThan(20);
        });
    });

    it('link each source to its repository with its author and MIT copyright', () => {
        render(<CreditsScreen />);
        for (const [name, repository, copyright] of [
            [`HeXO Renderer`, `https://github.com/MineKing9534/HeXO`, `Copyright (c) 2026 MineKing`],
            [`Strix`, `https://github.com/SootyOwl/hexo-strix`, `Copyright (c) 2026 SootyOwl`],
            [`playsix`, `https://github.com/CixMango/Six`, `Copyright (c) 2026 CixMango`],
            [`Tailwind CSS`, `https://github.com/tailwindlabs/tailwindcss`, `Copyright (c) Tailwind Labs, Inc.`],
        ] as const) {
            const link = screen.getByRole(`link`, { name });
            expect(link.getAttribute(`href`)).toBe(repository);
            expect([...(link.closest(`li`)?.querySelectorAll(`p`) ?? [])].map((line) => line.textContent)).toContain(
                `MIT License, ${copyright}`,
            );
        }
    });

    it('say that only palettes are reused and how the Discord symbol is used', () => {
        render(<CreditsScreen />);
        expect(screen.getByRole(`heading`, { name: `Palettes, not code` })).toBeTruthy();
        expect(document.body.textContent).toContain(`no code, fonts, sounds, images, or logos come from these projects`);
        expect(document.body.textContent).toContain(`shown unaltered as Discord's brand guidelines allow`);
        expect(screen.getByText(/^The MIT License/).closest(`details`)).toBeTruthy();
    });
});
