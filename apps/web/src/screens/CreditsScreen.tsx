import { useRef, type ReactNode } from 'react';
import { ThemeSwatch } from '../board/ThemeSwatch';
import { DiscordSymbol } from '../components/DiscordSymbol';
import { YouTubeIcon } from '../components/YouTubeIcon';
import { useRoute } from '../router/use-route';
import { botApiRepository, thirdPartyLicensesPath } from '../site-links';
import { text } from '../text';
import { themes } from '../theme/themes';
import { useDocumentMeta } from '../use-document-meta';
import './CreditsScreen.css';

const credits = text.credits;

// The terms each credit is used under: the in-page MIT text, a license
// file, or a plain statement where nothing is licensed; for a credit that
// is a person or a place rather than a work, the platform its link opens.
type Terms =
    | { kind: `mit`; copyright: string }
    | { kind: `file`; label: string; href: string; copyright: string }
    | { kind: `plain`; label: string }
    | { kind: `platform`; platform: keyof typeof credits.platforms };

interface Credit {
    name: string;
    href: string;
    by?: string;
    gives: ReactNode;
    terms?: Terms;
}

const rows = credits.rows;

const platformMarks = { youtube: YouTubeIcon, discord: DiscordSymbol } satisfies Record<keyof typeof credits.platforms, () => ReactNode>;

const game: readonly Credit[] = [
    {
        ...rows.webgoatguy,
        href: `https://www.youtube.com/@webgoatguy`,
        gives: rows.webgoatguy.gives((words) => (
            <a href="https://www.youtube.com/watch?v=Ob6QINTMIOA" rel="noreferrer">
                {words}
            </a>
        )),
        terms: { kind: `platform`, platform: `youtube` },
    },
    { ...rows.hexoSite, href: `https://hexo.did.science` },
];

// Invites that never expire, so a link here keeps working.
const community: readonly Credit[] = [
    { ...rows.hexoDiscord, href: `https://discord.gg/M3TdwYzM2w`, terms: { kind: `platform`, platform: `discord` } },
    { ...rows.botDevDiscord, href: `https://discord.gg/7RDwUEt9rc`, terms: { kind: `platform`, platform: `discord` } },
];

const themeSources: readonly Credit[] = [
    { ...rows.renderer, href: `https://github.com/MineKing9534/HeXO`, terms: { kind: `mit`, copyright: rows.renderer.copyright } },
    { ...rows.strix, href: `https://github.com/SootyOwl/hexo-strix`, terms: { kind: `mit`, copyright: rows.strix.copyright } },
    { ...rows.playsix, href: `https://github.com/CixMango/Six`, terms: { kind: `mit`, copyright: rows.playsix.copyright } },
    { ...rows.tailwind, href: `https://github.com/tailwindlabs/tailwindcss`, terms: { kind: `mit`, copyright: rows.tailwind.copyright } },
];

const font: Credit = {
    ...rows.chakra,
    href: `https://github.com/m4rc1e/Chakra-Petch`,
    terms: { kind: `file`, label: rows.chakra.terms, href: `/fonts/chakra-petch-OFL.txt`, copyright: rows.chakra.copyright },
};

const protocol: readonly Credit[] = [
    {
        ...rows.htttx,
        href: `https://github.com/hex-tic-tac-toe/htttx-bot-api`,
        gives: rows.htttx.gives((words) => <a href={botApiRepository}>{words}</a>),
        terms: { kind: `mit`, copyright: rows.htttx.copyright },
    },
    { ...rows.glicko, href: `https://www.glicko.net/glicko.html`, terms: { kind: `plain`, label: rows.glicko.terms } },
];

const inspiration: readonly Credit[] = [
    { ...rows.lichess, href: `https://lichess.org`, terms: { kind: `plain`, label: rows.lichess.terms } },
];

/**
 * What the site builds on, one row style throughout: what, who, what it
 * gives here, and the terms; the game's origin and its community come
 * first, and the themes lead their part as tiles above their sources.
 */
