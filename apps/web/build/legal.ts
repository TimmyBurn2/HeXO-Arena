import { existsSync, readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/** The repository's legal folder: the templates, their example details, and what to fill in. */
export const legalFolder = new URL(`../../../legal/`, import.meta.url);

/** The committed details, every value a placeholder, which dev renders in place of a deployment's. */
export const exampleDetailsFile = `details.example.json`;

// The config loads before Vite can compile the workspace's packages, so
// the paths are written out here; a test holds them to the contract's.
/** What the dev server answers for each legal file the site reads: the file in the folder, and its type. */
export const legalFileRoutes: ReadonlyMap<string, { readonly file: string; readonly type: string }> = new Map([
    [`/legal/imprint.md`, { file: `imprint.md`, type: `text/markdown; charset=utf-8` }],
    [`/legal/privacy.md`, { file: `privacy.md`, type: `text/markdown; charset=utf-8` }],
    [`/legal/terms.md`, { file: `terms.md`, type: `text/markdown; charset=utf-8` }],
    [`/legal/details.json`, { file: exampleDetailsFile, type: `application/json` }],
]);

/**
 * The dev server's stand-in for a deployment's legal folder: each
 * document from the repository's templates, and the example details as
 * the details file.
 * A template removed from the folder answers 404, as a deployment
 * without it does; the file is read on each request, so an edit shows on
 * the next load.
 */
export function legalFiles(): Plugin {
    return {
        name: `hexo-arena:legal-files`,
        configureServer(server) {
            server.middlewares.use((request, response, next) => {
                const served = legalFileRoutes.get(request.url?.split(`?`)[0] ?? ``);
                if (served === undefined) {
                    next();
                    return;
                }
                const path = new URL(served.file, legalFolder);
                if (!existsSync(path)) {
                    response.statusCode = 404;
                    response.end();
                    return;
                }
                response.setHeader(`content-type`, served.type);
                response.setHeader(`cache-control`, `no-cache`);
                response.end(readFileSync(path));
            });
        },
    };
}
