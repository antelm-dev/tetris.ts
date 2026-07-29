# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION} AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

WORKDIR /workspace

# pnpm's legacy workspace deploy revalidates Git-backed entries in the shared
# lockfile. Git is needed only in this disposable build stage and is absent
# from both runtime images.
RUN apt-get update && \
    apt-get install --no-install-recommends --yes git ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    corepack enable && \
    corepack prepare pnpm@10.28.2 --activate

COPY . .

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Build the playable browser client, then bundle its small Express host so the
# final web image does not need the monorepo or Electron's build dependencies.
RUN pnpm build:web && \
    pnpm exec esbuild apps/tetris/server/index.mjs \
      --bundle \
      --platform=node \
      --format=cjs \
      --target=node22 \
      --outfile=/tmp/web/server/index.cjs && \
    cp -R apps/tetris/dist-web /tmp/web/dist-web

# Build and deploy the API with production dependencies only. --legacy makes
# pnpm package local workspace dependencies (notably @tetris/protocol) into the
# deploy directory instead of leaving links back into the build workspace.
RUN pnpm build:api && \
    pnpm --config.ignore-scripts=true --filter @tetris/api deploy --prod --legacy /tmp/api


FROM node:${NODE_VERSION} AS web

ENV NODE_ENV=production
ENV PORT=4000

WORKDIR /app/apps/tetris

COPY --from=builder --chown=node:node /tmp/web/server ./server
COPY --from=builder --chown=node:node /tmp/web/dist-web ./dist-web

RUN mkdir -p server/data && chown node:node server/data

USER node
EXPOSE 4000

CMD ["node", "server/index.cjs"]


FROM node:${NODE_VERSION} AS api

WORKDIR /app

COPY --from=builder --chown=node:node /tmp/api ./

USER node
EXPOSE 3000

CMD ["node", "dist/main.js"]
