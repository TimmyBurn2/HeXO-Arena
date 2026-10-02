import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDocument, renderOpenApiYaml } from '../src/openapi';

// CI regenerates and diffs (AGENTS.md).
const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(here, '../../../openapi.yaml');
writeFileSync(outputPath, renderOpenApiYaml(buildOpenApiDocument()), 'utf8');
