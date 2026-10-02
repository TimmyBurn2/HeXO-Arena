#!/bin/sh
# Moves this deployment to the image built from one commit:
# ./update.sh <full commit sha>, kept beside compose.yml and .env.
set -eu

refuse() {
    echo "usage: $0 <full 40-character commit sha>" >&2
    exit 2
}

# CI tags each image sha-<full commit sha>; nothing shorter names one.
[ "$#" -eq 1 ] || refuse
case $1 in
    '' | *[!0-9a-f]*) refuse ;;
esac
[ "${#1}" -eq 40 ] || refuse
sha=$1

cd "$(dirname "$0")"

if [ ! -f compose.yml ] || [ "$(grep -c '^HEXO_ARENA_IMAGE=' .env 2>/dev/null)" != 1 ]; then
    echo "$(pwd) needs compose.yml and a .env with one HEXO_ARENA_IMAGE line" >&2
    exit 1
fi
current=$(sed -n 's/^HEXO_ARENA_IMAGE=//p' .env)
# Compose reads a quoted value as well.
current=${current#[\"\']}
current=${current%[\"\']}

# Only the tag moves; it follows the last slash, so a registry's port is
# never taken for one.
name=${current%@*}
case ${name##*/} in
    *:*) name=${name%:*} ;;
esac
image=$name:sha-$sha

# A wedged or crashing app is what an update or a rollback often fixes,
# so a status that fails stops nothing.
docker compose exec -T app hexo-arena-admin status || echo "the app did not answer; updating anyway" >&2

# Migrations only go forward: this backup, the database as the update
# found it, is the way back across one, and no later backup replaces it.
docker compose exec -T app hexo-arena-admin backup pre-update || echo "no backup written; updating anyway" >&2

# Pulled before .env names it, so a commit without an image leaves the
# deployment as it was.
HEXO_ARENA_IMAGE=$image docker compose pull

# Written back in place, so .env keeps its owner and mode.
updated=$(sed "s|^HEXO_ARENA_IMAGE=.*|HEXO_ARENA_IMAGE=$image|" .env)
printf '%s\n' "$updated" > .env
echo "HEXO_ARENA_IMAGE: $current -> $image"

docker compose up -d

# The new app opens its admin socket a moment after its container starts.
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29; do
    docker compose exec -T app hexo-arena-admin status 2>/dev/null && exit 0
    sleep 2
done
docker compose exec -T app hexo-arena-admin status
