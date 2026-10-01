import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { botApiVersion } from './index';
import { botSurfaceDefinitions, renderOpenApiYaml } from './openapi';
import { streamEventSchema, type StreamEvent } from './stream';

const htttxBegin = `# --- BEGIN vendored htttx ---`;
const htttxEnd = `# --- END vendored htttx ---`;

/**
 * The vendored htttx schemas as the target document holds them.
 */
export interface HtttxBlock {
    /** The block's lines, both markers included, byte for byte. */
    readonly text: string;
    /** The pinned htttx-bot-api commit the block names. */
    readonly commit: string;
    /** The schema names the block defines. */
    readonly schemaNames: readonly string[];
}

/**
 * Cuts the vendored htttx block out of an existing openapi.yaml.
 *
 * @throws When either marker or the pinned commit is missing.
 */
export function readHtttxBlock(spec: string): HtttxBlock {
    const lines = spec.split(`\n`);
    const begin = lines.findIndex((line) => line.trim() === htttxBegin);
    const end = lines.findIndex((line, index) => index > begin && line.trim() === htttxEnd);
    if (begin === -1 || end === -1) {
        throw new Error(`the target openapi.yaml has no vendored htttx block between its BEGIN and END markers`);
    }
    const text = `${lines.slice(begin, end + 1).join(`\n`)}\n`;
    const commit = /htttx-bot-api@([0-9a-f]{7,40})/.exec(text)?.[1];
    if (commit === undefined) throw new Error(`the vendored htttx block names no htttx-bot-api commit`);
    // The block continues the components.schemas map, so its schema names
    // sit at that map's four-space indent.
    const schemaNames = [...text.matchAll(/^ {4}([A-Za-z]\w*):\s*$/gm)].flatMap((match) => match[1] ?? []);
    return { text, commit, schemaNames };
}

const tags = [
    { name: `Directory`, description: `The public bot roster.` },
    { name: `Stream`, description: `The one NDJSON event stream a bot holds open, and its availability.` },
    { name: `Account`, description: `The bot's identity, rating, and declaration.` },
    { name: `Engine session`, description: `The per-game websocket a bot plays on, and resigning.` },
    { name: `Challenge`, description: `Creating, accepting, declining, and canceling challenges.` },
];

function infoDescription(commit: string) {
    return [
        [`A bot authenticates with its token, holds one NDJSON stream open, and plays each game on the engine session that gameStart hands out.`],
        [
            `Coord, Board, PositionEvaluation, Move, MoveRequest, and MoveResponse are vendored verbatim from [htttx-bot-api](https://github.com/hex-tic-tac-toe/htttx-bot-api) at commit \`${commit}\`, whose basic_websocket v1-alpha the engine session speaks.`,
            `Coordinates are axial q,r: +q right, +r top-right.`,
        ],
    ]
        .map((paragraph) => paragraph.join(` `))
        .join(`\n\n`);
}

type Components = Record<string, Record<string, unknown> | undefined>;

function refsIn(value: unknown, into: Set<string>): Set<string> {
    if (typeof value !== `object` || value === null) return into;
    const ref: unknown = Reflect.get(value, `$ref`);
    if (typeof ref === `string`) into.add(ref);
    Object.values(value).forEach((child: unknown) => refsIn(child, into));
    return into;
}

// The bot surface shares its registry helpers with the site, so components
// only the site uses are dropped here rather than never registered.
function pruneUnreferenced(components: Components, roots: unknown) {
    const kept = new Set<string>();
    const pending = [...refsIn(roots, new Set())];
    for (let ref = pending.pop(); ref !== undefined; ref = pending.pop()) {
        if (kept.has(ref)) continue;
        kept.add(ref);
        const [, , kind = ``, name = ``] = ref.split(`/`);
        pending.push(...refsIn(components[kind]?.[name], new Set()));
    }
    for (const [kind, entries] of Object.entries(components)) {
        if (kind === `securitySchemes` || entries === undefined) continue;
        for (const name of Object.keys(entries)) {
            if (!kept.has(`#/components/${kind}/${name}`)) Reflect.deleteProperty(entries, name);
        }
    }
}

