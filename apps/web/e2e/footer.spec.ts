import { expect, test, type Page } from '@playwright/test';
import type { Me } from '@hexo-arena/contract';
import { looks, wear } from './matrix';
import { roundRobins, serve, world } from './mock-api';

// A short screen's footer sits at the foot of the window, clear of the
// phone tab strip, rather than under the content wherever it ends.
for (const path of [`/nowhere`, `/game/nope`, `/profile`]) {
    for (const size of [
        { width: 1280, height: 900 },
        { width: 390, height: 844 },
    ]) {
        test(`the footer of ${path} sits at the foot of the window at ${String(size.width)} px`, async ({ page }) => {
            await page.setViewportSize(size);
            const look = looks[0];
            if (look === undefined) throw new Error(`no look registered`);
            await wear(page, look);
            await serve(page, world({ me: null }));
            await page.goto(path);
            await page.locator(`h1`).waitFor();
            const footer = await page.locator(`footer.site-footer`).boundingBox();
            const tabs = await page.locator(`nav.tabbar`).boundingBox();
            const floor = size.width <= 480 ? (tabs?.y ?? 0) : size.height;
            expect(Math.round((footer?.y ?? 0) + (footer?.height ?? 0))).toBe(Math.round(floor));
            if (size.width <= 480) {
                for (const link of await page.locator(`footer.site-footer a`).all()) {
                    const box = await link.boundingBox();
                    expect(box === null ? 0 : Math.round(box.height)).toBeGreaterThanOrEqual(44);
                }
            }
        });
    }
}

// The name and the tagline wrap as units: the footer keeps one line while
// it fits, breaks after the comma first once text is scaled up, and each
// span still wraps inside itself at the largest sizes.
test('the footer tagline breaks after the comma and wraps at large text', async ({ page }) => {
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world({ me: null }));
    const spans = page.locator(`.site-tagline span`);
    const lines = () =>
        spans.evaluateAll((elements) =>
            elements.map((element) => {
                const range = document.createRange();
                range.selectNodeContents(element);
                const tops = [...range.getClientRects()].map((rect) => Math.round(rect.top));
                const box = range.getBoundingClientRect();
                return { lines: new Set(tops).size, top: Math.round(box.top), right: box.right };
            }),
        );
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(`/nowhere`);
    await page.locator(`h1`).waitFor();
    const [name, tagline] = await lines();
    expect([name?.lines, tagline?.lines]).toEqual([1, 1]);
    expect(tagline?.top).toBe(name?.top);
    const devtools = await page.context().newCDPSession(page);
    await devtools.send(`Page.setFontSizes`, { fontSizes: { standard: 20 } });
    const [largerName, largerTagline] = await lines();
    expect(largerName?.lines).toBe(1);
    expect(largerTagline?.top ?? 0).toBeGreaterThan(largerName?.top ?? 0);
    await page.setViewportSize({ width: 390, height: 700 });
    await devtools.send(`Page.setFontSizes`, { fontSizes: { standard: 32 } });
    for (const span of await lines()) expect(span.right).toBeLessThanOrEqual(390);
});

// Scaled-up text on a narrow window must not leave one word of the tagline
// on a line of its own.
test('the footer tagline never ends on a lone word from 320 to 1280 px at 100, 150, and 200% text', async ({ page }) => {
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world({ me: null }));
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(`/nowhere`);
    await page.locator(`h1`).waitFor();
    const devtools = await page.context().newCDPSession(page);
    const lone: string[] = [];
    for (const size of [16, 24, 32]) {
        await devtools.send(`Page.setFontSizes`, { fontSizes: { standard: size } });
        for (let width = 320; width <= 1280; width += 10) {
            await page.setViewportSize({ width, height: 700 });
            const last = await page.locator(`.site-tagline span`).nth(1).evaluate((span) => {
                const words: { word: string; top: number }[] = [];
                const node = span.firstChild;
                if (node === null) return { lines: 0, words: `` };
                let at = 0;
                for (const word of (node.textContent ?? ``).split(` `)) {
                    const range = document.createRange();
                    range.setStart(node, at);
                    range.setEnd(node, at + word.length);
                    words.push({ word, top: Math.round(range.getBoundingClientRect().top) });
                    at += word.length + 1;
                }
                const tops = [...new Set(words.map((entry) => entry.top))];
                const bottom = Math.max(...tops);
                return { lines: tops.length, words: words.filter((entry) => entry.top === bottom).map((entry) => entry.word).join(` `) };
            });
            if (last.lines > 1 && !last.words.includes(` `)) lone.push(`${String(size)} px text at ${String(width)} px: ${last.words}`);
        }
    }
    expect(lone).toEqual([]);
});

