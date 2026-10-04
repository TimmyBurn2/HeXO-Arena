# Host your own HeXO Arena

This guide takes you from a fork to the site running on your own server and
domain, with its own ladder and its own legal documents.

The production stack is `docker/prod/compose.yml`: four services, three from
one image plus Caddy.

| service | role |
|---|---|
| `app` | the server and the og shell for every page of the site; on an internal network with no route out |
| `egress` | CONNECT-only forward proxy; the app's only way out, to `discord.com:443` alone |
| `web` | one-shot copy of the static site into the volume Caddy serves |
| `caddy` | TLS, the static site, and the proxy to the API and the shell routes |

The server builds nothing: it pulls one image per commit, tagged
`sha-<full commit sha>`.

## Fork

CI publishes images from `main` only, so fork the repository on GitHub with
all its branches (untick "Copy the `develop` branch only"), or push the commit
you want to run to your fork's `main`.
Follow this guide, and `legal/`, as they stand at the commit you deploy:
`main` may lag the branch GitHub shows first.

A fork receives no push, so CI has not run yet.
In the fork's Actions tab, enable workflows, open `ci`, and Run workflow on
`main`; wait for its `image` job to finish.

`apps/web/src/site-links.ts` names the repositories the site links to, the
Bot API and the site's source; point them at yours if you publish your own.

Below, the image is `ghcr.io/<owner>/hexo-arena`, `<owner>` being your GitHub
account or organization in lowercase.

## Build the image

### In CI

`.github/workflows/ci.yml` checks, tests, and builds the image on every push
and on a run started by hand, and publishes it to GHCR from `main` only,
tagged `sha-<full commit sha>` and `latest`, for x86-64 servers
(`linux/amd64`).
Deploy a `sha-` tag, never `latest`: the previous tag is the rollback.

Keep the package private, as this guide does: a public image distributes
the GPL programs of its Debian base, and with them the duty to offer their
source.
Its page, under Packages on your profile, shows the visibility beside its
name; Package settings, Danger Zone, changes it.

### Locally

Build from a clean checkout of the commit, for the server's architecture
(`linux/arm64` for an ARM server), and push to a registry the server pulls
from:

```sh
sha=$(git rev-parse HEAD)
docker build --platform linux/amd64 -f docker/prod/Dockerfile -t ghcr.io/<owner>/hexo-arena:sha-$sha .
docker login ghcr.io
docker push ghcr.io/<owner>/hexo-arena:sha-$sha
```

`docker login ghcr.io` takes your GitHub account as the username and, as the
password, a classic personal access token, created under GitHub's Settings,
Developer settings, Personal access tokens, Tokens (classic); GHCR takes no
fine-grained token.
Pushing needs `write:packages`; pulling, `read:packages`.

## Discord application

Sign-in runs through Discord.
In the Discord Developer Portal, create an application, then:

- OAuth2: add the redirect `https://<domain>/api/auth/discord/callback`, and
  copy the client ID and a client secret into `hexo-arena.env` (see Env
  files);
- General Information: set the Privacy Policy URL to
  `https://<domain>/legal/privacy` and the Terms of Service URL to
  `https://<domain>/legal/terms`.

The site asks only for the `identify` scope; ignore the Bot tab.

## The server

A Linux server with systemd, at least 1 GiB of memory (the containers'
caps add up to about 900 MiB), and disk for the images, the database, and
its 14 nightly copies.

Install rootless Docker with Compose v2, 29.5 or later, for a dedicated user,
following Docker's guide (https://docs.docker.com/engine/security/rootless/).
Then, as root, let that user run it without a login session, bind 80 and
443, and limit its containers:

```sh
loginctl enable-linger <user>
echo 'net.ipv4.ip_unprivileged_port_start=80' > /etc/sysctl.d/90-unprivileged-ports.conf
sysctl --system
mkdir -p /etc/systemd/system/user@.service.d
printf '[Service]\nDelegate=cpu cpuset io memory pids\n' > /etc/systemd/system/user@.service.d/delegate.conf
systemctl daemon-reload
modprobe br_netfilter
echo br_netfilter > /etc/modules-load.d/br_netfilter.conf
```

Without the delegation the compose file's limits are ignored; it takes
effect once the user's service manager restarts: reboot, or
`systemctl restart user@<uid>.service`.
`br_netfilter` is what the daemon needs to start with the setting below.

As the user, keep client addresses unchanged on their way to Caddy, and
start Docker at boot:

