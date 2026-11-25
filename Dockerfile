# syntax=docker/dockerfile:1
# Opanel's production image (WS-062, canonical doc 0006 section 3). It runs the app with
# `next start`, and one-shot commands: `node dist/migrate.mjs`, and
# `node dist/recover-admin.mjs --email <admin email>` (WS-065), `node dist/maintenance.mjs`
# (WS-066). Every
# setting comes from the environment at run time; nothing secret is built in.

# Node.js 22.23.5, the major version of .nvmrc, pinned by digest on 2026-11-25 (WS-127):
# the same revision always builds on the same base. Update it with CONTRIBUTING.md,
# "Image pins"; change the major version only together with .nvmrc.
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb

FROM ${NODE_IMAGE} AS base
ENV NEXT_TELEMETRY_DISABLED=1
# The pnpm of `packageManager` in package.json.
RUN corepack enable
WORKDIR /app

# Every dependency, to build.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build && pnpm build:commands

# Production dependencies only, for the image that runs.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/next.config.ts ./
COPY --from=build /app/src/server/db/migrations ./src/server/db/migrations
COPY --from=build /app/dist/migrate.mjs /app/dist/recover-admin.mjs /app/dist/maintenance.mjs ./dist/
# `next start` writes its cache under .next, so the app's user owns it.
COPY --from=build --chown=node:node /app/.next ./.next
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
