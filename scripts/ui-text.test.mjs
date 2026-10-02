import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { findUiText } from './ui-text.mjs';

const texts = (source) => findUiText(source, `sample.tsx`).map((hit) => hit.text);

describe(`findUiText`, () => {
    it(`flags words written as JSX text`, () => {
        assert.deepEqual(texts(`const a = <p>Try again</p>;`), [`Try again`]);
    });

    it(`flags words in a text attribute, written out or chosen in an expression`, () => {
        assert.deepEqual(texts(`const a = <a title="Home" aria-label={open ? 'Close' : 'Open'} />;`), [`Home`, `Close`, `Open`]);
        assert.deepEqual(texts(`const a = <Frame sentence="It did not load" closeLabel={\`Close \${name}\`} />;`), [
            `It did not load`,
            `Close`,
        ]);
    });

    it(`flags the words a child expression renders`, () => {
        assert.deepEqual(texts(`const a = <b>{done ? \`Copied\` : \`Copy\`}{count && \`\${count} stones\`}</b>;`), [
            `Copied`,
            `Copy`,
            `stones`,
        ]);
    });

    it(`flags words joined with +, listed in an array, or cast`, () => {
        assert.deepEqual(texts(`const a = <b>{'Hello, ' + name}{['One', 'Two']}{('Save' as string)}{label!}</b>;`), [
            `Hello,`,
            `One`,
            `Two`,
            `Save`,
        ]);
    });

    it(`flags the words inside a template's own expressions`, () => {
        assert.deepEqual(texts(`const a = <b>{\`\${ready ? 'go now' : 'wait'}!\`}</b>;`), [`go now`, `wait`]);
    });

    it(`flags labels in a table of pairs, wherever the table goes`, () => {
        assert.deepEqual(texts(`const facts = [['Clock', clock], ['Opening', opening]]; facts.map((pair) => pair);`), [`Clock`, `Opening`]);
    });

    it(`flags each text-bearing name the gate knows, as a prop, a key, or a spoken value`, () => {
        assert.deepEqual(
            texts(`const a = <Row credit="a" author="b" copyright="c" emptyLabel="d" aria-valuetext={\`\${n} e\`} />;`),
            [`a`, `b`, `c`, `d`, `e`],
        );
    });

    it(`flags words in a tagged template and in the children of createElement`, () => {
        assert.deepEqual(texts(`const a = rich\`save the game\`; const b = createElement('p', null, 'load it again');`), [
            `save the game`,
            `load it again`,
        ]);
    });

    it(`flags a string constant of the same file once JSX renders it`, () => {
        assert.deepEqual(texts(`const label = 'save'; const a = <b>{label}</b>;`), [`save`]);
    });

    it(`flags text props of any name that carries words, a spread one included`, () => {
        assert.deepEqual(
            texts(`const a = <Card caption="a" message="b" hint="c" summary="d" legend="e" children="f" emptyText="g" {...{ 'aria-label': 'h' }} />;`),
            [`a`, `b`, `c`, `d`, `e`, `f`, `g`, `h`],
        );
    });

    it(`flags a component prop or a sometimes-shown attribute that reads as words, but not an id, a path, or geometry`, () => {
        assert.deepEqual(
            texts(`const a = <Tile tone="warn" name="ArrowUp" to="/bots/SealBot" d="M0 0 L10 10" className="Big card" badge="New arrival" status="Live" />;`),
            [`New arrival`, `Live`],
        );
        assert.deepEqual(texts(`const a = <form><input value="Send it" defaultValue="Your name" /><input type="radio" value="ink" /><meta content="Play online" /></form>;`), [
            `Send it`,
            `Your name`,
            `Play online`,
        ]);
    });

    it(`flags label tables, shown state, and text defaults`, () => {
        assert.deepEqual(texts(`const nav = [{ id: 'a', label: 'ladder' }, { id: 'b', name: 'Moves' }];`), [`ladder`, `Moves`]);
        assert.deepEqual(texts(`setFailure('did not load'); setNote(\`Sent\`); setStatus('ready'); setCount(3);`), [`did not load`, `Sent`]);
        assert.deepEqual(texts(`function Frame({ heading = 'not found', size = 'large' }) {}`), [`not found`]);
    });

    it(`flags words a function returns, an object holds, or a call is given, even in a handler`, () => {
        assert.deepEqual(texts(`function note(k) { if (k) return 'Bot'; return \`no clock\`; }`), [`Bot`, `no clock`]);
        assert.deepEqual(texts(`const words = { timeout: 'on time', kind: 'bot' }; const f = () => 'game over';`), [`on time`, `game over`]);
        assert.deepEqual(texts(`const [note] = useState('not sent yet'); document.querySelector('.a b'); el.setAttribute('data-x', 'a b');`), [`not sent yet`]);
        assert.deepEqual(texts(`const a = <button onClick={() => { show('saved it'); window.alert('stop that now'); }} />;`), [`saved it`, `stop that now`]);
    });

    it(`flags a literal shaped like a sentence wherever it sits`, () => {
        assert.deepEqual(texts(`let s; s = 'The game is over';`), [`The game is over`]);
        assert.deepEqual(texts(`let s; s = \`Too far from every stone\`;`), [`Too far from every stone`]);
        assert.deepEqual(texts(`let s; s = 'Sign-out did not go through'; s = 'MIT text applies';`), [`Sign-out did not go through`, `MIT text applies`]);
    });

    it(`leaves developer messages, module paths, class lists, and marked lines alone`, () => {
        const clean = [
            `import { a } from 'Some module here';`,
            `throw new Error('Missing root element');`,
            `throw 'Something broke here';`,
            `const e = new DOMException('The fetch was aborted');`,
            `console.warn('The socket closed'); logger.info('Game started now'); assert('Values must match here');`,
            `const shape = { className: 'btn btn-ghost', selector: '.a b', fontFamily: 'Chakra Petch' };`,
            `const a = <b>{'Save' && value}</b>;`,
            `// not ui text: a protocol word\nconst id = 'Game over now';`,
            `const id = 'Game over now'; // not ui text: a protocol word`,
        ];
        for (const source of clean) assert.deepEqual(texts(source), [], source);
        assert.deepEqual(texts(`const id = 'Game over now';`), [`Game over now`]);
    });

    it(`lets punctuation, whitespace, numbers, and strings that never render stay`, () => {
        const clean = [
            `const a = <p className="note btn">{' '}, 12 ? / +{\`\${name},\`}</p>;`,
            `const a = <b>{kind === 'bot' ? <Badge /> : null}{list.join(', ')}</b>;`,
            `const a = <a href="/credits" role="tab" aria-labelledby="title" type="button">{label}</a>;`,
            `setMeta('property', 'og:title', title);`,
        ];
        for (const source of clean) assert.deepEqual(texts(source), [], source);
    });
});

describe(`check-ui-text`, () => {
    function run(files) {
        const dir = mkdtempSync(join(tmpdir(), `ui-text-`));
        try {
            const paths = Object.entries(files).map(([name, source]) => {
                const path = join(dir, name);
                mkdirSync(dirname(path), { recursive: true });
                writeFileSync(path, source);
                return path;
            });
            return spawnSync(process.execPath, [`scripts/check-ui-text.mjs`, ...paths], { encoding: `utf8` });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }

    it(`fails on a sample literal in a component or a module and names where it is`, () => {
        const result = run({
            'Sample.tsx': `export function Sample() {\n    return <button>Save</button>;\n}\n`,
            'words.ts': `export const note = 'The game is over';\n`,
        });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Sample\.tsx:2:\d+: "Save"/);
        assert.match(result.stderr, /words\.ts:1:\d+: "The game is over"/);
    });

    it(`passes a sample that reads its words from the catalog, and the catalog itself`, () => {
        const result = run({
            'Sample.tsx': `export function Sample() {\n    return <button>{text.save}</button>;\n}\n`,
            'apps/web/src/text/en.ts': `export const en = { save: 'Save the game' };\n`,
        });
        assert.equal(result.status, 0, result.stderr);
    });
});
