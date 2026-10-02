import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';

const script = resolve(`docker/prod/update.sh`);
const sha = `0123456789abcdef0123456789abcdef01234567`;
const scratch = mkdtempSync(join(tmpdir(), `update-sh-`));

after(() => {
    rmSync(scratch, { recursive: true, force: true });
});

// A stand-in for docker that logs each call with the image compose would
// read at that moment, the environment's over .env's; `status` fails as
// often as STATUS_FAILS says, counted in a file, as an app still booting
// does; `backup` fails when BACKUP_FAILS is set, as an app that does not
// answer does, and `pull` when PULL_FAILS is set, as for a commit CI never
// built.
const fakeDocker = `#!/bin/sh
printf '%s | %s\\n' "$*" "\${HEXO_ARENA_IMAGE:-$(sed -n 's/^HEXO_ARENA_IMAGE=//p' .env)}" >> "$DOCKER_LOG"
case "$*" in
    *pull*)
        [ -z "\${PULL_FAILS:-}" ] || exit 1 ;;
    *backup*)
        [ -z "\${BACKUP_FAILS:-}" ] || exit 1
        echo 'backup written to /backup/hexo-arena-pre-update-20261002T120000.sqlite' ;;
    *status*)
        failed=$(cat "$DOCKER_LOG.fails" 2>/dev/null || echo 0)
        if [ "$failed" -lt "\${STATUS_FAILS:-0}" ]; then
            echo $((failed + 1)) > "$DOCKER_LOG.fails"
            echo 'admin socket not found' >&2
            exit 1
        fi
        echo 'paused: no' ;;
esac
`;

let made = 0;

// A deployment folder as DEPLOY.md lays it out, with the script copied in.
function deployment(env) {
    made += 1;
    const dir = join(scratch, `box-${String(made)}`);
    mkdirSync(join(dir, `bin`), { recursive: true });
    writeFileSync(join(dir, `bin`, `docker`), fakeDocker, { mode: 0o755 });
    writeFileSync(join(dir, `compose.yml`), ``);
    writeFileSync(join(dir, `.env`), env, { mode: 0o600 });
    chmodSync(join(dir, `.env`), 0o600);
    copyFileSync(script, join(dir, `update.sh`));
    return dir;
}

function run(dir, args, extra = {}) {
    const result = spawnSync(`sh`, [`update.sh`, ...args], {
        cwd: dir,
        encoding: `utf8`,
        env: { PATH: `${join(dir, `bin`)}:/usr/bin:/bin`, DOCKER_LOG: join(dir, `docker.log`), ...extra },
    });
    const log = join(dir, `docker.log`);
    return { ...result, calls: existsSync(log) ? readFileSync(log, `utf8`).trim().split(`\n`) : [] };
}

const env = `HEXO_ARENA_IMAGE=ghcr.io/someone/hexo-arena:sha-${`f`.repeat(40)}\nHEXO_ARENA_DOMAIN=arena.example\n`;

describe(`update.sh`, () => {
    it(`is tracked as an executable POSIX shell script that stops on the first error`, () => {
        assert.equal(statSync(script).mode & 0o111, 0o111);
        assert.match(readFileSync(script, `utf8`), /^#!\/bin\/sh\n[^]*?\nset -eu\n/u);
    });

    it(`refuses anything but one full commit sha, touching nothing`, () => {
        const dir = deployment(env);
        for (const args of [[], [sha, sha], [sha.slice(0, 39)], [`${sha}0`], [sha.toUpperCase()], [`sha-${sha}`], [`${sha.slice(0, 39)}g`], [``]]) {
            const result = run(dir, args);
            assert.notEqual(result.status, 0, args.join(` `));
            assert.match(result.stderr, /usage: /u);
        }
        assert.equal(readFileSync(join(dir, `.env`), `utf8`), env);
        assert.equal(existsSync(join(dir, `docker.log`)), false);
    });

    it(`prints status, writes a pre-update backup, moves the image to the commit's tag, pulls and starts it, and prints status again`, () => {
        const dir = deployment(env);
        const result = run(dir, [sha]);
        assert.equal(result.status, 0, result.stderr);
        const image = `ghcr.io/someone/hexo-arena:sha-${sha}`;
        assert.equal(readFileSync(join(dir, `.env`), `utf8`), `HEXO_ARENA_IMAGE=${image}\nHEXO_ARENA_DOMAIN=arena.example\n`);
        assert.equal(statSync(join(dir, `.env`)).mode & 0o777, 0o600);
        assert.deepEqual(result.calls, [
            `compose exec -T app hexo-arena-admin status | ghcr.io/someone/hexo-arena:sha-${`f`.repeat(40)}`,
            `compose exec -T app hexo-arena-admin backup pre-update | ghcr.io/someone/hexo-arena:sha-${`f`.repeat(40)}`,
            `compose pull | ${image}`,
            `compose up -d | ${image}`,
            `compose exec -T app hexo-arena-admin status | ${image}`,
        ]);
        assert.equal(result.stdout.match(/paused: no/gu)?.length, 2);
        assert.match(result.stdout, /backup written to /u);
    });

    it(`keeps the image name, a registry port included, whatever tag, digest, or quotes it had`, () => {
        for (const old of [
            `registry.example:5000/team/hexo-arena:latest`,
            `registry.example:5000/team/hexo-arena`,
            `registry.example:5000/team/hexo-arena@sha256:${`a`.repeat(64)}`,
            `"registry.example:5000/team/hexo-arena:sha-${`f`.repeat(40)}"`,
        ]) {
            const dir = deployment(`HEXO_ARENA_IMAGE=${old}\n`);
            assert.equal(run(dir, [sha]).status, 0);
            assert.equal(readFileSync(join(dir, `.env`), `utf8`), `HEXO_ARENA_IMAGE=registry.example:5000/team/hexo-arena:sha-${sha}\n`);
        }
    });

    it(`updates an app that does not answer, without a backup, and waits for the new one to answer`, () => {
        const dir = deployment(env);
        const result = run(dir, [sha], { STATUS_FAILS: `2`, BACKUP_FAILS: `1` });
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(
            result.calls.map((call) => call.split(` | `)[0]),
            [
                `compose exec -T app hexo-arena-admin status`,
                `compose exec -T app hexo-arena-admin backup pre-update`,
                `compose pull`,
                `compose up -d`,
                `compose exec -T app hexo-arena-admin status`,
                `compose exec -T app hexo-arena-admin status`,
            ],
        );
        assert.match(result.stderr, /no backup/u);
    });

    it(`leaves .env and the running app alone when the commit has no image to pull`, () => {
        const dir = deployment(env);
        const result = run(dir, [sha], { PULL_FAILS: `1` });
        assert.notEqual(result.status, 0);
        assert.equal(readFileSync(join(dir, `.env`), `utf8`), env);
        assert.deepEqual(
            result.calls.map((call) => call.split(` | `)[0]),
            [`compose exec -T app hexo-arena-admin status`, `compose exec -T app hexo-arena-admin backup pre-update`, `compose pull`],
        );
    });

    it(`refuses a folder whose .env names no image`, () => {
        const dir = deployment(`HEXO_ARENA_DOMAIN=arena.example\n`);
        const result = run(dir, [sha]);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /HEXO_ARENA_IMAGE/u);
        assert.deepEqual(result.calls, []);
    });
});
