import { useEffect, type ReactNode } from 'react';
import { legalPagePath, type LegalDetails, type LegalPage } from '@hexo-arena/contract';
import { fetchLegalDetails } from '../api/client';
import { useAsync } from '../api/use-async';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { Link } from '../router/Link';
import { useRoute } from '../router/use-route';
import { legal, type LegalBlock, type LegalLinks } from '../text/legal';
import { useDocumentMeta } from '../use-document-meta';
import './LegalScreen.css';

// Past this many sections a page lists them first, so a reader can jump
// to the one they came for.
const contentsFrom = 5;

/**
 * A legal page: its text from the repository, the operator's values from
 * the deployment. Until the values arrive the page holds its title and a
 * placeholder frame, and if they fail it shows the error frame with its
 * retry; it never shows text with a gap where a value belongs.
 */
export function LegalScreen({ page }: { page: LegalPage }) {
    const route = useRoute();
    useDocumentMeta(route);
    const { data, error, limited, reload } = useAsync(fetchLegalDetails);

    return (
        <>
            <header className="legal-head">
                <h1 className="screen-title">{legal.names[page]}</h1>
                <p className="note">{legal.updated}</p>
            </header>
            {data !== null ? (
                <LegalBody page={page} details={data} />
            ) : error ? (
                <ErrorFrame sentence={legal.failed} onRetry={reload} wait={limited} />
            ) : (
                <SkeletonRows />
            )}
        </>
    );
}

function LegalBody({ page, details }: { page: LegalPage; details: LegalDetails }) {
    const { sections } = legal.pages[page](details, linksFrom(page));
    const contents = sections.length >= contentsFrom;

    // A link from another page may name a section, whose place exists only
    // once the text has rendered.
    useEffect(() => {
        const id = decodeURIComponent(window.location.hash.slice(1));
        if (id !== ``) document.getElementById(id)?.scrollIntoView();
    }, [page]);

    return (
        <div className={`legal${contents ? ` legal-with-contents` : ``}`}>
            {contents ? (
                <nav className="legal-contents" aria-labelledby="legal-contents-title">
                    <h2 id="legal-contents-title" className="legal-contents-title">
                        {legal.onThisPage}
                    </h2>
                    <ol>
                        {sections.map((section) => (
                            <li key={section.id}>
                                <a href={`#${section.id}`}>{section.heading}</a>
                            </li>
                        ))}
                    </ol>
                </nav>
            ) : null}
            <div className="legal-text">
                {sections.map((section) => (
                    // Plain sections, not named regions: twenty landmarks
                    // would drown the page's own.
                    <section key={section.id} id={section.id} className={`legal-section${section.standout === true ? ` card` : ``}`}>
                        <h2 className="section-title">{section.heading}</h2>
                        {section.blocks.map((block, index) => (
                            <Block key={index} block={block} />
                        ))}
                    </section>
                ))}
            </div>
        </div>
    );
}

function Block({ block }: { block: LegalBlock }): ReactNode {
    switch (block.kind) {
        case `text`:
            return <p>{block.text}</p>;
        case `list`:
            return (
                <ul>
                    {block.items.map((item, index) => (
                        <li key={index}>{item}</li>
                    ))}
                </ul>
            );
        case `address`:
            return (
                <address>
                    {block.lines.map((line, index) => (
                        <span key={index}>{line}</span>
                    ))}
                </address>
            );
    }
}

// A section of the page itself is a fragment the browser scrolls to; any
// other page goes through the router, which scrolls once it has rendered.
function linksFrom(page: LegalPage): LegalLinks {
    return {
        page: (target, words, section) =>
            target === page && section !== undefined ? (
                <a href={`#${section}`}>{words}</a>
            ) : (
                <Link to={`${legalPagePath(target)}${section === undefined ? `` : `#${section}`}`}>{words}</Link>
            ),
        mail: (address) => <a href={`mailto:${address}`}>{address}</a>,
        external: (href, words) => (
            <a href={href} rel="noreferrer">
                {words}
            </a>
        ),
    };
}
