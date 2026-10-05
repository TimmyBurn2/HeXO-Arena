# Both stages pin the multi-arch index by digest: a moved tag never changes
# what a build starts from.
FROM node:26-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1 AS build

RUN npm install --global pnpm@12.6.0

WORKDIR /src

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contract/package.json packages/contract/package.json
COPY packages/rules/package.json packages/rules/package.json

# Manifests are copied before the sources so source edits never bust the
# dependency layer.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

COPY . .

RUN pnpm build \
    && pnpm --filter @hexo-arena/server deploy --prod /out

# better-sqlite3 ships a binary for every platform and the SQLite sources to
# build one; the image keeps its own platform's binary, which the package
# loads by name, and proves it loads.
RUN cd /out/node_modules/better-sqlite3 \
    && rm -rf deps src binding.gyp \
    && find prebuilds -type f ! -name "linux-$(node -p process.arch).node" -delete \
    && cd /out && node -e "new (require('better-sqlite3'))(':memory:').close()"

FROM node:26-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1

# The app needs node alone; a package manager left in would only serve
# whoever got a shell.
# A dedicated uid that matches nothing on the host.
# A fresh named volume takes the owner of its mount point, so every
# directory a volume or tmpfs lands on exists here, owned by that uid.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
        /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v* \
    && groupadd --gid 10001 hexo-arena \
    && useradd --uid 10001 --gid hexo-arena --no-create-home --shell /usr/sbin/nologin hexo-arena \
    && mkdir -p /data /backup /run/hexo-arena /srv/web \
    && chown hexo-arena:hexo-arena /data /backup /run/hexo-arena /srv/web \
    && chmod 0700 /run/hexo-arena

WORKDIR /app

COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
# The static site rides along so one pulled tag carries a matching front
# end; a one-shot service copies it into the volume the proxy serves.
COPY --from=build /src/apps/web/dist ./web
COPY docker/prod/hexo-arena-admin /usr/local/bin/hexo-arena-admin

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/hexo-arena.sqlite \
    ADMIN_SOCKET_PATH=/run/hexo-arena/admin.sock \
    BACKUP_DIR=/backup \
    LEGAL_DIR=/srv/legal

USER hexo-arena

EXPOSE 3000

# Liveness only: /healthz answers 503 while paused or draining, and a
# paused process is healthy, so any answer at all passes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(() => process.exit(0), () => process.exit(1))"]

CMD ["node", "--max-old-space-size=256", "dist/index.js"]
