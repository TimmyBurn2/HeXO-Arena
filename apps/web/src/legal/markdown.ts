import { Lexer, type MarkedToken, type Token } from 'marked';
import { placeholderPattern, type Filling } from './documents';

/** Running text inside a block. */
export type Inline =
    | { readonly kind: `text`; readonly text: string }
    | { readonly kind: `strong` | `em` | `del`; readonly children: readonly Inline[] }
    | { readonly kind: `code`; readonly text: string }
    | { readonly kind: `break` }
    | { readonly kind: `link`; readonly href: string; readonly children: readonly Inline[] };

/** A block of a legal document, as the page renders it. */
export type Block =
    | { readonly kind: `heading`; readonly depth: number; readonly children: readonly Inline[] }
    | { readonly kind: `paragraph`; readonly children: readonly Inline[] }
    | { readonly kind: `list`; readonly ordered: boolean; readonly start: number; readonly items: readonly (readonly Block[])[] }
    | { readonly kind: `quote`; readonly blocks: readonly Block[] }
    | { readonly kind: `code`; readonly text: string }
    | { readonly kind: `rule` }
    | { readonly kind: `table`; readonly head: readonly (readonly Inline[])[]; readonly rows: readonly (readonly (readonly Inline[])[])[] };

/** A part of a legal document under its own second-level heading. */
export interface LegalSection {
    /** The heading as a fragment, so a link can name the section. */
    readonly id: string;
    readonly heading: readonly Inline[];
    readonly blocks: readonly Block[];
    /** Written as one quote, which the law wants set apart from the text around it. */
    readonly standout: boolean;
}

/** A legal document laid out as its page shows it. */
export interface LegalLayout {
    /** The first top-level heading, the page's own title. */
    readonly title: readonly Inline[] | null;
    /** What stands under the title before the first section, such as the date. */
    readonly lead: readonly Block[];
    readonly sections: readonly LegalSection[];
}

// The lexer decodes escapes but leaves character references as written;
// these are the ones a plain-text document plausibly holds.
const references: Readonly<Record<string, string>> = { amp: `&`, lt: `<`, gt: `>`, quot: `"`, apos: `'`, nbsp: `\u00a0` };

function decode(text: string): string {
    return text.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (whole, name: string) => {
        if (name.startsWith(`#`)) {
            const code = name[1] === `x` || name[1] === `X` ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
        }
        return references[name.toLowerCase()] ?? whole;
    });
}

// Null when the text names a value this deployment leaves out, which
// takes the whole block holding it away.
function fillText(text: string, fill: (name: string) => Filling): string | null {
    const names = [...text.matchAll(placeholderPattern)].map((match) => match[1] ?? ``);
    if (names.some((name) => fill(name).kind === `absent`)) return null;
    return text.replace(placeholderPattern, (whole, name: string) => {
        const filling = fill(name);
        return filling.kind === `value` ? filling.text : whole;
    });
}

