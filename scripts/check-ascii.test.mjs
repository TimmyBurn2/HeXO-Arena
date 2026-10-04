import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';

const gate = resolve(`scripts/check-ascii.mjs`);
const made = [];

// A repository holding the given files, staged.
function repository(files, links = {}) {
    const root = mkdtempSync(join(tmpdir(), `check-ascii-`));
    made.push(root);
    execFileSync(`git`, [`init`, `-q`], { cwd: root });
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(join(root, path, `..`), { recursive: true });
        writeFileSync(join(root, path), content);
    }
    for (const [path, target] of Object.entries(links)) symlinkSync(target, join(root, path));
    execFileSync(`git`, [`add`, `-A`], { cwd: root });
    return root;
}

function run(root) {
    const result = spawnSync(process.execPath, [gate], { cwd: root, encoding: `utf8` });
    return { status: result.status, report: result.stderr };
}

after(() => {
    for (const root of made) rmSync(root, { recursive: true, force: true });
});

describe(`the ASCII gate`, () => {
    it(`passes ASCII text, binary files, and a tracked link to a directory`, () => {
        const root = repository(
            { 'notes.txt': `plain\n`, 'docs/guide.md': `# Guide\n`, 'icon.bin': Buffer.from([0x00, 0xc3, 0xa9]) },
            { 'guide-link': `docs` },
        );
        assert.deepEqual(run(root), { status: 0, report: `` });
    });

    it(`names each line outside ASCII with its column, escaping what it quotes`, () => {
        const root = repository({ 'ok.txt': `fine\n`, 'bad.txt': `first\ncaf\u00e9 \u001b[31mred\n` }, { 'docs-link': `.` });
        const { status, report } = run(root);
        assert.equal(status, 1);
        assert.equal(report, `characters outside ASCII:\nbad.txt:2:4: caf\\u{e9} \\u{1b}[31mred\n`);
    });

    it(`reads a new file before it is staged, and leaves an ignored one alone`, () => {
        const root = repository({ '.gitignore': `local/\n` });
        mkdirSync(join(root, `local`));
        writeFileSync(join(root, `new.txt`), `caf\u00e9\n`);
        writeFileSync(join(root, `local/notes.txt`), `caf\u00e9\n`);
        assert.deepEqual(run(root), { status: 1, report: `characters outside ASCII:\nnew.txt:1:4: caf\\u{e9}\n` });
    });

    it(`names a file whose name is outside ASCII, and a link whose target is`, () => {
        const root = repository({ 'caf\u00e9.txt': `fine\n` }, { 'link.txt': `caf\u00e9.txt` });
        const { status, report } = run(root);
        assert.equal(status, 1);
        assert.match(report, /caf\\u\{e9\}\.txt: the file name/u);
        assert.match(report, /link\.txt: the link target caf\\u\{e9\}\.txt/u);
    });
});
