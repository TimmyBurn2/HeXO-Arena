import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDocument, renderOpenApiYaml } from '../src/openapi';

// The contract's tests hold the committed file to this output.
const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(here, '../../../openapi.yaml');
writeFileSync(outputPath, renderOpenApiYaml(buildOpenApiDocument()), 'utf8');