```sh
mkdir -p ~/.config/docker
echo '{ "userland-proxy": false }' > ~/.config/docker/daemon.json
systemctl --user enable docker
systemctl --user restart docker
```

Without unchanged addresses every visitor counts as one caller for the rate
limits; the checklist below checks it.

The network:

- The domain's A record, and its AAAA record on a server with IPv6, point at
  the server, and resolve before the first `up`: Caddy asks for the
  certificate as it starts.
- TCP 80, TCP 443, and UDP 443 are open in the host's and the provider's
  firewalls.
- The compose file publishes 80 and 443 on IPv6 too; nothing more is needed
  on the host.
  On a server without IPv6, give the domain no AAAA record; if `up` then
  fails to create the `edge` network, delete its `enable_ipv6: true` from
  `compose.yml`, and again in each new copy.
- The stack's internal network is `172.29.64.0/24`; if the host reaches a
  network in that range, change it as the comment in `compose.yml` says.

## The deployment folder

Everything lives in one folder, for example `~/hexo-arena`.
The compose file names the project `hexo-arena`, so the volumes are
`hexo-arena_data` and `hexo-arena_backup` and Caddy's container
`hexo-arena-caddy-1`, whatever the folder is called.

```
~/hexo-arena/
  compose.yml         docker/prod/compose.yml
  Caddyfile           docker/prod/Caddyfile
  update.sh           docker/prod/update.sh, executable
  .env                from docker/prod/env.example, 0600
  hexo-arena.env      from docker/prod/hexo-arena.env.example, 0600
  legal/              the legal documents and their details
```

With git on the server and read access to your fork (a deploy key or a
token for a private one), keep a checkout beside the folder and copy from
it:

```sh
git clone <your fork's clone URL> ~/hexo-arena-src
git -C ~/hexo-arena-src checkout <full commit sha>
mkdir ~/hexo-arena
cd ~/hexo-arena-src
cp docker/prod/compose.yml docker/prod/Caddyfile docker/prod/update.sh ~/hexo-arena/
cp docker/prod/env.example ~/hexo-arena/.env
cp docker/prod/hexo-arena.env.example ~/hexo-arena/hexo-arena.env
cp -R legal ~/hexo-arena/
```

Without git there, copy the same files from a checkout elsewhere, for
example with `scp`.
The full commit sha is the commit CI built: its run names it, the package's
page lists its `sha-` tags, and `git -C ~/hexo-arena-src rev-parse origin/main`
prints the newest.

## Legal documents

Follow `legal/README.md` in the deployment folder: fill in `details.json`,
delete the documents you do not need, and adapt the texts to your law.
Caddy serves the documents and `details.json` from it, read-only; an edit
shows on the next page load.
The site links only the documents the folder has, and the app's boot log
names those missing and a `details.json` that is missing or invalid.
Every value in the folder is public, and Caddy's uid must read it:

```sh
chmod -R a+rX ~/hexo-arena/legal
```

## Env files

Replace every `<...>` value in both files.
`HEXO_ARENA_DOMAIN`, `PUBLIC_ORIGIN`, and the Discord redirect name the same
host.

`.env`, which compose reads for its own settings:

| key | what it does |
|---|---|
| `HEXO_ARENA_IMAGE` | required: the image `app`, `egress`, and `web` run, `ghcr.io/<owner>/hexo-arena:sha-<full commit sha>`; `update.sh` moves it |
| `HEXO_ARENA_DOMAIN` | required: the domain Caddy serves and fetches a certificate for, `<domain>` |

`hexo-arena.env`, the app's settings and secrets:

| key | what it does |
|---|---|
| `PUBLIC_ORIGIN` | required: `https://<domain>`, with no path; builds the Discord redirect and the link previews' image addresses |
| `DISCORD_CLIENT_ID` | required: the Discord application's client ID; empty turns sign-in off |
| `DISCORD_CLIENT_SECRET` | required: the application's client secret |
| `ADMIN_ACTOR` | the name audit rows give the operator; default `operator` |
| `BACKUP_KEEP` | how many nightly backups to keep; default 14 |
| `BACKUP_HOUR_UTC` | the UTC hour of the nightly backup and purge; default 3 |
| `REPORT_FORM` | `on` opens the report form at `/report`, its links, and `POST /api/reports`; default off, where the legal texts name the contact email alone |