/**
 * The bot surface as its own OpenAPI 3.1 document, without the schemas the
 * vendored htttx block defines; references to them stay in place.
 */
export function buildBotApiDocument(htttx: HtttxBlock) {
    const document = new OpenApiGeneratorV31(botSurfaceDefinitions()).generateDocument({
        openapi: `3.1.0`,
        info: {
            title: `HeXO Bot API`,
            version: botApiVersion,
            description: infoDescription(htttx.commit),
            license: { name: `MIT`, identifier: `MIT` },
        },
        servers: [
            {
                url: `/`,
                description: `The origin of whichever deployment serves this contract.`,
            },
        ],
        tags,
    });
    // The generator's component maps are typed loosely; each is a plain
    // object keyed by component name.
    const components = (document.components ?? {}) as Components;
    for (const name of htttx.schemaNames) Reflect.deleteProperty(components[`schemas`] ?? {}, name);
    pruneUnreferenced(components, { ...document, components: undefined });
    return document;
}

/**
 * Renders the bot document with the vendored htttx block spliced in verbatim
 * at the end of components.schemas.
 */
export function renderBotApiYaml(htttx: HtttxBlock) {
    const lines = renderOpenApiYaml(buildBotApiDocument(htttx)).split(`\n`);
    const schemas = lines.indexOf(`  schemas:`);
    if (schemas === -1) throw new Error(`the bot document has no components.schemas to splice into`);
    const after = lines.findIndex((line, index) => index > schemas && line !== `` && !line.startsWith(`    `));
    const at = after === -1 ? lines.length : after;
    const block = htttx.text.replace(/\n$/, ``).split(`\n`);
    return [...lines.slice(0, at), ...block, ...lines.slice(at)].join(`\n`);
}

const alice = { name: `alice-bot`, rating: 1532, provisional: false };
const kraken = { name: `KrakenBot`, rating: 1500, provisional: true };
const challenge = {
    challengeId: `c_aXbY12`,
    challenger: kraken,
    destUser: alice,
    timeControl: { mode: `match`, mainTimeMs: 300_000, incrementMs: 2_000 },
    openingPlies: 5,
    firstPlayer: `random`,
} as const;

/**
 * One example line per stream event type, in the order a bot meets them.
 */
export const streamExamples: readonly StreamEvent[] = [
    {
        type: `gameStart`,
        gameId: `g_7Qm2Kx`,
        side: `o`,
        opponent: kraken,
        timeControl: { mode: `turn`, turnTimeMs: 45_000 },
        openingPlies: 5,
        rated: true,
        engine: { socketUrl: `/api/bot/game/g_7Qm2Kx/socket`, token: `hgs_3nV8qLw0cR` },
    },
    {
        type: `moveRequest`,
        gameId: `g_7Qm2Kx`,
        request: {
            board: {
                to_move: `o`,
                cells: [
                    { q: 0, r: 0, p: `x` },
                    { q: 1, r: 0, p: `o` },
                    { q: 0, r: 1, p: `o` },
                    { q: -1, r: 2, p: `x` },
                    { q: 2, r: -1, p: `x` },
                ],
            },
            time_limit: 45,
            request_id: 0,
        },
    },
    { type: `gameFinish`, gameId: `g_7Qm2Kx`, winner: `o`, reason: `six-in-a-row` },
    { type: `challenge`, challenge: { ...challenge, status: `created` } },
    { type: `challengeDeclined`, challenge: { ...challenge, status: `declined` } },
    {
        type: `challengeCanceled`,
        reason: `expired`,
        challenge: { ...challenge, challengeId: `c_9dEf34`, status: `expired` },
    },
];

/**
 * examples/stream.ndjson: each example parsed by the stream schema, one per line.
 */
export function renderStreamExamples() {
    return streamExamples.map((event) => `${JSON.stringify(streamEventSchema.parse(event))}\n`).join(``);
}
