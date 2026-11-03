import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL, fileURLToPath } from 'node:url';

// The mantis engine that runs in the visitor's browser, from one GitHub release pinned by its sha256, never from npm.
// The site serves it from its own origin; apps/web/src/analysis/mantis.ts names the same folder.
const version = `0.1.0`;
const url = `https://github.com/TimmyBurn2/hexo-mantis/releases/download/web-v${version}/hexo-mantis-${version}.tgz`;
const sha256 = `c0216d3e5e85357b9a232975bcab8213862ada2e757f6ad5602957fcf551e9f7`;

const engines = fileURLToPath(new URL(`../apps/web/public/engines/`, import.meta.url));
const target = join(engines, `mantis-${version}`);
const stamp = join(target, `.sha256`);

if (existsSync(stamp) && readFileSync(stamp, `utf8`) === sha256) process.exit(0);

const response = await globalThis.fetch(url);
if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}`);
const bytes = new Uint8Array(await response.arrayBuffer());
const got = createHash(`sha256`).update(bytes).digest(`hex`);
if (got !== sha256) throw new Error(`refusing ${url}: its sha256 is ${got}, the pin is ${sha256}`);

const unpacked = mkdtempSync(join(tmpdir(), `mantis-`));
try {
    execFileSync(`tar`, [`-xzf`, `-`, `-C`, unpacked], { input: bytes });
    const from = join(unpacked, `package`);
    // The folder holds only this release, so a bump leaves no older engine behind.
    rmSync(engines, { recursive: true, force: true });
    for (const part of [`src`, `pkg`, `ort`, `net`]) cpSync(join(from, `dist`, part), join(target, part), { recursive: true });
    for (const file of [`LICENSE`, `THIRD_PARTY_LICENSES.txt`, `RUST_LIBRARY_NOTICES.html`]) cpSync(join(from, file), join(target, file));
    writeFileSync(stamp, sha256);
} finally {
    rmSync(unpacked, { recursive: true, force: true });
}
