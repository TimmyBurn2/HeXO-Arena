import { describe, expect, it, vi } from 'vitest';
import { analysisPositionsPath, undeclaredValues } from '@hexo-arena/contract';
import { authorSourceId, botSource, botSourceId, readingLineOf, type AnalysisPosition, type SourceEvent } from '../src/analysis/sources';

const position: AnalysisPosition = { cells: [{ x: 0, y: 0, side: `x` }], toMove: `o` };
const kestrel = { name: `kestrel`, version: `0.9`, ownerName: `tom`, values: undeclaredValues };
const done = {
    status: `done`,
    analyzer: kestrel,
    seconds: 2,
    elapsedMs: 1830,
    readAt: `2026-10-02T10:00:00Z`,
    cached: false,
    lines: [
        { cells: [{ x: 1, y: -1 }, { x: 0, y: -1 }], heuristic: -0.12 },
        { cells: [{ x: 1, y: 0 }, { x: -1, y: 1 }], winIn: -3 },
    ],
    left: 211,
};

function answer(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': `application/json`, ...headers } });
}

// A fetch that hands out its answers in order and records each request.
function answering(...answers: (Response | Error)[]) {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const fetcher: typeof fetch = (url, init) => {
        requests.push({ url: url instanceof URL ? url.href : typeof url === `string` ? url : url.url, init });
        const next = answers.shift();
        if (next === undefined) throw new Error(`no answer left`);
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    };
    return { fetcher, requests };
}

function bodyOf(request: { init: RequestInit | undefined } | undefined): unknown {
    const body = request?.init?.body;
    return typeof body === `string` ? JSON.parse(body) : null;
}

async function events(source: ReturnType<typeof botSource>, signal = new AbortController().signal): Promise<SourceEvent[]> {
    const seen: SourceEvent[] = [];
    for await (const event of source.read(position, { lines: 3, seconds: 2 }, signal)) seen.push(event);
    return seen;
}

