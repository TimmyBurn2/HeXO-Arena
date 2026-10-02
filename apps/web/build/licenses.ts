import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin } from 'vite';

/** Where the site serves the licenses of the code and the font it ships. */
export const licenseFileName = `third-party-licenses.txt`;

const webPackage = new URL(`../package.json`, import.meta.url);
const fontLicense = new URL(`../public/fonts/chakra-petch-OFL.txt`, import.meta.url);
const octiconsLicense = new URL(`./octicons-LICENSE.txt`, import.meta.url);

// The font is a static file outside the bundle, and GitHub's mark a path
// copied into the code, so Vite's list of bundled packages lacks both;
// their licenses close the file.
function fontSection(): string {
    return (
        `\n## Chakra Petch (OFL-1.1)\n\nThe wordmark font, a subset served from /fonts/.\n\n${readFileSync(fontLicense, `utf8`).trim()}\n` +
        `\n## Octicons mark-github (MIT)\n\nGitHub's mark beside the Source link, from @primer/octicons.\n\n${readFileSync(octiconsLicense, `utf8`).trim()}\n`
    );
}

interface PackageManifest {
    name: string;
    version?: string;
    license?: string;
    dependencies?: Record<string, string>;
}

// Parsed where it is read: a package.json is JSON by definition, and only
// these four fields are used.
function manifestAt(path: string): PackageManifest {
    return JSON.parse(readFileSync(path, `utf8`)) as PackageManifest;
}

/**
 * The file as the build writes it, for the dev server, which has no bundle
 * to read: every package the app's runtime dependencies reach, the
 * workspace's own left out, in Vite's layout and order, then the font.
 * A build test holds the two equal.
 */
export function licenseText(): string {
    const found = new Map<string, { name: string; version: string; license?: string; text?: string }>();
    const visit = (from: string, dependencies: Record<string, string> = {}): void => {
        for (const name of Object.keys(dependencies)) {
            const manifestPath = findPackageJSON(name, pathToFileURL(from));
            if (manifestPath === undefined) continue;
            const real = realpathSync(manifestPath);
            const manifest = manifestAt(real);
            const own = !real.split(`/`).includes(`node_modules`);
            const key = `${manifest.name}@${manifest.version ?? `0.0.0`}`;
            if (!own && found.has(key)) continue;
            if (!own) {
                const dir = dirname(real);
                const file = readdirSync(dir).find((entry) => /^licen[cs]e|^copying/i.test(entry));
                found.set(key, {
                    name: manifest.name,
                    version: manifest.version ?? `0.0.0`,
                    ...(manifest.license === undefined ? {} : { license: manifest.license.trim() }),
                    ...(file === undefined ? {} : { text: readFileSync(join(dir, file), `utf8`).trim() }),
                });
            }
            visit(real, manifest.dependencies);
        }
    };
    const web = realpathSync(webPackage);
    visit(web, manifestAt(web).dependencies);
    let text = `# Licenses\n\nThe app bundles dependencies which contain the following licenses:\n`;
    for (const key of [...found.keys()].sort()) {
        const entry = found.get(key);
        if (entry === undefined) continue;
        text += `\n## ${entry.name} - ${entry.version}${entry.license === undefined ? `` : ` (${entry.license})`}\n`;
        if (entry.text !== undefined) text += `\n${entry.text}\n`;
    }
    return `${text}${fontSection()}`;
}

/**
 * Ships the third-party licenses with the site: Vite's `build.license`
 * writes the bundled packages, this adds the font, and the dev server
 * answers the same path with the same text.
 */
export function thirdPartyLicenses(): Plugin {
    return {
        name: `hexo-arena:third-party-licenses`,
        generateBundle: {
            order: `post`,
            handler(_options, bundle) {
                const file = bundle[licenseFileName];
                if (file?.type !== `asset`) {
                    this.error(`build.license wrote no ${licenseFileName}`);
                }
                file.source = `${String(file.source)}${fontSection()}`;
            },
        },
        configureServer(server) {
            server.middlewares.use(`/${licenseFileName}`, (_request, response) => {
                response.setHeader(`content-type`, `text/plain; charset=utf-8`);
                response.end(licenseText());
            });
        },
    };
}