```sh
chmod 0600 ~/hexo-arena/.env ~/hexo-arena/hexo-arena.env
```

The image sets `NODE_ENV=production`, `HOST`, `PORT`, and every path
(`DATABASE_PATH`, `ADMIN_SOCKET_PATH`, `BACKUP_DIR`, `LEGAL_DIR`); the
compose file sets `TRUSTED_PROXY`, `WEB_INDEX_PATH`, and the egress proxy
variables.
Leave those out, and never set `DEV_LOGIN` or `DEV_FAST_STOP`: in production
any non-empty value fails the boot.

## First deploy

```sh
cd ~/hexo-arena
docker login ghcr.io
docker compose pull
docker compose up -d
docker compose ps -a
docker compose exec app hexo-arena-admin status
docker compose exec app hexo-arena-admin backup
```

`docker login` takes your GitHub account and a classic token with
`read:packages` (see Build the image); a public package needs none.
`ps -a` shows `app` and `caddy` healthy and `web` exited with 0 once the
site is copied.
`backup` writes tonight's snapshot at once, so the restore test can run on
the first day.
Then open `https://<domain>/legal/privacy` and the other legal pages and
read them through, and run the operator checklist.

## Update

An update restarts the app, which stops with SIGTERM and drains:

- new streams, games, challenges, and acceptances answer `503 paused` with
  `Retry-After: 60`;
- open streams and live games run on for up to 120 s;
- whatever is still live then ends aborted and unrated, and both sides get
  `gameFinish`;
- a stream cut during the drain aborts its games instead of forfeiting them.

So first check what it would cut short:

```sh
cd ~/hexo-arena
docker compose exec app hexo-arena-admin status
```

It lists the active games and the running and waiting tournaments.
A running tournament picks up after the restart, replaying once any game
the drain cut; still, update between tournaments when you can.

To take a release of the repository you forked, Sync fork on your fork's
`main` on GitHub; the push starts CI, whose `image` job publishes that
commit.
Then bring the checkout to it and see what changed beside the image:

```sh
git -C ~/hexo-arena-src fetch
git -C ~/hexo-arena-src checkout <new sha>
git -C ~/hexo-arena-src diff --stat <old sha> <new sha> -- docker/prod legal apps/server/src/db/migrations
```

- `docker/prod`: copy a changed `compose.yml`, `Caddyfile`, or `update.sh`
  into the deployment folder.
- `legal`: merge the templates' changes into the deployment's own copies;
  `git diff <old sha> <new sha> -- legal` shows them.
- `apps/server/src/db/migrations`: a new file means the update migrates the
  database (see Rollback).

Then:

```sh
./update.sh <new sha>
```

It prints `status`, writes a pre-update backup, pulls the commit's image,
names it in `.env` under the image name already there, runs
`docker compose up -d`, and prints `status` again once the new app answers.
A commit with no image changes nothing.
The compose file gives the old app 150 s to stop; `docker compose logs app`
shows `draining`, then `drained` with the count aborted.

### Rollback

Without a migration in between, roll back with `./update.sh <previous sha>`;
the script printed the previous image as it moved.

Migrations only go forward, and an older app may not run on a newer
database.
Across one, restore the pre-update backup of the update you undo instead,
the newest `hexo-arena-pre-update-*.sqlite` unless `update.sh` ran since:
stop the app, restore it as Restore below says, put the previous tag back in
`.env`, and `docker compose up -d`.
What happened since the update is lost.

### Base images

The Dockerfile pins the Node base image by digest in both stages, so a moved
tag never changes a build.
To take Node's updates, read the tag's current digest on any machine with
Docker, put it in both `FROM` lines, commit, and deploy as above:

```sh
docker buildx imagetools inspect node:26-slim
```

Its `Digest:` line is the multi-arch index to pin.
`compose.yml` pins Caddy the same way: put the digest of the new
`caddy:<version>` in its `image:` line, commit, copy the file to the server,
and update.

## Backup and restore

The app writes `VACUUM INTO` snapshots nightly at `BACKUP_HOUR_UTC` into the
`backup` volume, named `hexo-arena-YYYY-MM-DD.sqlite`, and keeps the newest
`BACKUP_KEEP`.
`docker compose exec app hexo-arena-admin backup` writes the day's
snapshot at once, replacing one written earlier that day.
`update.sh` writes `hexo-arena-pre-update-YYYYMMDDTHHMMSS.sqlite`, named for
the UTC second it was taken, which no later backup replaces; the app deletes
it before it is `BACKUP_KEEP` days old.
Never copy the live database file.

