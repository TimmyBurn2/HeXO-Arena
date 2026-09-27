# Deploying HeXO Arena

The production stack is `docker/prod/compose.yml`: four services from one
pulled image plus Caddy.

| service | role |
|---|---|
| `app` | the server and the og shell for `/`, `/ladder`, `/bots/*`, `/game/*`; on an internal network with no route out |
| `egress` | CONNECT-only forward proxy; the app's only way out, to `discord.com:443` alone |
| `web` | one-shot copy of the static site into the volume Caddy serves |
| `caddy` | TLS, the static site, and the proxy to the API and the shell routes |

The box never builds anything.
CI builds the image on every push and publishes it to GHCR from `main`,
tagged `sha-<commit>` and `latest`.

## Prerequisites

- Rootless Docker with Compose v2 and cgroup v2 delegation for the rootless
  user (`cpu`, `memory`, `pids`); without delegation the limits in the
  compose file are silently ignored.
- The rootless user may bind 80 and 443:
  `net.ipv4.ip_unprivileged_port_start=80` in the host sysctl.
- Pull access to the GHCR package: public, or `docker login ghcr.io` with a
  token holding `read:packages`.
- A Discord application whose OAuth redirect is
  `https://<domain>/api/auth/discord/callback`.

### DNS precondition

Before pointing the domain at this stack, confirm that nothing third party
holds a URL or token baked against the deployment the domain serves today.
If any external bot does, run the arena on a side subdomain instead, and
answer the old API with `410` until those clients move.

### Retiring the existing deployment

1. Archive its data and config somewhere off the box.
2. Stop its containers and remove them from any restart policy or unit.
3. Confirm 80 and 443 are free: `ss -ltnp '( sport = :80 or sport = :443 )'`.
4. Keep its old Caddy data volume until the new certificate is issued, then
   delete it.

## Files on the box

One directory, for example `~/hexo-arena`; its name becomes the compose
project and prefixes the volume names (`hexo-arena_data`, `hexo-arena_backup`).

```
~/hexo-arena/
  compose.yml       copy of docker/prod/compose.yml
  Caddyfile         copy of docker/prod/Caddyfile
  .env              compose interpolation, 0600
  hexo-arena.env    app settings and secrets, 0600
```

`.env`:

```sh
HEXO_ARENA_IMAGE=ghcr.io/<owner>/hexo-arena:sha-<commit>
HEXO_ARENA_DOMAIN=<domain>
```

Pin a `sha-` tag rather than `latest`: the previous tag is the rollback.

`hexo-arena.env`:

```sh
PUBLIC_ORIGIN=https://<domain>
DISCORD_CLIENT_ID=<id>
DISCORD_CLIENT_SECRET=<secret>
ADMIN_ACTOR=<operator name for audit rows>
# Optional; these are the defaults.
BACKUP_KEEP=14
BACKUP_HOUR_UTC=3
```

The image sets `NODE_ENV=production`, the bind address, and every path.
Never set `DEV_LOGIN` or `DEV_FAST_STOP`: in production any value refuses the boot.

```sh
chmod 0600 .env hexo-arena.env
```

## Deploy

First time and every update:

```sh
cd ~/hexo-arena
# edit HEXO_ARENA_IMAGE in .env to the new sha tag
docker compose pull
docker compose up -d
docker compose exec app hexo-arena-admin status
```

`up -d` stops the old app with SIGTERM, which drains:

- new streams, games, challenges, and acceptances answer `503 paused` with
  `Retry-After: 60`; bots retry against the new process;
- open streams and live games run on for up to 120 s;
- whatever is still live then ends aborted and unrated, and both sides hear
  `gameFinish`;
- a stream cut during the drain aborts its games instead of forfeiting them.

The compose file gives the app 150 s to stop.
`docker compose logs app` shows `draining`, then `drained` with the count
aborted.

Front end only, without touching the app:

