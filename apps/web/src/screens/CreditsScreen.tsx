import { siteName } from '@hexo-arena/contract';
import { ThemeSwatch } from '../board/ThemeSwatch';
import { useRoute } from '../router/use-route';
import { themes, type ThemeId } from '../theme/themes';
import { useDocumentMeta } from '../use-document-meta';
import './CreditsScreen.css';

// What each look takes and from where, typed over the registry so no
// theme ships without its line here.
const origins: Readonly<Record<ThemeId, string>> = {
    ink: `A navy page and board with bone and cinnabar stones.`,
    hds: `Named for hexo.did.science. Board and stones from HeXO Renderer's HDS theme; the page from the Tailwind palette.`,
    htttx: `Named for the HTTTX notation. Board and stones from HeXO Renderer's HTTTX theme; the page derived from them.`,
    tyto: `Board and stones from HeXO Renderer's Tyto theme; the page from the palette of Tyto's Strix observatory.`,
    omok: `Board and stones from HeXO Renderer's Omok theme; the page is ${siteName}'s own warm brown.`,
    six: `Board, stones, and page after the default look of playsix.`,
};

interface Source {
    name: string;
    author: string;
    repository: string;
    copyright: string;
    colors: string;
}

const sources: readonly Source[] = [
    {
        name: `HeXO Renderer`,
        author: `MineKing`,
        repository: `https://github.com/MineKing9534/HeXO`,
        copyright: `Copyright (c) 2026 MineKing`,
        colors: `the boards and stones of HDS, HTTTX, Tyto, and Omok`,
    },
    {
        name: `Strix`,
        author: `Tyto (SootyOwl)`,
        repository: `https://github.com/SootyOwl/hexo-strix`,
        copyright: `Copyright (c) 2026 SootyOwl`,
        colors: `the Tyto page`,
    },
    {
        name: `playsix`,
        author: `CixMango`,
        repository: `https://github.com/CixMango/Six`,
        copyright: `Copyright (c) 2026 CixMango`,
        colors: `the Six theme`,
    },
    {
        name: `Tailwind CSS`,
        author: `Tailwind Labs`,
        repository: `https://github.com/tailwindlabs/tailwindcss`,
        copyright: `Copyright (c) Tailwind Labs, Inc.`,
        colors: `the HDS page, from its color palette`,
    },
];

export function CreditsScreen() {
    const route = useRoute();
    useDocumentMeta(route);

    return (
        <>
            <h1 className="screen-title">Credits</h1>
            <p className="credits-lead">
                Ink is {siteName}'s own look. The other five themes take their colors from the projects below,
                credited with thanks.
            </p>

            <h2 className="section-title">Themes</h2>
            <ul className="credit-list">
                {themes.map((theme) => (
                    <li key={theme.id} className="credit-theme">
                        <ThemeSwatch theme={theme.id} />
                        <div>
                            <h3 className="credit-name">{theme.label}</h3>
                            <p className="credit-line">{origins[theme.id]}</p>
                        </div>
                    </li>
                ))}
            </ul>

            <h2 className="section-title">Sources</h2>
            <ul className="credit-list">
                {sources.map((source) => (
                    <li key={source.name}>
                        <h3 className="credit-name">
                            <a href={source.repository} rel="noreferrer">
                                {source.name}
                            </a>
                        </h3>
                        <p className="credit-line">
                            By {source.author}. Colors for {source.colors}.
                        </p>
                        <p className="credit-line">MIT License, {source.copyright}</p>
                    </li>
                ))}
            </ul>

            <h2 className="section-title">Palettes, not code</h2>
            <p className="credits-prose">
                Each community theme reuses a color palette and a name, and nothing else: no code, fonts, sounds,
                images, or logos come from these projects. The colors stay as their sources wrote them; where a
                theme needed a shade its source lacks, it is derived from the source's own.
            </p>
            <details className="credits-license">
                <summary>The MIT License, under which all four sources are published</summary>
                <p>
                    Permission is hereby granted, free of charge, to any person obtaining a copy of this software
                    and associated documentation files (the "Software"), to deal in the Software without
                    restriction, including without limitation the rights to use, copy, modify, merge, publish,
                    distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
                    Software is furnished to do so, subject to the following conditions:
                </p>
                <p>
                    The above copyright notice and this permission notice shall be included in all copies or
                    substantial portions of the Software.
                </p>
                <p>
                    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
                    BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
                    NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
                    DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
                    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
                </p>
            </details>

            <h2 className="section-title">Discord</h2>
            <p className="credits-prose">
                The Discord symbol on the sign-in button is Discord's own, shown unaltered as Discord's brand
                guidelines allow. {siteName} is not made by or affiliated with Discord.
            </p>
        </>
    );
}