The privacy policy states that backups stay on the server for 14 days and
that deleted data leaves them within that time:

- keep `BACKUP_KEEP` at 14, or change the policy with it;
- the app prunes only when it writes the next backup; while it is stopped,
  delete snapshots older than 14 days by hand:
  `docker compose run --rm --no-deps app find /backup -name 'hexo-arena-*.sqlite' -mtime +13 -delete`;
- host backup tools and the provider's server snapshots copy the volumes
  too: leave the Docker volumes out of them, or change the policy.

The backups share the server's disk with the database: a lost disk takes
both.
Rootless Docker keeps the volumes under the user's
`~/.local/share/docker/volumes`.

At the same hour, backups or not, the app purges what has outlived its stated
time: moderation records after the end of the third calendar year after
theirs, challenge records after 90 days, and reports a year after they were
closed.

### Restore

A nightly `hexo-arena-YYYY-MM-DD.sqlite` and a pre-update
`hexo-arena-pre-update-YYYYMMDDTHHMMSS.sqlite` restore the same way;
`docker compose exec app ls /backup` lists them.
Direct database access is allowed only while the app is stopped.

```sh
docker compose stop app
docker compose run --rm --no-deps app sh -c '
  mv /data/hexo-arena.sqlite /data/hexo-arena.sqlite.before-restore &&
  rm -f /data/hexo-arena.sqlite-wal /data/hexo-arena.sqlite-shm &&
  cp /backup/<backup file> /data/hexo-arena.sqlite'
docker compose start app
docker compose exec app hexo-arena-admin status
```

The boot aborts, unrated, any game the snapshot caught live.
The pause flag is part of the snapshot, so check `status`.
Once the site checks out, delete the replaced database, so it does not
outlive the 14 days the privacy policy states:
`docker compose exec app rm /data/hexo-arena.sqlite.before-restore`.

Every account deletion is also written to `/data/erasures.jsonl`, beside the
database and outside the snapshot, and kept `BACKUP_KEEP` + 1 days.
The boot deletes again any account in it that the snapshot brought back,
with an audit row by `restore`, and its log names how many.
Keep the file through a restore: the steps above leave it in place.

### Restore test