```sh
docker compose pull web
docker compose up --no-deps web
```

Rollback: put the previous tag back in `.env`, then `pull` and `up -d`.

## Backup and restore

The app writes `VACUUM INTO` snapshots nightly at `BACKUP_HOUR_UTC` into the
`backup` volume, named `hexo-arena-YYYY-MM-DD.sqlite`, and keeps the newest
`BACKUP_KEEP`.
Never copy the live database file: a WAL database copied mid-write tears.

Copy the backups off the box regularly:

```sh
docker compose cp app:/backup ./backup-copy
```

### Restore

Direct database access is allowed only while the app is stopped.

```sh
docker compose stop app
docker compose run --rm --no-deps app sh -c '
  mv /data/hexo-arena.sqlite /data/hexo-arena.sqlite.before-restore &&
  rm -f /data/hexo-arena.sqlite-wal /data/hexo-arena.sqlite-shm &&
  cp /backup/hexo-arena-YYYY-MM-DD.sqlite /data/hexo-arena.sqlite'
docker compose start app
docker compose exec app hexo-arena-admin status
```

To restore a copy kept off the box, first place it with
`docker compose cp ./hexo-arena-YYYY-MM-DD.sqlite app:/backup/`.
The boot aborts, unrated, any game the snapshot caught live.
The pause flag is part of the snapshot, so check `status`.

### Restore test

Run it at go-live and monthly, against a throwaway volume and no network.
Pick the newest backup name from `docker compose exec app ls /backup`.

```sh
image=$(grep HEXO_ARENA_IMAGE .env | cut -d= -f2)
docker run --rm --network none -v hexo-arena_backup:/backup:ro -v hexo-arena-restore-test:/data "$image" \
  cp /backup/hexo-arena-YYYY-MM-DD.sqlite /data/hexo-arena.sqlite
docker run --rm --network none -v hexo-arena-restore-test:/data "$image" \
  node -e "const db = new (require('better-sqlite3'))('/data/hexo-arena.sqlite'); console.log(db.pragma('integrity_check', { simple: true }), db.prepare('select count(*) as games from games').get())"
docker run -d --name hexo-arena-restore-test --network none -v hexo-arena-restore-test:/data \
  --tmpfs /run/hexo-arena:mode=0700,uid=10001,gid=10001 "$image"
docker exec hexo-arena-restore-test hexo-arena-admin status
docker rm -f hexo-arena-restore-test
docker volume rm hexo-arena-restore-test
```

Pass: `ok`, a plausible game count, and a `status` answer.

## Logs

The app writes JSON lines to stdout; `docker compose logs app` reads them.
Each request leaves lines tied by `reqId`:
the method and route pattern, such as `/api/bots/:name` (`null` when nothing matched),
then the status and response time.
A client error logs its code and status; a server error its message and stack.
No request line holds a URL, a query string, a request body, a header, or a client address.

Caddy keeps no access log.
One added later masks client addresses (`ip_mask`) and keeps at most 7 days (`roll_keep_for 168h`).
Docker's json-file driver keeps 5 files of 10 MB per service, rotated by size, not by time.

## Break-glass

The app is wedged and the admin socket does not answer:

```sh
docker compose restart app
docker compose exec app hexo-arena-admin status
```

`restart` drains like a deploy.
To skip the drain, `docker compose kill -s SIGINT app` stops at once; the
next boot aborts every live game, unrated, and `docker compose start app`
brings it back.
The pause flag survives either way.

## Egress alternative: host nftables

Instead of the `egress` service, the host firewall can hold the allowlist.
Rootless containers leave the host as processes of the rootless user, here
`hexo-arena`, so an output rule on that uid covers them.

```
table inet hexo-arena-egress {
    set discord {
        type ipv4_addr
        flags interval
    }
    chain output {
        type filter hook output priority 0; policy accept;
        ct state established,related accept
        meta skuid "hexo-arena" oifname "lo" accept
        meta skuid "hexo-arena" udp dport 53 accept
        meta skuid "hexo-arena" ip daddr @discord tcp dport 443 accept
        meta skuid "hexo-arena" drop
    }
}
```