export function CreditsScreen() {
    const route = useRoute();
    useDocumentMeta(route);
    const license = useRef<HTMLDetailsElement>(null);

    // A link to the license text opens it, since a fragment alone would
    // land on the closed summary.
    function openLicense() {
        if (license.current !== null) license.current.open = true;
    }

    return (
        <>
            <h1 className="screen-title">{credits.title}</h1>

            <section className="credits-section" aria-labelledby="credits-game">
                <h2 id="credits-game" className="section-title">
                    {credits.game}
                </h2>
                <p className="credits-prose">{credits.gameAbout((words) => <strong>{words}</strong>)}</p>
                <CreditRows credits={game} onLicense={openLicense} />
            </section>

            <section className="credits-section" aria-labelledby="credits-community">
                <h2 id="credits-community" className="section-title">
                    {credits.community}
                </h2>
                <CreditRows credits={community} onLicense={openLicense} />
                <p className="credits-small">{credits.marks}</p>
            </section>

            <section className="credits-section" aria-labelledby="credits-themes">
                <h2 id="credits-themes" className="section-title">
                    {credits.themes}
                </h2>
                <ul className="theme-row">
                    {themes.map((theme) => (
                        <li key={theme.id} className="theme-tile">
                            <ThemeSwatch theme={theme.id} />
                            <span className="theme-tile-name">{theme.label}</span>
                        </li>
                    ))}
                </ul>
                <p className="credits-prose">{credits.themesLead}</p>
                <CreditRows credits={themeSources} onLicense={openLicense} />
                <details className="credits-license" id="mit" ref={license}>
                    <summary>{credits.mitSummary}</summary>
                    {credits.mitText.map((paragraph) => (
                        <p key={paragraph}>{paragraph}</p>
                    ))}
                </details>
            </section>

            <section className="credits-section" aria-labelledby="credits-font">
                <h2 id="credits-font" className="section-title">
                    {credits.font}
                </h2>
                <CreditRows credits={[font]} onLicense={openLicense} />
            </section>

            <section className="credits-section" aria-labelledby="credits-protocol">
                <h2 id="credits-protocol" className="section-title">
                    {credits.protocol}
                </h2>
                <CreditRows credits={protocol} onLicense={openLicense} />
            </section>

            <section className="credits-section" aria-labelledby="credits-inspiration">
                <h2 id="credits-inspiration" className="section-title">
                    {credits.inspiration}
                </h2>
                <CreditRows credits={inspiration} onLicense={openLicense} />
            </section>

            <section className="credits-section" aria-labelledby="credits-licenses">
                <h2 id="credits-licenses" className="section-title">
                    {credits.licenses}
                </h2>
                <p className="credits-prose">{credits.licensesProse((words) => <a href={thirdPartyLicensesPath}>{words}</a>)}</p>
            </section>
        </>
    );
}

function CreditRows({ credits: list, onLicense }: { credits: readonly Credit[]; onLicense: () => void }) {
    return (
        <ul className="credit-rows">
            {list.map((credit) => (
                <li key={credit.name} className="credit-row">
                    <div className="credit-who">
                        <a href={credit.href} rel="noreferrer">
                            {credit.name}
                        </a>
                        {credit.by === undefined ? null : <span className="credit-by">{credit.by}</span>}
                    </div>
                    <p className="credit-for">{credit.gives}</p>
                    {credit.terms === undefined ? null : (
                        <div className="credit-terms">
                            <CreditTerms terms={credit.terms} onLicense={onLicense} />
                        </div>
                    )}
                </li>
            ))}
        </ul>
    );
}

function CreditTerms({ terms, onLicense }: { terms: Terms; onLicense: () => void }) {
    switch (terms.kind) {
        case `mit`:
            return (
                <>
                    <a href="#mit" onClick={onLicense}>
                        {credits.mit}
                    </a>
                    <span className="credit-copy">{terms.copyright}</span>
                </>
            );
        case `file`:
            return (
                <>
                    <a href={terms.href}>{terms.label}</a>
                    <span className="credit-copy">{terms.copyright}</span>
                </>
            );
        case `plain`:
            return <span className="credit-plain">{terms.label}</span>;
        case `platform`: {
            const Mark = platformMarks[terms.platform];
            return (
                <span className="credit-platform">
                    <Mark />
                    {credits.platforms[terms.platform]}
                </span>
            );
        }
    }
}
