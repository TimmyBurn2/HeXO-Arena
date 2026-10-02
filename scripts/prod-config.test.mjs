import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const caddyfile = readFileSync(`docker/prod/Caddyfile`, `utf8`);
const compose = readFileSync(`docker/prod/compose.yml`, `utf8`);

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
        assert.match(block(caddyfile, `handle_errors`), /\n\t\timport security_headers\n/u);
    });

    it(`bounds how long a connection may take over its headers, and never cuts a stream`, () => {
        const timeouts = block(caddyfile, `timeouts {`);
        assert.match(timeouts, /read_header 10s/u);
        assert.doesNotMatch(timeouts, /read_body|write|idle/u);
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