type Edges = { left: number; right: number; top: number; bottom: number };

// The footer as the checks read it: its content box, the tagline, and each
// group of links with every link's box and the words on its last line.
async function footerLayout(page: Page) {
    return page.locator(`footer.site-footer .site-footer-inner`).evaluate((inner) => {
        const edges = (box: DOMRect): Edges => ({ left: box.left, right: box.right, top: box.top, bottom: box.bottom });
        const style = getComputedStyle(inner);
        const box = inner.getBoundingClientRect();
        // A word broken across lines ends on the line of its last piece.
        const lastLine = (node: Node | null) => {
            if (node === null) return { lines: 0, words: 0 };
            const words: number[] = [];
            let at = 0;
            for (const word of (node.textContent ?? ``).split(` `)) {
                const range = document.createRange();
                range.setStart(node, at);
                range.setEnd(node, at + word.length);
                words.push(Math.round(range.getBoundingClientRect().bottom));
                at += word.length + 1;
            }
            const bottom = Math.max(...words);
            return { lines: new Set(words).size, words: words.filter((entry) => entry === bottom).length };
        };
        return {
            content: { left: box.left + parseFloat(style.paddingLeft), right: box.right - parseFloat(style.paddingRight) },
            tagline: edges((inner.querySelector(`.site-tagline`) ?? inner).getBoundingClientRect()),
            groups: [...inner.querySelectorAll(`ul`)].map((group) => ({
                box: edges(group.getBoundingClientRect()),
                links: [...group.querySelectorAll(`a`)].map((link) => ({
                    label: link.textContent,
                    href: link.getAttribute(`href`),
                    box: edges(link.getBoundingClientRect()),
                    last: lastLine([...link.childNodes].find((node) => node.nodeType === Node.TEXT_NODE) ?? null),
                })),
            })),
            // The top bar's own overflow at large text is not the footer's.
            overflow: inner.scrollWidth - inner.clientWidth,
        };
    });
}

const legalLinks = [
    [`Impressum / Legal notice`, `/legal/imprint`],
    [`Privacy`, `/legal/privacy`],
    [`Terms`, `/legal/terms`],
    [`Licenses`, `/third-party-licenses.txt`],
];

const framedScreens = [`/`, `/play/duels`, `/play/tournament`, `/games`, `/games/duels`, `/games/tournaments`, `/tournaments/t_wintercup202`, `/tournaments/t_brunorobin01`, `/tournaments/t_anatest00001`, `/ladder`, `/bots`, `/bots/sealbot`, `/connect`, `/profile`, `/credits`, `/report`, `/legal/imprint`, `/legal/privacy`, `/legal/terms`, `/nowhere`, `/game/nope`];