describe('a community analyzer as a source', () => {
    it('posts the position with the analyzer, lines, and seconds, and reads the answer in htttx shapes', async () => {
        const { fetcher, requests } = answering(answer(200, done));
        const onLeft = vi.fn();
        const source = botSource({ analyzer: `kestrel`, label: `kestrel`, onLeft, fetcher });
        expect(source).toMatchObject({ id: `bot:kestrel`, runs: `on-ask` });
        expect(await events(source)).toEqual([
            { kind: `thinking` },
            {
                kind: `reading`,
                reading: {
                    by: { kind: `bot`, name: `kestrel`, version: `0.9`, ownerName: `tom` },
                    // The values the analyzer declared when it read come with its reading.
                    values: undeclaredValues,
                    lines: [
                        { cells: [{ x: 1, y: -1 }, { x: 0, y: -1 }], evaluation: { heuristic: -0.12 } },
                        { cells: [{ x: 1, y: 0 }, { x: -1, y: 1 }], evaluation: { win_in: -3 } },
                    ],
                    seconds: 2,
                    final: true,
                    elapsedMs: 1830,
                },
            },
        ]);
        expect(requests[0]?.url).toBe(analysisPositionsPath);
        expect(requests[0]?.init?.method).toBe(`POST`);
        expect(bodyOf(requests[0])).toEqual({ cells: position.cells, toMove: `o`, analyzer: `kestrel`, lines: 3, seconds: 2 });
        expect(onLeft).toHaveBeenCalledWith(211);
    });

    it('reads a kept reading as one that cost nothing', async () => {
        const { fetcher } = answering(answer(200, { ...done, cached: true }));
        const seen = await events(botSource({ analyzer: null, label: `Any`, fetcher }));
        expect(seen.at(-1)).toMatchObject({ kind: `reading`, reading: { elapsedMs: null } });
    });

    it('asks any free analyzer when none is named', async () => {
        const { fetcher, requests } = answering(answer(200, done));
        const source = botSource({ analyzer: null, label: `Any`, fetcher });
        expect(source.id).toBe(`bot:*`);
        await events(source);
        expect(bodyOf(requests[0])).toMatchObject({ analyzer: null });
    });

    it('posts again while the position waits its turn, and says how many wait ahead and for whom once one is chosen', async () => {
        const { fetcher, requests } = answering(
            answer(200, { status: `queued`, ahead: 2, left: 212 }),
            answer(200, { status: `queued`, ahead: 1, analyzer: kestrel, left: 212 }),
            answer(200, done),
        );
        let clock = 0;
        const source = botSource({
            analyzer: `kestrel`,
            label: `kestrel`,
            fetcher,
            // The held request answers queued after its full hold.
            now: () => (clock += 10_000),
        });
        const seen = await events(source);
        expect(seen.map((event) => event.kind)).toEqual([`thinking`, `queued`, `queued`, `reading`]);
        expect(seen[1]).toEqual({ kind: `queued`, ahead: 2, by: null });
        expect(seen[2]).toEqual({ kind: `queued`, ahead: 1, by: { kind: `bot`, name: `kestrel`, version: `0.9`, ownerName: `tom` } });
        expect(requests).toHaveLength(3);
        expect(requests[2]?.init?.body).toBe(requests[0]?.init?.body);
    });

    it('names the analyzer and the reason when a reading fails', async () => {
        const { fetcher } = answering(answer(200, { status: `failed`, analyzer: kestrel, failure: `timeout`, left: 212 }));
        const seen = await events(botSource({ analyzer: `kestrel`, label: `kestrel`, fetcher }));
        expect(seen.at(-1)).toEqual({ kind: `failed`, code: `timeout`, by: { kind: `bot`, name: `kestrel`, version: `0.9`, ownerName: `tom` } });
    });

    it('reads each refusal by its code, with the wait the server names', async () => {
        const cases: [Response | Error, SourceEvent][] = [
            [answer(409, { error: `live`, code: `live_position` }), { kind: `refused`, code: `live_position`, retryAfter: null }],
            [answer(409, { error: `seated`, code: `seated` }), { kind: `refused`, code: `seated`, retryAfter: null }],
            [answer(409, { error: `none`, code: `no_analyzer` }), { kind: `refused`, code: `no_analyzer`, retryAfter: null }],
            [answer(401, { error: `no session`, code: `unauthorized` }), { kind: `refused`, code: `signed_out`, retryAfter: null }],
            [answer(429, { error: `spent`, code: `analysis_limit` }, { 'retry-after': `3600` }), { kind: `refused`, code: `analysis_limit`, retryAfter: 3600 }],
            [answer(429, { error: `full`, code: `analysis_busy` }, { 'retry-after': `10` }), { kind: `refused`, code: `analysis_busy`, retryAfter: 10 }],
            [answer(429, { error: `slow down`, code: `rate_limited` }, { 'retry-after': `2` }), { kind: `refused`, code: `rate_limited`, retryAfter: 2 }],
            [answer(409, { error: `replaced`, code: `superseded` }), { kind: `refused`, code: `unavailable`, retryAfter: null }],
            [answer(503, { error: `paused`, code: `paused` }), { kind: `refused`, code: `unavailable`, retryAfter: null }],
            [answer(200, { status: `nonsense` }), { kind: `refused`, code: `unavailable`, retryAfter: null }],
            [new TypeError(`network`), { kind: `refused`, code: `unavailable`, retryAfter: null }],
        ];
        for (const [response, expected] of cases) {
            const { fetcher } = answering(response);
            expect((await events(botSource({ analyzer: `kestrel`, label: `kestrel`, fetcher }))).at(-1), JSON.stringify(expected)).toEqual(expected);
        }
    });

    it('sends nothing for a position the site would refuse to read', async () => {
        const { fetcher, requests } = answering();
        const source = botSource({ analyzer: `kestrel`, label: `kestrel`, fetcher });
        const seen: SourceEvent[] = [];
        for await (const event of source.read({ cells: [], toMove: `x` }, { lines: 1, seconds: 2 }, new AbortController().signal)) seen.push(event);
        expect(seen).toEqual([{ kind: `refused`, code: `unavailable`, retryAfter: null }]);
        expect(requests).toHaveLength(0);
    });

    it('ends without a word once aborted', async () => {
        const controller = new AbortController();
        const fetcher: typeof fetch = (_url, init) => {
            controller.abort();
            expect(init?.signal?.aborted).toBe(true);
            return Promise.reject(new DOMException(`aborted`, `AbortError`));
        };
        const seen = await events(botSource({ analyzer: `kestrel`, label: `kestrel`, fetcher }), controller.signal);
        expect(seen).toEqual([{ kind: `thinking` }]);
    });
});

describe('source ids', () => {
    it('name a bot by its name, any free one by a star, and a reading by its bot', () => {
        expect(botSourceId(`kestrel`)).toBe(`bot:kestrel`);
        expect(botSourceId(null)).toBe(`bot:*`);
        expect(
            authorSourceId({ by: { kind: `own`, name: `hextide`, side: `x` }, values: undeclaredValues, lines: [], seconds: 2, final: true, elapsedMs: null }),
        ).toBeNull();
        expect(
            authorSourceId({ by: { kind: `bot`, name: `driftwood`, version: null, ownerName: null }, values: undeclaredValues, lines: [], seconds: 2, final: true, elapsedMs: null }),
        ).toBe(`bot:driftwood`);
    });

    it('read a line with a heuristic and a forced win both', () => {
        expect(readingLineOf({ cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }], heuristic: 0.9, winIn: 5 })).toEqual({
            cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }],
            evaluation: { heuristic: 0.9, win_in: 5 },
        });
    });
});
