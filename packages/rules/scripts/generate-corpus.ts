import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Corpus, generateTraces, planCorpus } from '../test/helpers/corpus';
import { loadOracle } from '../test/helpers/oracle';

// Local-only regeneration of the committed differential corpus against the
// HeXO oracle; never runs in CI (AGENTS.md, SPEC.md section 12). Run from
// the repo root: pnpm --filter @hexarena/rules corpus:generate
const seed = 20260925;

const oracle = await loadOracle();
if (oracle === null) {
    console.error(
        `HeXO checkout not found: set HEXO_ROOT or place the sibling at ../HeXO`,
    );
    process.exit(1);
}

const traces = generateTraces(oracle, planCorpus(), seed);
const corpus: Corpus = { format: 1, seed, traces };
const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, `../test/corpus/traces.json`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, serializeCorpus(corpus), `utf8`);

const finished = traces.filter((trace) => trace.outcome.winner !== null).length;
const moves = traces.reduce((sum, trace) => sum + trace.moves.length, 0);
console.log(
    `${String(traces.length)} traces, ${String(finished)} finished, ${String(moves)} moves -> ${outPath}`,
);

// One trace per line keeps the committed file reviewable and diffs compact.
function serializeCorpus(data: Corpus): string {
    const lines = [
        `{`,
        `  "format": ${JSON.stringify(data.format)},`,
        `  "seed": ${JSON.stringify(data.seed)},`,
        `  "traces": [`,
        data.traces.map((trace) => `    ${JSON.stringify(trace)}`).join(`,\n`),
        `  ]`,
        `}`,
    ];
    return lines.join(`\n`) + `\n`;
}