// The legal links are the footer's last group: at the bottom right where
// the footer is a row, at its end where it stacks, signed in or out.
const visitors: readonly (readonly [string, Me])[] = [
    [`signed out`, null],
    [`signed in`, { kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: [], analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } }],
    [`a guest`, { kind: `guest`, name: `Guest k3f9`, liveGames: [] }],
];
for (const [visitor, me] of visitors) {
    for (const path of framedScreens) {
        test(`the legal links close the footer of ${path} for ${visitor} at 1280, 768, and 390 px`, async ({ page }) => {
            const look = looks[0];
            if (look === undefined) throw new Error(`no look registered`);
            await wear(page, look);
            await serve(page, world({ me, tournaments: [...world().tournaments, ...roundRobins] }));
            await page.setViewportSize({ width: 1280, height: 900 });
            await page.goto(path);
            await page.locator(`h1`).first().waitFor();
            for (const width of [1280, 768, 390]) {
                await page.setViewportSize({ width, height: 900 });
                const footer = await footerLayout(page);
                const legal = footer.groups.at(-1);
                // The report form's own link names no page; every other names the page it stands on.
                const report = path === `/report` ? `/report` : `/report?subject=${encodeURIComponent(path)}`;
                expect(legal?.links.map((link) => [link.label, link.href])).toEqual([...legalLinks, [`Report`, report]]);
                for (const group of footer.groups.slice(0, -1)) expect(legal?.box.top ?? 0).toBeGreaterThanOrEqual(group.box.bottom - 0.5);
                expect(legal?.box.bottom ?? 0).toBeGreaterThanOrEqual(footer.tagline.bottom - 0.5);
                if (width >= 640) expect(Math.abs((legal?.box.right ?? 0) - footer.content.right)).toBeLessThanOrEqual(0.5);
                else expect(Math.abs((legal?.box.left ?? 0) - footer.content.left)).toBeLessThanOrEqual(0.5);
                for (const link of legal?.links ?? []) await expect(page.locator(`footer.site-footer`).getByRole(`link`, { name: link.label })).toBeVisible();
                // Small print: the dim text, regular weight, unless it is the page shown.
                const print = await page.locator(`footer.site-footer .legal-links a:not([aria-current])`).evaluateAll((links) =>
                    links.map((link) => {
                        const probe = document.createElement(`span`);
                        probe.style.color = `var(--c-text-dim)`;
                        link.after(probe);
                        const dim = getComputedStyle(probe).color;
                        probe.remove();
                        return getComputedStyle(link).color === dim && getComputedStyle(link).fontWeight === `400`;
                    }),
                );
                expect(print.every(Boolean)).toBe(true);
            }
        });
    }
}

// Scaled-up text on any window width keeps each link inside its own group,
// the groups on lines of their own, and no label ending on one word alone;
// the footer never runs past the window.
test('the footer keeps its groups apart and leaves no lone word from 320 to 1280 px at 100, 150, and 200% text', async ({ page }) => {
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world({ me: null }));
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(`/nowhere`);
    await page.locator(`h1`).waitFor();
    const devtools = await page.context().newCDPSession(page);
    const faults: string[] = [];
    for (const size of [16, 24, 32]) {
        await devtools.send(`Page.setFontSizes`, { fontSizes: { standard: size } });
        for (const width of [...Array.from({ length: 97 }, (_, index) => 320 + index * 10), 481]) {
            await page.setViewportSize({ width, height: 700 });
            const footer = await footerLayout(page);
            const at = `${String(size)} px text at ${String(width)} px`;
            for (const [index, group] of footer.groups.entries()) {
                for (const link of group.links) {
                    const box = link.box;
                    if (box.left < group.box.left - 0.5 || box.right > group.box.right + 0.5 || box.top < group.box.top - 0.5 || box.bottom > group.box.bottom + 0.5) {
                        faults.push(`${at}: ${link.label} outside its group`);
                    }
                    if (link.last.lines > 1 && link.last.words < 2) faults.push(`${at}: ${link.label} ends on a lone word`);
                    if (box.right > width) faults.push(`${at}: ${link.label} past the window`);
                }
                // A group that wraps shares its links out evenly: never one
                // link alone on a line while another line holds three.
                const lines = new Map<number, number>();
                for (const link of group.links) lines.set(Math.round(link.box.top), (lines.get(Math.round(link.box.top)) ?? 0) + 1);
                const perLine = [...lines.values()];
                if (perLine.length > 1 && Math.min(...perLine) === 1 && Math.max(...perLine) >= 3) faults.push(`${at}: group ${String(index)} leaves a link alone`);
                const next = footer.groups[index + 1];
                if (next !== undefined && next.box.top < group.box.bottom - 0.5) faults.push(`${at}: groups ${String(index)} and ${String(index + 1)} share a line`);
            }
            if (footer.overflow > 0 || footer.tagline.right > width) faults.push(`${at}: the footer runs past the window`);
        }
    }
    expect(faults).toEqual([]);
});