Run it from `~/hexo-arena` at go-live and monthly, against a throwaway
volume and no network.
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
# The admin socket opens a moment after the container starts.
for _ in $(seq 30); do docker exec hexo-arena-restore-test hexo-arena-admin status && break; sleep 2; done
docker rm -f hexo-arena-restore-test
docker volume rm hexo-arena-restore-test
```

Pass: `ok`, a plausible game count, and a `status` answer.

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
| `status` | uptime, paused flag, live streams, active games, client keys, requests without a public address, the bots connected in the last 14 days counted by client, `hexo-bridge/<version>` or `other`, the open reports, oldest first, the last 10 admin actions |
| `bot <name>` | one bot: its owner, presence, live games, declared version, and the client it last connected with, and when; no audit row |
| `backup [label]` | write the day's backup now; with a label, such as `pre-update`, one named for it and the second instead, kept apart; no audit row, as it changes no data |
| `pause` / `resume` | new streams, games, and challenges answer `503` with `Retry-After`; open streams and live games run on; the flag survives restarts |
| `ban-user <name>` / `unban-user <name>` | sessions end, bots are closed and hidden, their duels cut short, their tokens answer `403`; unban relists the bots and kills their old tokens |
| `delete-user <name>` | live games aborted, bots deleted as below, the user forgotten; rated history stays under a `deleted-<n>` placeholder, which earlier audit rows naming the user or their bots now name instead; the deletion goes to the erasure journal |
| `delist-bot <name>` / `relist-bot <name>` | hidden from the directory and the ladder, refused from challenges and games both ways, its duels cut short; live play continues |
| `revoke-bot <name>` | token dead, stream closed; the owner mints a fresh one |
| `abort-game <gameId>` / `abort-game --bot <name>` | unrated abort of one game, or of every live game of a bot; a duel such a game belongs to is cut short |
| `recompute-ratings [--exclude <gameId\|name>]...` | re-fold every rating, and the ratings around each game, from the game log; excluded games are voided for good |
| `tournament-create --name <text> --start <ISO time> --clock turn:<s>\|match:<min>+<s> [--opening <plies>] [--max <bots>]` | schedule a bot round robin 1 hour to 14 days ahead, at most 3 waiting; turn clock 5 to 60 s, or match clock 1 to 10 min plus 0 to 10 s; opening 1, 3, 5, 7, or 9 plies, default 5; 3 to 12 entries, default 12 |
| `tournament-cancel <tournamentId>` | end a waiting or running tournament as canceled |
| `tournament-schedule add --weekday <mon..sun> --time <HH:MM> --name <text> --clock turn:<s>\|match:<min>+<s> [--opening <plies>] [--max <bots>] [--ahead <days>]` | a weekly rule: each week's tournament starts on that weekday at that UTC time and is created `--ahead` days before, 1 to 14, default 7, opening it for entries; `{date}` in the name becomes the start's date, YYYY-MM-DD; clock, opening, and entries as for `tournament-create`; one rule per weekday and time |
| `tournament-schedule list` | the weekly rules with their ids and next starts |
| `tournament-schedule remove <ruleId>` | delete a weekly rule; the tournaments it created stay, and `tournament-cancel` ends a waiting one |
| `report-close <reportId>` | close a report from the site's report form; the reason is the note the report keeps |
| `duel-stop <duelId>` | stop a duel or test between bots: no further game starts, and a live one plays on to its result |

Every mutation takes `--reason` and writes an audit row.
`status` lists the running and waiting tournaments with their ids, the
weekly rules, and counts the running duels.
A weekly rule's tournament counts toward the 3 waiting: while they are full,
creation waits for a free slot.
A week whose tournament does not exist an hour before its start, from a full
waiting cap, downtime, or a clock step, is skipped, never created late.
Deleting a bot, by its owner or through `delete-user`, keeps a bot that has a
game with a winner against an account or a bot, or a tournament, under a
placeholder, its name still reserved, and deletes any other bot outright, its
guest games with it, freeing the name.
A person deleting their own account from the profile takes the `delete-user`
path, audited by `self`.

### Logs

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

## Break-glass

The app is wedged and the admin socket does not answer:

```sh
docker compose restart app
docker compose exec app hexo-arena-admin status
```

`restart` drains like an update.
To skip the drain, `docker compose kill -s SIGINT app` stops at once; the
next boot aborts every live game, unrated, and `docker compose start app`
brings it back.
The pause flag survives either way.

## Operator checklist

CI verifies the code, the image build, and the proxy's allowlist logic; the
rest only the server shows.
Run it from `~/hexo-arena` after the first deploy, and after changing the
host or the compose file.

Image:

- [ ] CI is green for the deployed commit and `docker compose pull` fetched
  its tag.
- [ ] `docker compose exec app node --version` prints v26, the image's
  Node; the proxy variables need 24.5 or later.
- [ ] `docker compose exec app id` shows uid 10001.
- [ ] `docker compose ps` shows `app` and `caddy` healthy.
- [ ] `docker compose exec caddy caddy version` shows the version the compose
  file's Caddy image names.

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
  The server).
- [ ] `docker compose exec app hexo-arena-admin pause --reason "checklist"`
  turns `curl -s -o /dev/null -w '%{http_code}' https://<domain>/healthz` to
  `503`, and `docker compose exec app hexo-arena-admin resume --reason "checklist"`
  back to `200`.

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

A bot end to end:

- [ ] A Discord sign-in completes and asks for a public name.
- [ ] On the Connect page (Build a bot), create a bot and copy its token.
- [ ] `curl -N -H 'authorization: Bearer <bot token>' https://<domain>/api/bot/stream`
  shows a bare newline every 10 s: nothing buffers.
- [ ] The Bot API's example bot, from the repository the site's Bot API link
  opens, plays a game end to end, engine websocket included: after
  `pip install websockets`, run
  `HEXO_TOKEN=<bot token> python3 examples/simple_bot.py https://<domain>`
  and play it from the Play page.
  The repository's own dev bots refuse any server without the dev login.
- [ ] `curl -s https://<domain>/bots/<bot name> | grep og:description`
  shows the bot's owner and rating; with the app stopped the same URL still
  answers the static shell.

Legal documents:

- [ ] `https://<domain>/legal/privacy` shows the operator's name and email and
  the host, the server location and the authority where `details.json` names
  them, and no `<` placeholder anywhere.
- [ ] With an Impressum, `https://<domain>/legal/imprint` shows the name,
  address, and email; without one it is not found and the footer links
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
