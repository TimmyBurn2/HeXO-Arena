import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { legalDocumentFile, legalPages } from '@hexo-arena/contract';

/**
 * Name, in one line, the legal documents the deployment's folder lacks.
 * Every document is optional: the site leaves a missing one's link out,
 * so the boot only says so and refuses nothing.
 */
export function reportLegalDocuments(dir: string, log: { warn: (message: string) => void }): void {
    const missing = legalPages.map(legalDocumentFile).filter((file) => !existsSync(join(dir, file)));
    if (missing.length > 0) log.warn(`legal documents missing from ${dir}: ${missing.join(`, `)}`);
}
