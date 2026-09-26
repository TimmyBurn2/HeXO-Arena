import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { buildOpenApiDocument } from '../src/openapi';

// Sorted keys keep the committed file byte-stable across regenerations;
// CI regenerates and diffs (AGENTS.md).
// A repeated object, such as a shared $ref, is written out in full rather
// than as a yaml alias.
const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(here, '../../../openapi.yaml');
const document = stringify(buildOpenApiDocument(), {
    sortMapEntries: true,
    lineWidth: 100,
    aliasDuplicateObjects: false,
});
writeFileSync(outputPath, document, 'utf8');
