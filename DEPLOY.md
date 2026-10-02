# Deploying HeXO Arena

The production stack is `docker/prod/compose.yml`: four services, three from
one pulled image plus Caddy.

| service | role |
|---|---|
| `app` | the server and the og shell for every page of the site; on an internal network with no route out |
| `egress` | CONNECT-only forward proxy; the app's only way out, to `discord.com:443` alone |
| `web` | one-shot copy of the static site into the volume Caddy serves |
| `caddy` | TLS, the static site, and the proxy to the API and the shell routes |

The box builds nothing.
CI builds the image on every push and publishes it to GHCR from `main`,
tagged `sha-<full commit hash>` and `latest`.

## Prerequisites

- Rootless Docker with Compose v2 and cgroup v2 delegation for the rootless
  user (`cpu`, `memory`, `pids`); without delegation the compose file's
  limits are ignored.
- The rootless user may bind 80 and 443:
  `net.ipv4.ip_unprivileged_port_start=80` in the host sysctl.
- Client addresses reach Caddy unchanged: rootless Docker 29.5 or later with
  `"userland-proxy": false` in its daemon.json, or the `slirp4netns` or
  `pasta` port driver on older versions; IPv6 must reach Caddy without
  docker-proxy.
  Otherwise every visitor counts as one caller for the rate limits; the
  checklist below checks it.
- With `"userland-proxy": false` the daemon starts only once the host loads
  `br_netfilter`:
  `modprobe br_netfilter`, and `br_netfilter` in
  `/etc/modules-load.d/br_netfilter.conf` for the next boot.
- The compose file enables IPv6 on the `edge` network, so Docker publishes
  80 and 443 on IPv6 too; nothing more is needed on the host.
- Pull access to the GHCR package, which stays private, since a public image
  would distribute its Debian base's GPL programs: `docker login ghcr.io`
  with a classic personal access token holding `read:packages`; GHCR takes
  no fine-grained token.
  The package's GitHub page shows its visibility beside its name; Package
  settings, Danger Zone, changes it.
  Check it after CI's first push.
- A Discord application whose OAuth redirect is
  `https://<domain>/api/auth/discord/callback`.

### DNS precondition

Before pointing the domain at this stack, confirm no third party holds a URL
or token for the deployment the domain serves today.
If an external bot does, run the arena on a side subdomain and answer the old
API with `410` until those clients move.

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
  compose.yml         copy of docker/prod/compose.yml
  Caddyfile           copy of docker/prod/Caddyfile
  .env                compose interpolation, 0600
  hexo-arena.env      app settings and secrets, 0600
  legal/              the deployment's legal documents and their details
```

`compose.yml` and `Caddyfile` come from the commit the image was built
from, for example `git show v0.1.0:docker/prod/compose.yml > compose.yml`
in a checkout, copied over.

`.env`:

```sh
HEXO_ARENA_IMAGE=ghcr.io/<owner>/hexo-arena:sha-<full commit hash>
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
Never set `DEV_LOGIN` or `DEV_FAST_STOP`: in production any value fails the boot.

```sh
chmod 0600 .env hexo-arena.env
```

### Legal documents

`legal/` holds the Impressum, the privacy policy, and the terms, and the
`details.json` they fill in.
Copy the repository's `legal/` folder and follow its `README.md`: what to
fill in, and which documents are required where.
For Privacy and Terms only, without an Impressum or a postal address,
follow its "Privacy and Terms only" steps: delete `imprint.md`, and leave
the operator's address out of `details.json`.
Caddy mounts the folder read-only and serves those four files; an edit
shows on the next page load.
Every document is optional: the site links only those the folder has, and
the app, which mounts it read-only too, logs one line at boot naming the
missing ones.
Every value in it is public, and Caddy's uid must read it:

```sh
chmod -R a+rX legal
```

## First deploy

With the files above in `~/hexo-arena`:

```sh
cd ~/hexo-arena
docker login ghcr.io
docker compose pull
docker compose up -d
docker compose ps
docker compose exec app hexo-arena-admin status
docker compose exec app hexo-arena-admin backup
```

`ps` shows `app` and `caddy` healthy and `web` exited with 0 once the
site is copied; Caddy fetches the certificate on the first request.
`backup` writes tonight's snapshot at once, so the restore test below
runs on the first day.
Then run the operator checklist.

## Update

```sh
cd ~/hexo-arena
# edit HEXO_ARENA_IMAGE in .env to the new sha tag; when the release
# changed compose.yml or the Caddyfile, copy those over too
docker compose pull
docker compose up -d
docker compose exec app hexo-arena-admin status
```

`up -d` stops the old app with SIGTERM, which drains:

- new streams, games, challenges, and acceptances answer `503 paused` with
  `Retry-After: 60`;
- open streams and live games run on for up to 120 s;
- whatever is still live then ends aborted and unrated, and both sides get
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
`docker compose exec app hexo-arena-admin backup` writes the day's
snapshot at once, replacing one written earlier that day.
Never copy the live database file.

The privacy policy states that deleted data leaves every backup within 14
days: keep `BACKUP_KEEP` at 14 or less.
The app prunes only when it writes the next backup; while it is stopped,
delete snapshots older than 14 days by hand:

```sh
docker compose run --rm --no-deps app find /backup -name 'hexo-arena-*.sqlite' -mtime +13 -delete
```

Copies off the box are encrypted, hold one night's snapshot each, and are kept
14 days at most; for example, with an age key whose private half stays off
the box:

```sh
latest=$(docker compose exec -T app sh -c 'ls /backup/hexo-arena-*.sqlite | tail -n 1')
docker compose cp "app:$latest" ./latest.sqlite
age -r <age public key> -o "$(basename "$latest").age" latest.sqlite
rm latest.sqlite
# move the .age file off the box, then there:
find <off-box directory> -name 'hexo-arena-*.sqlite.age' -mtime +13 -delete
```

Host backup tools and the provider's server snapshots are copies too: exclude
the Docker volumes from them, or keep what holds the volumes 14 days at most.

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

To restore a copy kept off the box, first decrypt it
(`age -d -i <age key file> -o hexo-arena-YYYY-MM-DD.sqlite hexo-arena-YYYY-MM-DD.sqlite.age`),
then place the snapshot with
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
# A production boot names a proxy address and an https origin; with no network, any will do.
docker run -d --name hexo-arena-restore-test --network none -e TRUSTED_PROXY=127.0.0.1 -e PUBLIC_ORIGIN=https://localhost \
  -v hexo-arena-restore-test:/data --tmpfs /run/hexo-arena:mode=0700,uid=10001,gid=10001 "$image"
docker exec hexo-arena-restore-test hexo-arena-admin status
docker rm -f hexo-arena-restore-test
docker volume rm hexo-arena-restore-test
```

Pass: `ok`, a plausible game count, and a `status` answer.

## Logs

The app writes JSON lines to stdout; `docker compose logs app` reads them.
Each request leaves lines tied by `reqId`: the method and route pattern, such
as `/api/bots/:name` (`null` when nothing matched), then the status and
response time.
A client error logs its code and status; a server error its message and stack.
No request line holds a URL, a query string, a request body, a header, or a
client address.

Caddy keeps no access log; one added later masks client addresses
(`ip_mask`) and keeps at most 7 days (`roll_keep_for 168h`).
Docker's json-file driver keeps 5 files of 10 MB per service, rotated by size.

## Administration

The site has no admin role, route, or UI.
The app applies admin operations itself, one JSON request per connection on
a Unix socket only its own uid can open, at `/run/hexo-arena/admin.sock` on a
private tmpfs.
The `hexo-arena-admin` client ships in the same image:

```sh
docker compose exec app hexo-arena-admin status
docker compose exec app hexo-arena-admin pause --reason "incident"
docker compose exec app hexo-arena-admin ban-user somebody --reason "cheating"
```

Outside Docker, `pnpm --filter @hexo-arena/server admin status` talks to a
local `pnpm dev`.

| op | effect |
|---|---|
| `status` | uptime, paused flag, live streams, active games, client keys, requests without a public address, the last 10 admin actions |
| `backup` | write the day's backup now; no audit row, as it changes no data |
| `pause` / `resume` | new streams, games, and challenges answer `503` with `Retry-After`; open streams and live games run on; the flag survives restarts |
| `ban-user <name>` / `unban-user <name>` | sessions end, bots are closed and hidden, their tokens answer `403`; unban relists the bots and kills their old tokens |
| `delete-user <name>` | live games aborted, bots deleted as below, the user forgotten; rated history stays under a `deleted-<n>` placeholder |
| `delist-bot <name>` / `relist-bot <name>` | hidden from the directory and the ladder, refused from challenges and games both ways; live play continues |
| `revoke-bot <name>` | token dead, stream closed; the owner mints a fresh one |
| `abort-game <gameId>` / `abort-game --bot <name>` | unrated abort of one game, or of every live game of a bot |
| `recompute-ratings [--exclude <gameId\|name>]...` | re-fold every rating, and the ratings around each game, from the game log; excluded games are voided for good |
| `tournament-create --name <text> --start <ISO time> --clock turn:<s>\|match:<min>+<s> [--opening <plies>] [--max <bots>]` | schedule a bot round robin 1 hour to 14 days ahead, at most 3 waiting; turn clock 5 to 60 s, or match clock 1 to 10 min plus 0 to 10 s; opening 1, 3, 5, 7, or 9 plies, default 5; 3 to 12 entries, default 12 |
| `tournament-cancel <tournamentId>` | end a waiting or running tournament as canceled |
| `tournament-schedule add --weekday <mon..sun> --time <HH:MM> --name <text> --clock turn:<s>\|match:<min>+<s> [--opening <plies>] [--max <bots>] [--ahead <days>]` | a weekly rule: each week's tournament starts on that weekday at that UTC time and is created `--ahead` days before, 1 to 14, default 7, opening it for entries; `{date}` in the name becomes the start's date, YYYY-MM-DD; clock, opening, and entries as for `tournament-create`; one rule per weekday and time |
| `tournament-schedule list` | the weekly rules with their ids and next starts |
| `tournament-schedule remove <ruleId>` | delete a weekly rule; the tournaments it created stay, and `tournament-cancel` ends a waiting one |

Every mutation takes `--reason` and writes an audit row.
`status` lists the running and waiting tournaments with their ids, and the
weekly rules.
A development server schedules a tournament as soon as a minute ahead.
A weekly rule's tournament counts toward the 3 waiting: while they are full,
creation waits for a free slot.
A week whose tournament does not exist an hour before its start, from a full
waiting cap, downtime, or a clock step, is skipped, never created late.
Deleting a bot, by its owner or through `delete-user`, keeps a bot that has a
game with a winner under a placeholder, its name still reserved, and deletes
any other bot outright, freeing the name.

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

Its costs:

- nftables matches addresses, not names; `discord.com` sits behind a CDN,
  so the set needs a timer that re-resolves it, and it admits everything
  else on those addresses;
- the rule covers every process of that uid, so the stack needs a dedicated
  rootless user, and image pulls and Caddy's ACME traffic need their own
  allowances.

With nftables in place, drop the `egress` service and the two proxy
variables, and put `app` on the `edge` network.

## Operator checklist

CI verifies the code, the image build, and the proxy's allowlist logic; the
rest only the box shows.
Run it from `~/hexo-arena` after the first deploy, and after changing the
host or the compose file.

Image:

- [ ] CI is green for the pinned commit and `docker compose pull` fetched that
  tag.
- [ ] `docker compose exec app node --version` is 24.5 or later, which the
  proxy variables need.
- [ ] `docker compose exec app id` shows uid 10001.
- [ ] `docker compose ps` shows `app` and `caddy` healthy.
- [ ] `docker compose exec caddy caddy version` shows v2.11.4.

Runtime hardening:

- [ ] `docker compose exec -u 0 app touch /probe` fails with `Read-only file system`.
- [ ] `docker compose exec app grep -E ' /(tmp|run/hexo-arena) ' /proc/mounts`
  lists both as tmpfs.
- [ ] `docker compose exec app stat -c '%a %u' /run/hexo-arena` prints `700 10001`.
- [ ] `docker compose exec app grep -E 'CapEff|NoNewPrivs' /proc/1/status`
  prints `0000000000000000` and `1`.
- [ ] `docker compose exec app cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/pids.max /sys/fs/cgroup/cpu.max`
  prints `536870912`, `256`, `100000 100000`.
- [ ] `docker stats --no-stream` shows the 256 MiB cap on `caddy` and 64 MiB
  on `egress`.

Admin path:

- [ ] `docker compose exec app hexo-arena-admin status` answers.
- [ ] After loading the site from two devices on two networks, such as a phone
  off Wi-Fi and a laptop, `status` shows at least 2 `client keys`; 0 with a
  climbing `keyless` means client addresses do not reach Caddy (see
  Prerequisites).
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
- [ ] `curl -sI` on `https://<domain>/`, `/api/me`, and a `/assets/` file
  shows `content-security-policy`, `strict-transport-security`,
  `x-frame-options`, and no `server` header; `/api/me` also shows
  `cache-control: no-store`.
