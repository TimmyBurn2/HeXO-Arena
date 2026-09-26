import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readHtttxBlock, renderBotApiYaml, renderStreamExamples } from '../src/bot-api';

// pnpm runs a package script in its package directory; a path argument
// resolves from where the command was typed.
const here = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(here, '../../..');
const target = resolve(process.env['INIT_CWD'] ?? workspace, process.argv[2] ?? join(workspace, '../Hexo-Bot-Api'));
const specPath = join(target, 'openapi.yaml');
const htttx = readHtttxBlock(readFileSync(specPath, 'utf8'));
writeFileSync(specPath, renderBotApiYaml(htttx), 'utf8');
mkdirSync(join(target, 'examples'), { recursive: true });
writeFileSync(join(target, 'examples/stream.ndjson'), renderStreamExamples(), 'utf8');
console.log(`wrote ${specPath} and examples/stream.ndjson`);
