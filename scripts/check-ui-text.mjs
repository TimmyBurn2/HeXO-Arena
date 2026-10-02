import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { findUiText } from './ui-text.mjs';

// Words on screen live in the catalog under apps/web/src/text, so a
// translation touches one place; no other module of the web app holds any.
// Paths given as arguments are checked instead of the web sources.
const root = `apps/web/src`;
const catalog = `apps/web/src/text/`;

function inCatalog(file) {
    return file.split(sep).join(`/`).includes(catalog);
}

const files = (process.argv.length > 2 ? process.argv.slice(2) : [...walk(root)].sort()).filter(
    (file) => /\.tsx?$/.test(file) && !inCatalog(file),
);
const hits = [];
for (const file of files) {
    for (const hit of findUiText(readFileSync(file, `utf8`), file)) {
        hits.push(`${file}:${String(hit.line)}:${String(hit.column)}: ${JSON.stringify(hit.text)}`);
    }
}

if (hits.length > 0) {
    console.error(`text outside the catalog in ${catalog}:`);
    for (const hit of hits) console.error(hit);
    process.exit(1);
}

function* walk(dir) {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
            yield* walk(path);
        } else {
            yield path;
        }
    }
}