- [ ] The site answers over IPv6: `curl -6 -sI https://<domain>/healthz`
  from a host with IPv6.
- [ ] The browser console on the home page and a game page shows no CSP
  violation.
- [ ] From one client, after `ulimit -n 4096`, 3,000 idle connections leave Caddy up:
  `python3 -c "import socket,time;s=[socket.create_connection(('<domain>',443)) for _ in range(3000)];time.sleep(30)"`,
  then `docker inspect -f '{{.State.OOMKilled}} {{.RestartCount}}' hexo-arena-caddy-1`
  prints `false 0` and the site still answers.
- [ ] `curl -s -o /dev/null -w '%{http_code}' -X POST https://<domain>/api/dev/login`
  prints `404`.
- [ ] `curl -N -H 'authorization: Bearer <bot token>' https://<domain>/api/bot/stream`
  shows a bare newline every 10 s: nothing buffers.
- [ ] A bot plays a game end to end, engine websocket included.
- [ ] A Discord login completes.
- [ ] `curl -s https://<domain>/bots/<bot name> | grep og:description`
  shows the bot's owner and rating; with the app stopped the same URL still
  answers the static shell.
- [ ] `https://<domain>/legal/privacy` shows the operator's name and email,
  the host, server location, and authority, with no `<` placeholder anywhere;
  with an Impressum, `https://<domain>/legal/imprint` shows the name,
  address, and email, and without one it is not found and the footer links
  Privacy and Terms only.
- [ ] With the app stopped, the legal pages still show in full.
- [ ] `curl -s https://<domain>/legal/details.json` prints the details, and
  `curl -s https://<domain>/legal/README.md` the site's page, not the file.

Drain and backup:

- [ ] With no live games, `docker compose restart app` finishes in seconds.
- [ ] With a live test game, `docker compose restart app` logs `draining`,
  the game ends on its own or at 120 s as `aborted`, and no rating moves.
- [ ] `hexo-arena-admin backup` answers `backup written to /backup/...`, and
  the morning after, `docker compose exec app ls -l /backup` lists last
  night's file.
- [ ] The restore test passes.
