FROM node:24-slim

RUN npm install --global pnpm@12.6.0

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contract/package.json packages/contract/package.json

# Manifests are copied before the sources so source edits never bust the
# dependency layer.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

# The dev services run as uid 1000 and must write vite caches and the
# sqlite volume.
RUN chmod -R a+w node_modules apps packages \
    && mkdir /data \
    && chown node:node /data

COPY . .

# The admin client ships in the image, so `docker compose exec server
# hexarena-admin ...` always matches the server it talks to.
RUN ln -s /app/apps/server/bin/hexarena-admin /usr/local/bin/hexarena-admin

USER node