The trade-offs are why the proxy is the default:

- nftables matches addresses, not names; `discord.com` sits behind a CDN,
  so the set needs a timer that re-resolves it, and it admits everything
  else on those addresses;
- the rule covers every process of that uid, so the stack needs a dedicated
  rootless user, and image pulls and Caddy's ACME traffic need their own
  allowances.

With nftables in place, drop the `egress` service and the two proxy
variables, and put `app` on the `edge` network.

## Operator checklist

CI verifies the code, the image build, and the proxy's allowlist logic.
The rest only the box can show.
Run from `~/hexo-arena` after the first deploy, and again after changing the
host or the compose file.

Image:

- [ ] CI is green for the pinned commit and `docker compose pull` fetched that
  tag.
- [ ] `docker compose exec app node --version` is 24.5 or later, which the
  proxy variables need.
- [ ] `docker compose exec app id` shows uid 10001.
- [ ] `docker compose ps` shows `app` healthy.

Runtime hardening:

- [ ] `docker compose exec -u 0 app touch /probe` fails with `Read-only file system`.
- [ ] `docker compose exec app grep -E ' /(tmp|run/hexo-arena) ' /proc/mounts`
  lists both as tmpfs.
- [ ] `docker compose exec app stat -c '%a %u' /run/hexo-arena` prints `700 10001`.
- [ ] `docker compose exec app grep -E 'CapEff|NoNewPrivs' /proc/1/status`
  prints `0000000000000000` and `1`.
- [ ] `docker compose exec app cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/pids.max /sys/fs/cgroup/cpu.max`
  prints `536870912`, `256`, `100000 100000`.
- [ ] `docker stats --no-stream` shows the 64 MiB caps on `caddy` and `egress`.

Admin path:

- [ ] `docker compose exec app hexo-arena-admin status` answers.
- [ ] `hexo-arena-admin pause --reason "checklist"` turns
  `curl -s -o /dev/null -w '%{http_code}' https://<domain>/healthz` to `503`,
  and `resume --reason "checklist"` back to `200`.

Egress:

- [ ] `docker compose exec app node -e "fetch('https://discord.com/api/v10/gateway').then((r) => console.log(r.status))"`
  prints `200`.
- [ ] The same with `https://example.com/` fails, and
  `docker compose logs egress` shows `refused connect`.
- [ ] `docker compose exec app node -e "require('net').connect(443, 'discord.com').on('connect', () => console.log('open')).on('error', (e) => console.log('blocked', e.code)).setTimeout(5000, () => { console.log('blocked'); process.exit(); })"`
  prints `blocked`: there is no route around the proxy.

TLS and proxying:

- [ ] `curl -sI https://<domain>/healthz` answers `200` over a valid
  certificate, and `http://` redirects to `https://`.
- [ ] `curl -s -o /dev/null -w '%{http_code}' -X POST https://<domain>/api/dev/login`
  prints `404`.
- [ ] `curl -N -H 'authorization: Bearer <bot token>' https://<domain>/api/bot/stream`
  shows a bare newline every 10 s: nothing buffers.
- [ ] A bot plays a game end to end, engine websocket included.
- [ ] A Discord login completes.
- [ ] `curl -s https://<domain>/bots/<bot name> | grep og:description`
  shows the bot's owner and rating; with the app stopped the same URL still
  answers the static shell.

Drain and backup:

- [ ] With no live games, `docker compose restart app` finishes in seconds.
- [ ] With a live test game, `docker compose restart app` logs `draining`,
  the game ends on its own or at 120 s as `aborted`, and no rating moves.
- [ ] The morning after, `docker compose exec app ls -l /backup` lists last
  night's file.
- [ ] The restore test passes.
