import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';

const gate = resolve(`scripts/check-ui-literals.mjs`);
const made = [];

const scale = `:root {\n    --dur-fast: 120ms;\n    --dur-slow: 180ms;\n}\n@media (prefers-reduced-motion: reduce) {\n    :root {\n        --dur-fast: 0s;\n        --dur-slow: 0s;\n    }\n}\n`;

// A repository holding the web sources given, beside a scale sheet unless
// one is given; `staged` names the files added to the index, the rest left
// untracked.
function repository(files, staged = Object.keys(files)) {
    const root = mkdtempSync(join(tmpdir(), `check-ui-literals-`));
    made.push(root);
    execFileSync(`git`, [`init`, `-q`], { cwd: root });
    for (const [path, content] of Object.entries({ 'apps/web/src/styles/scale.css': scale, ...files })) {
        mkdirSync(join(root, path, `..`), { recursive: true });
        writeFileSync(join(root, path), content);
    }
    execFileSync(`git`, [`add`, `apps/web/src/styles/scale.css`, ...staged], { cwd: root });
    return root;
}

function run(root) {
    const result = spawnSync(process.execPath, [gate], { cwd: root, encoding: `utf8` });
    return { status: result.status, report: result.stderr };
}

after(() => {
    for (const root of made) rmSync(root, { recursive: true, force: true });
});

describe(`the literal gate's motion rule`, () => {
    it(`passes durations taken from the scale's tokens, zero durations, and an animation turned off`, () => {
        const root = repository({
            'apps/web/src/Card.css': `.card {\n    transition:\n        background var(--dur-fast) var(--ease),\n        color var(--dur-slow) var(--ease);\n    animation: fade-in var(--dur-fast) var(--ease) var(--dur-fast) both;\n}\n.quiet {\n    transition-duration: 0s;\n    animation: none;\n}\n`,
        });
        assert.deepEqual(run(root), { status: 0, report: `` });
    });

    it(`names a literal or computed duration outside the scale, a declaration across lines included`, () => {
        const root = repository({
            'apps/web/src/Card.css': `.card {\n    transition:\n        background 200ms ease;\n}\n.drop {\n    animation-duration: calc(var(--dur-slow) * 2);\n}\n`,
        });
        const { status, report } = run(root);
        assert.equal(status, 1);
        assert.match(report, /apps\/web\/src\/Card\.css:2: duration outside the scale: transition: background 200ms ease;/u);
        assert.match(report, /apps\/web\/src\/Card\.css:6: duration outside the scale: animation-duration: calc\(var\(--dur-slow\) \* 2\);/u);
    });

    it(`names a duration token outside the motion band`, () => {
        const root = repository({ 'apps/web/src/styles/scale.css': scale.replace(`180ms`, `400ms`) });
        const { status, report } = run(root);
        assert.equal(status, 1);
        assert.match(report, /--dur-slow outside the motion band of 120 to 180 ms/u);
    });

    it(`names motion set from script: an inline duration and the Web Animations API`, () => {
        const root = repository({
            'apps/web/src/Sheet.tsx': `export const style = { transition: 'transform 300ms ease' };\nexport function drop(element: Element) {\n    element.animate([{ opacity: 0 }, { opacity: 1 }], 160);\n}\n`,
        });
        const { status, report } = run(root);
        assert.equal(status, 1);
        assert.match(report, /apps\/web\/src\/Sheet\.tsx:1: motion set from script/u);
        assert.match(report, /apps\/web\/src\/Sheet\.tsx:3: motion set from script/u);
    });

    it(`reads a new file before it is staged`, () => {
        const root = repository({ 'apps/web/src/New.css': `.new {\n    transition: color 1s;\n}\n` }, []);
        const { status, report } = run(root);
        assert.equal(status, 1);
        assert.match(report, /apps\/web\/src\/New\.css:2: duration outside the scale/u);
    });
});
