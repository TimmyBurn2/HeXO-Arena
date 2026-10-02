import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const caddyfile = readFileSync(`docker/prod/Caddyfile`, `utf8`);
const compose = readFileSync(`docker/prod/compose.yml`, `utf8`);
const workflow = readFileSync(`.github/workflows/ci.yml`, `utf8`);
const dockerfile = readFileSync(`docker/prod/Dockerfile`, `utf8`);
const dockerignore = readFileSync(`.dockerignore`, `utf8`).split(`\n`);

// The block a line opens, up to the brace that closes it at its own indent.
function block(text, opener) {
    const start = text.indexOf(opener);
    assert.notEqual(start, -1, `no ${opener}`);
    const indent = /^\s*/u.exec(text.slice(text.lastIndexOf(`\n`, start) + 1))?.[0] ?? ``;
    const end = text.indexOf(`\n${indent}}`, start);
    return text.slice(start, end);
}

// The compose service a key opens, up to the next one.
function service(name) {
    const rest = compose.slice(compose.indexOf(`\n    ${name}:\n`) + 1);
    const next = rest.slice(1).search(/\n {4}\S/u);
    return next === -1 ? rest : rest.slice(0, next + 1);
}

describe(`the production Caddyfile`, () => {
    it(`sends the security headers on every answer, error answers included`, () => {
        const headers = block(caddyfile, `(security_headers) {`);
        assert.match(headers, /Content-Security-Policy "default-src 'none'; script-src 'self';/u);
        assert.doesNotMatch(headers, /unsafe-/u);
        for (const name of [`Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `frame-ancestors 'none'`]) assert.ok(headers.includes(name), name);
        assert.match(block(caddyfile, `{$HEXO_ARENA_DOMAIN} {`), /^\{\$HEXO_ARENA_DOMAIN\} \{\n\timport security_headers\n/u);
        assert.match(block(caddyfile, `handle_errors 500 502 503 504 {`), /\n\t\timport security_headers\n/u);
    });

    it(`bounds how long a connection may take over its headers, and never cuts a stream`, () => {
        const timeouts = block(caddyfile, `timeouts {`);
        assert.match(timeouts, /read_header 10s/u);
        assert.doesNotMatch(timeouts, /read_body|write|idle/u);
    });

    it(`falls back to the static shell when the app is down or fails a page`, () => {
        assert.match(caddyfile, /\n\thandle_errors 500 502 503 504 \{\n/u);
        const shell = block(caddyfile, `handle @shell {`);
        assert.match(shell, /@appFailed status 500\n\t+handle_response @appFailed \{\n\t+root \* \/srv\/web\n\t+rewrite \* \/index\.html\n\t+file_server\n/u);
    });

    it(`marks API answers the app left unmarked as not to be cached`, () => {
        assert.match(block(caddyfile, `handle /api/* {`), /header \?Cache-Control "no-store"/u);
    });
});

describe(`the production compose file`, () => {
    it(`pins Caddy by digest, with room for many open connections under a Go memory limit`, () => {
        const caddy = service(`caddy`);
        assert.match(caddy, /image: caddy:[\d.]+@sha256:[\da-f]{64}\n/u);
        assert.match(caddy, /mem_limit: 256m\n/u);
        assert.match(caddy, /GOMEMLIMIT: 200MiB\n/u);
        assert.match(caddy, /healthcheck:\n\s+test: \[CMD, nc, -z, 127\.0\.0\.1, '443'\]/u);
    });

    it(`publishes the site on IPv6 as well`, () => {
        assert.match(compose, /\n {4}edge:\n {8}enable_ipv6: true\n/u);
    });
});

describe(`the production Dockerfile`, () => {
    it(`starts both stages from one base pinned by digest`, () => {
        const bases = [...dockerfile.matchAll(/^FROM (\S+)/gmu)].map((match) => match[1]);
        assert.equal(bases.length, 2);
        assert.match(bases[0] ?? ``, /^node:24-slim@sha256:[\da-f]{64}$/u);
        assert.equal(bases[1], bases[0]);
    });

    it(`leaves no package manager in the runtime stage`, () => {
        const runtime = dockerfile.slice(dockerfile.lastIndexOf(`\nFROM `));
        for (const path of [`/usr/local/lib/node_modules/npm`, `/usr/local/lib/node_modules/corepack`, `/usr/local/bin/npm`, `/usr/local/bin/npx`, `/usr/local/bin/corepack`, `/usr/local/bin/yarn`, `/usr/local/bin/yarnpkg`, `/opt/yarn-v*`]) {
            assert.ok(runtime.includes(` ${path}`), path);
        }
        assert.match(runtime, /\nRUN rm -rf /u);
    });
});

describe(`the docker build context`, () => {
    it(`leaves out dependencies, builds, databases, secrets, and local folders at any depth`, () => {
        for (const pattern of [`**/node_modules`, `**/dist`, `**/data`, `**/*.sqlite*`, `**/.env`, `**/legal/details.json`, `design`, `.wt`, `.claude`]) {
            assert.ok(dockerignore.includes(pattern), pattern);
        }
    });
});

describe(`the CI workflow`, () => {
    it(`pins every action by full commit hash, naming its version beside it`, () => {
        const uses = workflow.split(`\n`).filter((line) => /^\s*- uses: /u.test(line));
        assert.ok(uses.length > 0);
        for (const line of uses) assert.match(line, /- uses: [\w.-]+\/[\w.-]+@[\da-f]{40} # v\d+\.\d+\.\d+$/u, line);
    });

    it(`grants every job read access alone, and package writes to the image job`, () => {
        assert.match(workflow, /\npermissions:\n {4}contents: read\njobs:\n/u);
        const image = workflow.slice(workflow.indexOf(`\n    image:\n`));
        assert.equal(workflow.match(/packages: write/gu)?.length, 1);
        assert.match(image, /\n {8}permissions:\n {12}contents: read\n {12}packages: write\n/u);
    });

    it(`leaves the token out of every checkout`, () => {
        const checkouts = workflow.match(/- uses: actions\/checkout@\S+ # \S+\n\s+with:\n\s+persist-credentials: false\n/gu) ?? [];
        assert.equal(checkouts.length, workflow.match(/actions\/checkout@/gu)?.length);
    });
});
