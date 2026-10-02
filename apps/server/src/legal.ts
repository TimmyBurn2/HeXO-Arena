import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { legalDetailsFaults, legalDetailsFile, legalDocumentFile, legalPages } from '@hexo-arena/contract';

/**
 * Name, in one line each, the legal documents the deployment's folder
 * lacks and a details file that is missing or does not hold.
 * Every document is optional: the site leaves a missing one's link out,
 * and one naming a detail without valid details, so the boot only says so
 * and refuses nothing.
 * A development server passes the repository's example details, which its
 * web server serves in their place.
 */
export function reportLegalDocuments(dir: string, log: { warn: (message: string) => void }, detailsFile = legalDetailsFile): void {
    const missing = legalPages.map(legalDocumentFile).filter((file) => !existsSync(join(dir, file)));
    if (missing.length > 0) log.warn(`legal documents missing from ${dir}: ${missing.join(`, `)}`);
    if (missing.length === legalPages.length) return;
    const consequence = `the documents naming a detail stay off the site`;
    const path = join(dir, detailsFile);
    if (!existsSync(path)) {
        log.warn(`legal details missing from ${dir}: ${detailsFile}; ${consequence}`);
        return;
    }
    let json: unknown;
    try {
        json = JSON.parse(readFileSync(path, `utf8`));
    } catch {
        log.warn(`legal details in ${path} are not JSON; ${consequence}`);
        return;
    }
    const faults = legalDetailsFaults(json);
    if (faults.length > 0) log.warn(`legal details in ${path} do not match at ${faults.join(`, `)}; ${consequence}`);
}