// Only addresses that lead somewhere a reader expects become links: the
// site's own pages, a fragment, the web, and mail.
// A path is read as the browser reads it, against the page's origin,
// since the browser takes `/\host` to another site as it does `//host`.
function safeHref(href: string): boolean {
    if (/^(?:https?:\/\/|mailto:|#)/i.test(href)) return true;
    const origin = window.location.origin;
    return href.startsWith(`/`) && URL.canParse(href, origin) && new URL(href, origin).origin === origin;
}

// The lexer runs without extensions, so every token is one of marked's own.
function own(token: Token): MarkedToken {
    return token as MarkedToken;
}

function inline(tokens: readonly Token[], fill: (name: string) => Filling): Inline[] | null {
    const out: Inline[] = [];
    for (const token of tokens.map(own)) {
        switch (token.type) {
            case `text`:
            case `escape`: {
                if (token.type === `text` && token.tokens !== undefined && token.tokens.length > 0) {
                    const children = inline(token.tokens, fill);
                    if (children === null) return null;
                    out.push(...children);
                    break;
                }
                // A line break inside a paragraph is a space, as Markdown reads it.
                const text = fillText(token.type === `text` ? decode(token.text).replace(/\n/g, ` `) : token.text, fill);
                if (text === null) return null;
                out.push({ kind: `text`, text });
                break;
            }
            case `strong`:
            case `em`:
            case `del`: {
                const children = inline(token.tokens, fill);
                if (children === null) return null;
                out.push({ kind: token.type, children });
                break;
            }
            case `codespan`: {
                const text = fillText(decode(token.text), fill);
                if (text === null) return null;
                out.push({ kind: `code`, text });
                break;
            }
            case `br`:
                out.push({ kind: `break` });
                break;
            case `link`: {
                const children = inline(token.tokens, fill);
                const href = fillText(token.href, fill);
                if (children === null || href === null) return null;
                out.push(...(safeHref(href) ? [{ kind: `link` as const, href, children }] : children));
                break;
            }
            // Raw HTML is dropped, never rendered or run, and images too:
            // the site loads nothing from elsewhere.
            case `html`:
            case `image`:
                break;
            case `blockquote`:
            case `checkbox`:
            case `code`:
            case `def`:
            case `heading`:
            case `hr`:
            case `list`:
            case `list_item`:
            case `paragraph`:
            case `space`:
            case `table`:
                break;
            default:
                return token satisfies never;
        }
    }
    return out;
}

// A paragraph broken into lines, as an address is, loses only the lines
// naming a value left out, so a name stays without its address.
function lines(tokens: readonly Token[], fill: (name: string) => Filling): Inline[] | null {
    const split: Token[][] = [[]];
    for (const token of tokens) {
        if (token.type === `br`) split.push([]);
        else split.at(-1)?.push(token);
    }
    if (split.length === 1) return inline(tokens, fill);
    const kept = split.map((line) => inline(line, fill)).filter((line): line is Inline[] => line !== null && line.length > 0);
    if (kept.length === 0) return null;
    return kept.flatMap((line, index) => (index === 0 ? line : [{ kind: `break` as const }, ...line]));
}

function blocks(tokens: readonly Token[], fill: (name: string) => Filling): Block[] {
    const out: Block[] = [];
    for (const token of tokens.map(own)) {
        switch (token.type) {
            case `heading`: {
                const children = inline(token.tokens, fill);
                if (children !== null) out.push({ kind: `heading`, depth: token.depth, children });
                break;
            }
            case `paragraph`:
            case `text`: {
                const children = lines(token.type === `text` ? [token] : token.tokens, fill);
                if (children !== null && children.length > 0) out.push({ kind: `paragraph`, children });
                break;
            }
            case `list`: {
                // An item naming a value left out goes, and the list with
                // its last item.
                const items = token.items.map((item) => blocks(item.tokens, fill)).filter((item) => item.length > 0);
                if (items.length > 0) out.push({ kind: `list`, ordered: token.ordered, start: token.start === `` ? 1 : token.start, items });
                break;
            }
            case `blockquote`: {
                const inner = blocks(token.tokens, fill);
                if (inner.length > 0) out.push({ kind: `quote`, blocks: inner });
                break;
            }
            case `code`: {
                const text = fillText(token.text, fill);
                if (text !== null) out.push({ kind: `code`, text });
                break;
            }
            case `hr`:
                out.push({ kind: `rule` });
                break;
            case `table`: {
                const head = token.header.map((cell) => inline(cell.tokens, fill));
                const rows = token.rows
                    .map((row) => row.map((cell) => inline(cell.tokens, fill)))
                    .filter((row): row is Inline[][] => row.every((cell) => cell !== null));
                if (head.every((cell): cell is Inline[] => cell !== null)) out.push({ kind: `table`, head, rows });
                break;
            }
            case `html`:
            case `space`:
            case `def`:
            case `checkbox`:
            case `list_item`:
            case `image`:
            case `br`:
            case `codespan`:
            case `del`:
            case `em`:
            case `escape`:
            case `link`:
            case `strong`:
                break;
            default:
                return token satisfies never;
        }
    }
    return out;
}

/** The words of running text, as a heading's fragment and the contents read them. */
export function plainText(children: readonly Inline[]): string {
    return children.map((child) => (child.kind === `text` || child.kind === `code` ? child.text : child.kind === `break` ? ` ` : plainText(child.children))).join(``);
}

// GitHub's rule, so a link written against the file on GitHub holds on
// the site: lowercase, punctuation dropped, spaces as hyphens, and a
// repeat numbered.
function slugger(): (heading: string) => string {
    const seen = new Map<string, number>();
    return (heading) => {
        const base = heading
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s_-]/gu, ``)
            .trim()
            .replace(/\s/g, `-`);
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        return count === 0 ? base : `${base}-${String(count)}`;
    };
}

/**
 * A legal document's Markdown laid out for its page: the title, the lead,
 * and one section per second-level heading, each placeholder filled.
 * A paragraph, list item, or table row naming a value the deployment
 * leaves out is left out with it; a paragraph broken into lines loses
 * only that line.
 */
export function layoutLegal(markdown: string, fill: (name: string) => Filling): LegalLayout {
    const all = blocks(new Lexer({ gfm: true }).lex(markdown), fill);
    const slug = slugger();
    let title: readonly Inline[] | null = null;
    const lead: Block[] = [];
    const sections: { id: string; heading: readonly Inline[]; blocks: Block[] }[] = [];
    for (const block of all) {
        if (block.kind === `heading` && block.depth === 1 && title === null && sections.length === 0) {
            title = block.children;
        } else if (block.kind === `heading` && block.depth <= 2) {
            sections.push({ id: slug(plainText(block.children)), heading: block.children, blocks: [] });
        } else {
            (sections.at(-1)?.blocks ?? lead).push(block);
        }
    }
    return {
        title,
        lead,
        sections: sections.map((section) => {
            const only = section.blocks.length === 1 ? section.blocks[0] : undefined;
            return only?.kind === `quote` ? { ...section, blocks: only.blocks, standout: true } : { ...section, standout: false };
        }),
    };
}
