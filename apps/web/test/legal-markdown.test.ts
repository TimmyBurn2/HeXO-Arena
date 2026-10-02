import { describe, expect, it } from 'vitest';
import type { Filling } from '../src/legal/documents';
import { layoutLegal, plainText, type Block } from '../src/legal/markdown';

const values = new Map([
    [`operator.name`, `Ada *Beispiel* <b>`],
    [`operator.email`, `contact@arena.example`],
]);

function fill(name: string): Filling {
    const value = values.get(name);
    if (value !== undefined) return { kind: `value`, text: value };
    return name.startsWith(`mailProvider.`) || name === `operator.discord` ? { kind: `absent` } : { kind: `unknown` };
}

function words(blocks: readonly Block[]): string[] {
    return blocks.flatMap((block): string[] => {
        switch (block.kind) {
            case `heading`:
            case `paragraph`:
                return [plainText(block.children)];
            case `list`:
                return block.items.flatMap(words);
            case `quote`:
                return words(block.blocks);
            case `code`:
                return [block.text];
            case `rule`:
                return [];
            case `table`:
                return [...block.head, ...block.rows.flat()].map(plainText);
        }
    });
}

describe('a legal document laid out for its page', () => {
    it('takes the first heading as the title, what follows as the lead, and each second-level heading as a section', () => {
        const layout = layoutLegal(`# Terms of use\n\nLast updated today\n\n## The service\n\nOne.\n\n### Detail\n\nTwo.\n\n## Law\n\nThree.`, fill);
        expect(layout.title === null ? null : plainText(layout.title)).toBe(`Terms of use`);
        expect(words(layout.lead)).toEqual([`Last updated today`]);
        expect(layout.sections.map((section) => [section.id, plainText(section.heading), words(section.blocks)])).toEqual([
            [`the-service`, `The service`, [`One.`, `Detail`, `Two.`]],
            [`law`, `Law`, [`Three.`]],
        ]);
    });

    it('names each section by its heading as GitHub does, numbering a repeat', () => {
        const layout = layoutLegal(`## Do you have to provide data?\n\n## Impressum / Legal notice\n\n## Law\n\n## Law`, fill);
        expect(layout.sections.map((section) => section.id)).toEqual([`do-you-have-to-provide-data`, `impressum--legal-notice`, `law`, `law-1`]);
    });

    it('sets a section written as one quote apart, its text unquoted', () => {
        const layout = layoutLegal(`## Right to object\n\n> You may object.\n> It then stops.\n\n## Other\n\n> A quote.\n\nAnd text.`, fill);
        expect(layout.sections.map((section) => section.standout)).toEqual([true, false]);
        expect(layout.sections[0]?.blocks).toEqual([{ kind: `paragraph`, children: [{ kind: `text`, text: `You may object. It then stops.` }] }]);
    });

    it('fills placeholders as plain text, which Markdown and markup inside a value never become', () => {
        const layout = layoutLegal(`## Who\n\nRun by {{operator.name}}; write to [{{operator.email}}](mailto:{{operator.email}}).`, fill);
        expect(layout.sections[0]?.blocks).toEqual([
            {
                kind: `paragraph`,
                children: [
                    { kind: `text`, text: `Run by Ada *Beispiel* <b>; write to ` },
                    { kind: `link`, href: `mailto:contact@arena.example`, children: [{ kind: `text`, text: `contact@arena.example` }] },
                    { kind: `text`, text: `.` },
                ],
            },
        ]);
    });

    it('leaves out the paragraph or list item naming a value the details leave out, and the list with its last item', () => {
        const layout = layoutLegal(
            `## Contact\n\nEmail: {{operator.email}}\n\nDiscord: {{operator.discord}}\n\n- The public.\n- {{mailProvider.name}}, the mailbox.\n\n- {{mailProvider.name}} alone.`,
            fill,
        );
        expect(words(layout.sections[0]?.blocks ?? [])).toEqual([`Email: contact@arena.example`, `The public.`]);
    });

    it('leaves out only the line naming a value left out from a paragraph broken into lines, as an address is', () => {
        const layout = layoutLegal(`## Who\n\n{{operator.email}}\\\n{{operator.discord}}\\\nGermany\n\n{{operator.discord}}\\\n{{mailProvider.name}}`, fill);
        expect(layout.sections[0]?.blocks).toEqual([
            {
                kind: `paragraph`,
                children: [{ kind: `text`, text: `contact@arena.example` }, { kind: `break` }, { kind: `text`, text: `Germany` }],
            },
        ]);
    });

    it('shows a placeholder nobody knows as written, so a misspelling is plain on the page', () => {
        const layout = layoutLegal(`## Who\n\nRun by {{operater.name}}.`, fill);
        expect(words(layout.sections[0]?.blocks ?? [])).toEqual([`Run by {{operater.name}}.`]);
    });

    it('drops raw HTML and images, and links only the site, fragments, the web, and mail', () => {
        const layout = layoutLegal(
            [
                `## Links`,
                ``,
                `<script>alert(1)</script>`,
                ``,
                `A <i>b</i> ![c](https://elsewhere.example/c.png) [site](/credits) [part](#law) [web](https://example.com/) [mail](mailto:a@b.example) [run](javascript:alert(1)) [data](data:text/html,x) [far](//elsewhere.example/) [near](credits).`,
            ].join(`\n`),
            fill,
        );
        const paragraph = layout.sections[0]?.blocks;
        expect(paragraph?.length).toBe(1);
        const children = paragraph?.[0]?.kind === `paragraph` ? paragraph[0].children : [];
        expect(children.flatMap((child) => (child.kind === `link` ? [child.href] : []))).toEqual([`/credits`, `#law`, `https://example.com/`, `mailto:a@b.example`]);
        expect(plainText(children)).toBe(`A b  site part web mail run data far near.`);
    });

    it('reads character references and escapes as the characters they stand for', () => {
        const layout = layoutLegal(`## Signs\n\nAda &amp; Bo, \\*not emphasis\\*, &#65;&#x42; &unknown;`, fill);
        expect(words(layout.sections[0]?.blocks ?? [])).toEqual([`Ada & Bo, *not emphasis*, AB &unknown;`]);
    });

    it('keeps lists, emphasis, code, rules, and tables', () => {
        const layout = layoutLegal(`## All\n\n1. **one**\n2. _two_ \`code\`\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n\`\`\`\nblock\n\`\`\``, fill);
        expect(layout.sections[0]?.blocks.map((block) => block.kind)).toEqual([`list`, `rule`, `table`, `code`]);
        expect(words(layout.sections[0]?.blocks ?? [])).toEqual([`one`, `two code`, `a`, `b`, `1`, `2`, `block`]);
    });
});
