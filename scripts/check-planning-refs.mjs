import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Committed files carry no pointers to the untracked decision docs and no
// planning vocabulary; AGENTS.md, which states the rule, is the one
// sanctioned exception.
const excluded = new Set([`AGENTS.md`]);

// `.slice(` is a method call, not planning language, so the lookbehind
// leaves it alone.
const patterns = [
    /\b(?:spec|stack|admin|sources)\.md\b/i,
    /\bsections?\s+\d/i,
    /\bphased\b|\bphases?\b/i,
    /(?<!\.)\bslices?\b/i,
];

const tracked = execFileSync(`git`, [`ls-files`], { encoding: `utf8` })
    .split(`\n`)
    .filter((file) => file !== `` && !excluded.has(file));

const hits = [];
for (const file of tracked) {
    const lines = readFileSync(file, `utf8`).split(`\n`);
    for (const [index, line] of lines.entries()) {
        if (patterns.some((pattern) => pattern.test(line))) {
            hits.push(`${file}:${String(index + 1)}: ${line.trim()}`);
        }
    }
}

if (hits.length > 0) {
    console.error(`decision-doc or planning references in tracked files:`);
    for (const hit of hits) console.error(hit);
    process.exit(1);
}
