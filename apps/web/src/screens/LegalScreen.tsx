import { useEffect, useMemo, type ReactNode } from 'react';
import { legalPageNames, legalPagePath, legalPages, notFoundMeta, type LegalPage } from '@hexo-arena/contract';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { legalStore, linksLegalPage, useLegal, type LegalSource } from '../legal/documents';
import { layoutLegal, plainText, type Block, type Inline } from '../legal/markdown';
import { Link } from '../router/Link';
import { useRoute } from '../router/use-route';
import { text } from '../text';
import { useDocumentMeta } from '../use-document-meta';
import { NotFoundScreen } from './NotFoundScreen';
import './LegalScreen.css';

// Past this many sections a page lists them first, so a reader can jump
// to the one they came for.
const contentsFrom = 5;

/**
 * A legal page: the deployment's document, its placeholders filled from
 * its details. Until the documents are read the page holds its title and
 * a placeholder frame, and a read that failed shows the error frame with
 * its retry; a document the deployment does not have is a page that is
 * not there.
 */
export function LegalScreen({ page }: { page: LegalPage }) {
    const route = useRoute();
    const legal = useLegal();
    const source = legal.status === `ready` ? legal.documents.get(page) : undefined;
    const missing = legal.status === `ready` && !linksLegalPage(legal, page);
    useDocumentMeta(route, missing ? notFoundMeta.title : undefined, missing ? notFoundMeta.description : undefined);

    if (missing) return <NotFoundScreen />;
    if (source === undefined) {
        return (
            <>
                <header className="legal-head">
                    <h1 className="screen-title">{legalPageNames[page]}</h1>
                </header>
                {legal.status === `ready` ? (
                    <ErrorFrame
                        sentence={text.legal.failed}
                        onRetry={() => {
                            void legalStore.retry();
                        }}
                    />
                ) : (
                    <SkeletonRows />
                )}
            </>
        );
    }
    return <LegalDocument page={page} source={source} />;
}

function LegalDocument({ page, source }: { page: LegalPage; source: LegalSource }) {
    const layout = useMemo(() => layoutLegal(source.markdown, source.fill), [source]);
    const contents = layout.sections.length >= contentsFrom;

    // A link from another page may name a section, whose place exists only
    // once the text has rendered.
    useEffect(() => {
        const id = decodeURIComponent(window.location.hash.slice(1));
        if (id !== ``) document.getElementById(id)?.scrollIntoView();
    }, [page]);

    return (
        <>
            <header className="legal-head">
                <h1 className="screen-title">{layout.title === null ? legalPageNames[page] : <Inlines inlines={layout.title} />}</h1>
                {layout.lead.map((block, index) =>
                    block.kind === `paragraph` ? (
                        <p key={index} className="note">
                            <Inlines inlines={block.children} />
                        </p>
                    ) : (
                        <BlockView key={index} block={block} />
                    ),
                )}
            </header>
            <div className={`legal${contents ? ` legal-with-contents` : ``}`}>
                {contents ? (
                    <nav className="legal-contents" aria-labelledby="legal-contents-title">
                        <h2 id="legal-contents-title" className="legal-contents-title">
                            {text.legal.onThisPage}
                        </h2>
                        <ol>
                            {layout.sections.map((section) => (
                                <li key={section.id}>
                                    <a href={`#${section.id}`}>{plainText(section.heading)}</a>
                                </li>
                            ))}
                        </ol>
                    </nav>
                ) : null}
                <div className="legal-text">
                    {layout.sections.map((section) => (
                        // Plain sections, not named regions: twenty landmarks
                        // would drown the page's own.
                        <section key={section.id} id={section.id} className={`legal-section${section.standout ? ` card` : ``}`}>
                            <h2 className="section-title">
                                <Inlines inlines={section.heading} />
                            </h2>
                            {section.blocks.map((block, index) => (
                                <BlockView key={index} block={block} />
                            ))}
                        </section>
                    ))}
                </div>
            </div>
        </>
    );
}

function BlockView({ block }: { block: Block }): ReactNode {
    switch (block.kind) {
        case `heading`: {
            // Below the sections' own headings, whatever level the text wrote.
            const Heading = block.depth <= 3 ? `h3` : block.depth === 4 ? `h4` : block.depth === 5 ? `h5` : `h6`;
            return (
                <Heading>
                    <Inlines inlines={block.children} />
                </Heading>
            );
        }
        case `paragraph`:
            return (
                <p>
                    <Inlines inlines={block.children} />
                </p>
            );
        case `list`: {
            const items = block.items.map((item, index) => (
                <li key={index}>
                    {item.length === 1 && item[0]?.kind === `paragraph` ? <Inlines inlines={item[0].children} /> : item.map((inner, at) => <BlockView key={at} block={inner} />)}
                </li>
            ));
            return block.ordered ? <ol start={block.start}>{items}</ol> : <ul>{items}</ul>;
        }
        case `quote`:
            return (
                <blockquote className="card">
                    {block.blocks.map((inner, index) => (
                        <BlockView key={index} block={inner} />
                    ))}
                </blockquote>
            );
        case `code`:
            return (
                <pre>
                    <code>{block.text}</code>
                </pre>
            );
        case `rule`:
            return <hr />;
        case `table`:
            return (
                <div className="legal-table">
                    <table>
                        <thead>
                            <tr>
                                {block.head.map((cell, index) => (
                                    <th key={index} scope="col">
                                        <Inlines inlines={cell} />
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {block.rows.map((row, index) => (
                                <tr key={index}>
                                    {row.map((cell, at) => (
                                        <td key={at}>
                                            <Inlines inlines={cell} />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
    }
}

function Inlines({ inlines }: { inlines: readonly Inline[] }): ReactNode {
    return inlines.map((child, index) => <InlineView key={index} inline={child} />);
}

function InlineView({ inline }: { inline: Inline }): ReactNode {
    switch (inline.kind) {
        case `text`:
            return inline.text;
        case `strong`:
            return (
                <strong>
                    <Inlines inlines={inline.children} />
                </strong>
            );
        case `em`:
            return (
                <em>
                    <Inlines inlines={inline.children} />
                </em>
            );
        case `del`:
            return (
                <del>
                    <Inlines inlines={inline.children} />
                </del>
            );
        case `code`:
            return <code>{inline.text}</code>;
        case `break`:
            return <br />;
        case `link`:
            return <DocumentLink href={inline.href} inlines={inline.children} />;
    }
}

// A section of the page itself is a fragment the browser scrolls to;
// another page of the site goes through the router, which scrolls once it
// has rendered; anything else leaves the site.
// A legal document the deployment lacks leaves its words unlinked, so a
// deleted document never turns another's link into a dead end.
function DocumentLink({ href, inlines }: { href: string; inlines: readonly Inline[] }): ReactNode {
    const legal = useLegal();
    const words = <Inlines inlines={inlines} />;
    if (href.startsWith(`#`)) return <a href={href}>{words}</a>;
    const target = legalPages.find((page) => href.split(`#`)[0] === legalPagePath(page));
    if (target !== undefined && !linksLegalPage(legal, target)) return words;
    if (href.startsWith(`/`)) return <Link to={href}>{words}</Link>;
    return (
        <a href={href} rel="noreferrer">
            {words}
        </a>
    );
}
