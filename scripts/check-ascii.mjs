import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';

// Committed text is ASCII only: code, comments, docs, and tests alike.
// A character outside it is written as an escape.
// A file holding a NUL byte is binary and left alone.
// New files count before they are staged, so a local run sees what a commit would carry.
const files = execFileSync(`git`, [`ls-files`, `-z`, `--cached`, `--others`, `--exclude-standard`], { encoding: `utf8` })
    .split(`\0`)
    .filter((file) => file !== ``);

// The report escapes what it quotes past printable ASCII,
// so neither a bidirectional control nor a terminal escape in a hit can act on the report.
const printable = (code) => code >= 0x20 && code <= 0x7e;
const escaped = (text) =>
    [...text].map((char) => (printable(char.codePointAt(0) ?? 0) ? char : `\\u{${(char.codePointAt(0) ?? 0).toString(16)}}`)).join(``);
const outside = (text) => [...text].findIndex((char) => (char.codePointAt(0) ?? 0) > 0x7f);

const hits = [];
for (const file of files) {
    if (outside(file) !== -1) hits.push(`${escaped(file)}: the file name`);
    // Git keeps a link as the path it points to, so that path is its text;
    // a file deleted but not yet staged has nothing to read.
    const entry = lstatSync(file, { throwIfNoEntry: false });
    if (entry?.isSymbolicLink() ?? false) {
        const target = readlinkSync(file);
        if (outside(target) !== -1) hits.push(`${escaped(file)}: the link target ${escaped(target)}`);
        continue;
    }
    if (!(entry?.isFile() ?? false)) continue;
    const bytes = readFileSync(file);
    if (bytes.includes(0)) continue;
    const lines = bytes.toString(`utf8`).split(`\n`);
    for (const [index, line] of lines.entries()) {
        const column = outside(line);
        if (column !== -1) hits.push(`${escaped(file)}:${String(index + 1)}:${String(column + 1)}: ${escaped(line.trim().slice(0, 80))}`);
    }
}

if (hits.length > 0) {
    console.error(`characters outside ASCII:`);
    for (const hit of hits) console.error(hit);
    process.exit(1);
}
