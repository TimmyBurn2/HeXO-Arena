import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { sessionCookieName, streamEventSchema } from '../src';
import { readHtttxBlock, renderBotApiYaml, renderStreamExamples } from '../src/bot-api';
import { buildOpenApiDocument } from '../src/openapi';

// A stand-in for the target's openapi.yaml: the real block is upstream's
// text and stays in the target repo.
const vendored = [
    `    # --- BEGIN vendored htttx ---`,
    `    # Verbatim from htttx-bot-api@0123abc`,
    `    Board:`,
    `      type: object`,
    `    MoveRequest:`,
    `      type: object`,
    `      properties:`,
    `        board:`,
    `          $ref: "#/components/schemas/Board"`,
    `    # --- END vendored htttx ---`,
    ``,
].join(`\n`);
const source = `openapi: 3.1.0\ncomponents:\n  schemas:\n    Stale:\n      type: object\n${vendored}`;
const htttx = readHtttxBlock(source);
const rendered = renderBotApiYaml(htttx);
const document: unknown = parse(rendered);

function dig(value: unknown, ...keys: string[]): unknown {
    let current = value;
    for (const key of keys) {
        if (typeof current !== `object` || current === null) return undefined;
        current = Reflect.get(current, key) as unknown;
    }
    return current;
}

function keysOf(value: unknown): string[] {
    return typeof value === `object` && value !== null ? Object.keys(value) : [];
}

function visitObjects(value: unknown, visit: (node: object) => void): void {
    if (typeof value !== `object` || value === null) return;
    visit(value);
    Object.values(value).forEach((child: unknown) => {
        visitObjects(child, visit);
    });
}

function operationIds(value: unknown): string[] {
    return keysOf(dig(value, `paths`)).flatMap((path) => {
        const item = dig(value, `paths`, path);
        return keysOf(item).map((method) => String(dig(item, method, `operationId`)));
    });
}

describe('bot api export', () => {
    it('holds exactly the bot operations', () => {
        expect(operationIds(document).sort()).toEqual([
            `acceptChallenge`,
            `cancelChallenge`,
            `createChallenge`,
            `declineChallenge`,
            `getAccount`,
            `listBots`,
            `openAnalysisSession`,
            `openEngineSession`,
            `openStream`,
            `resignBotGame`,
            `updateAccount`,
        ]);
    });

    it('names no session security scheme, cookie, or website path', () => {
        expect(keysOf(dig(document, `components`, `securitySchemes`)).sort()).toEqual([`bearerAuth`, `gameToken`]);
        visitObjects(document, (node) => {
            expect(Reflect.get(node, `in`)).not.toBe(`cookie`);
        });
        expect(rendered).not.toContain(sessionCookieName);
        expect(rendered.toLowerCase()).not.toContain(`cookie`);
        const botPaths = keysOf(dig(document, `paths`));
        const sitePaths = keysOf(dig(buildOpenApiDocument(), `paths`)).filter((path) => !botPaths.includes(path));
        expect(sitePaths.length).toBeGreaterThan(0);
        for (const path of sitePaths) expect(rendered).not.toContain(path);
    });

    it(`states only the rates a bot meets, none of the website's`, () => {
        const limited = String(dig(document, `components`, `responses`, `RateLimited`, `description`));
        expect(limited).toContain(`network address`);
        expect(limited).toContain(`bot`);
        expect(limited).toContain(`game token`);
        for (const word of [`user`, `guest`, `account`]) expect(limited).not.toContain(word);
    });

    it('names no deployment, since its one server is the relative root', () => {
        expect(dig(document, `servers`)).toMatchObject([{ url: `/` }]);
    });

    it('resolves every $ref to a component the document defines', () => {
        const refs: string[] = [];
        visitObjects(document, (node) => {
            const ref: unknown = Reflect.get(node, `$ref`);
            if (typeof ref === `string`) refs.push(ref);
        });
        expect(refs).toContain(`#/components/schemas/MoveRequest`);
        for (const ref of refs) {
            expect(dig(document, ...ref.replace(`#/`, ``).split(`/`)), ref).toBeDefined();
        }
    });

    it('splices the vendored block byte for byte in place of the generated htttx schemas', () => {
        expect(rendered).toContain(vendored);
        expect(readHtttxBlock(rendered).text).toBe(vendored);
        expect(rendered.split(`    Board:\n`)).toHaveLength(2);
        expect(dig(document, `components`, `schemas`, `Stale`)).toBeUndefined();
        expect(dig(document, `info`, `description`)).toContain(`\`0123abc\``);
    });

    it('fails loudly when the target has no vendored block', () => {
        expect(() => readHtttxBlock(`openapi: 3.1.0\n`)).toThrow(/BEGIN and END markers/);
        expect(() => readHtttxBlock(vendored.replace(`END`, `FIN`))).toThrow(/BEGIN and END markers/);
    });

    it('renders the same bytes on every run', () => {
        expect(renderBotApiYaml(readHtttxBlock(source))).toBe(rendered);
        expect(renderStreamExamples()).toBe(renderStreamExamples());
    });

    it('writes one stream example per event type, each parsing as a stream event', () => {
        const lines = renderStreamExamples().split(`\n`);
        expect(lines.pop()).toBe(``);
        const types = lines.map((line) => streamEventSchema.parse(JSON.parse(line)).type);
        expect(types.sort()).toEqual(streamEventSchema.options.map((option) => option.shape.type.value).sort());
    });
});
