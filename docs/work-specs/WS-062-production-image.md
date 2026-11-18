# WS-062 — Production image, example Compose file and `migrate`

- Status: Done (approved by the owner on 2026-11-18, questions 1 to 5 as proposed)
- Work-item: [WI-062](../work-items/WI-062-production-image.md)
- Canonical docs: [0006](../canonical/0006-operations.md) (sections 3, 6 and 9);
  [0002](../canonical/0002-realtime-sync.md) (one long-lived process);
  [WS-003](WS-003-validated-env.md) (environment validation),
  [WS-055](WS-055-setup-fail-closed.md) (setup token in production),
  [WS-060](WS-060-portable-formatting.md) (toolchain of reference)

## Approach

### 1. Where things stand (checked on 2026-11-18)

- Next.js 16.4.6. `next.config.ts` has no `output`. The installed docs
  (`docs/01-app/03-api-reference/05-config/01-next-config-js/output.md`,
  `docs/01-app/02-guides/self-hosting.md`) describe `output: "standalone"`: a traced
  `server.js` that replaces `next start`, without `.next/static`, which must be copied.
- `pnpm db:migrate` runs `scripts/migrate.ts` with `tsx` (a development dependency); the
  migrations are read from `process.cwd()/src/server/db/migrations`. The script uses the
  database client, so it validates the whole environment (`DATABASE_URL`,
  `BETTER_AUTH_SECRET`, `APP_URL`).
- `src/instrumentation.ts` validates the environment when the server starts and exits on a
  bad one. `NODE_ENV=production` requires `SETUP_TOKEN` for the first-run setup.
- No `public/` directory. `GET /api/v1/health` answers `503` without the database.
- `esbuild` 0.28.2 is already in the lockfile (through Vite and `tsx`), not a direct
  dependency.

### 2. The image

A multi-stage `Dockerfile`:

1. **`deps`**: `node:22-bookworm-slim`, pinned by digest; `corepack enable`; copy
   `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`; `pnpm install
--frozen-lockfile`.
2. **`build`**: from `deps`; copy the source; `pnpm build` (`next build`), and bundle the
   migration command (section 3).
3. **`prod-deps`**: from the same base; `pnpm install --frozen-lockfile --prod`.
4. **`runtime`**: from the same base; `NODE_ENV=production`; copy `node_modules` from
   `prod-deps`, and from `build` the `.next` directory, `next.config.ts`, `package.json`,
   `src/server/db/migrations` and `dist/migrate.mjs`; `USER node`; `EXPOSE 3000`;
   `HEALTHCHECK` with Node's `fetch` against `http://127.0.0.1:3000/api/v1/health`;
   `CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]`.

`bookworm-slim` (glibc) rather than Alpine: `@node-rs/argon2` and Next.js's SWC ship
prebuilt glibc binaries, and the CI runs on glibc too.

**`next start`, not `output: "standalone"`** (open question 1): the image then runs the
same server as the end-to-end tests and CI, `next.config.ts` stays unchanged, and nothing
depends on file tracing finding every file (the docs list cases where it does not). The
cost is a larger image: every production dependency, not only the traced files.

No secret is baked in: every variable comes from the environment at run time, and the
build does not need them (checked while implementing; if `next build` needs a value, a
placeholder used only at build time is documented in the deviations).

### 3. `migrate` without `tsx`

`scripts/migrate.ts` is bundled at image build time into `dist/migrate.mjs` with esbuild
(`--bundle --platform=node --format=esm --packages=external`, the `@/` alias from
`tsconfig.json`). Its imports stay external and come from the production
`node_modules` (`drizzle-orm`, `postgres`, `zod`). It runs as
`docker compose run --rm migrate`, or, in the example, as the one-shot `migrate` service:
`["node", "dist/migrate.mjs"]`.

This adds `esbuild` 0.28.2 as a pinned development dependency (the version the lockfile
already holds), and a script `build:migrate`. `pnpm db:migrate` with `tsx` is unchanged for
development (open question 2).

A failed connection: the script prints the error through `describeError` (WS-042), never
the connection string, and exits `1`.

### 4. `compose.production.yaml`

An example, commented, not the only supported setup (doc 0006 section 3):

- `db`: `postgres:18-alpine`, a named volume, a health check, no published port;
  `POSTGRES_PASSWORD` from the env file.
- `migrate`: the app image, `command: ["node", "dist/migrate.mjs"]`, `restart: "no"`,
  `depends_on: db: condition: service_healthy`.
- `app`: the app image, `depends_on: migrate: condition: service_completed_successfully`,
  `restart: unless-stopped`, `ports: ["127.0.0.1:3000:3000"]` (the reverse proxy runs on
  the host or joins the network; doc 0006 section 4, item F and the guide, item H).
- Both read `env_file: .env.production`. A new `.env.production.example` lists the
  variables with placeholders and how to generate the secrets; `.env.production` is
  ignored by git (`.gitignore` already ignores `.env*` but the examples).

One database role for now: item B splits it.

### 5. `.dockerignore`

`node_modules`, `.next`, `.git`, `.github`, `.claude`, `coverage`, `test-results`,
`playwright-report`, `blob-report`, `docs`, `tests`, `*.log`, `.env*` except
`.env.example` and `.env.production.example`.

### 6. CI: the image job

A workflow `image.yml`, on pull requests and pushes to `main` that change the
`Dockerfile`, `.dockerignore`, `compose.production.yaml`, `package.json`,
`pnpm-lock.yaml`, `next.config.ts`, `src/**` or `scripts/**`, weekly, and by hand. It runs
`scripts/smoke-production.sh`, which also runs locally:

1. writes a throwaway `.env.production` (random secrets, `APP_URL=http://localhost:3000`,
   a `SETUP_TOKEN`);
2. `docker compose -f compose.production.yaml up -d --build --wait`;
3. checks: `migrate` exited `0`; `GET /api/v1/health` is `200`; the `app` container is
   `healthy`; `POST /api/v1/setup` without the token is `403`; the app's process user is
   not root; `docker run --rm <image> ls node_modules/.bin` has no `tsx`, `vitest`,
   `playwright` or `drizzle-kit`; `migrate` run again exits `0`;
4. with a wrong `DATABASE_URL`, `migrate` exits non-zero and its output contains no
   password;
5. `down -v` in every case.

It is not part of the quality gate of `AGENTS.md` section 5 (it needs Docker); it is its
own required check.

### Considered and not chosen

- **`output: "standalone"`**: smaller image, but a different server than the one tested,
  and file tracing to trust (open question 1).
- **Run migrations at app start-up**: doc 0006 section 6 decided against it.
- **The `build` stage as the `migrate` image** (with every development dependency): no
  esbuild, but a second, much larger image to pull and keep patched.
- **Alpine**: musl builds of the native modules, a platform no test runs on.

## Files

| Path                                                 | Change                                           |
| ---------------------------------------------------- | ------------------------------------------------ |
| `Dockerfile`, `.dockerignore`                        | create: sections 2 and 5                         |
| `compose.production.yaml`, `.env.production.example` | create: section 4                                |
| `scripts/migrate.ts`                                 | modify: safe error output and exit code          |
| `scripts/smoke-production.sh`                        | create: section 6                                |
| `.github/workflows/image.yml`                        | create: section 6                                |
| `package.json`, `pnpm-lock.yaml`                     | modify: `esbuild` devDependency, `build:migrate` |
| `README.md`                                          | modify: a short "Production" pointer             |
| `docs/README.md`, WT-12, WI-062, WS-062              | modify: statuses                                 |

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                           | Covers criterion |
| --- | ----------- | -------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | integration | `scripts/migrate.ts`'s error path: an unreachable database exits `1`, prints `describeError` only, not the URL | 2                |
| 2   | smoke       | `scripts/smoke-production.sh` before the `Dockerfile` exists: fails (red, recorded)                            | 1–6              |
| 3   | smoke       | the same script after: every check of section 6 passes, locally (Docker Desktop) and in CI                     | 1–6              |
| 4   | CI          | `image.yml` passes on the pull request                                                                         | 7                |
| 5   | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`: unchanged and green                                   | 8                |

## Risks and open questions

For the owner:

1. **`next start` in the image rather than `output: "standalone"`** (section 2): a larger
   image, the server already tested. **Recommend: `next start`.**
2. **`esbuild` 0.28.2 as a direct development dependency**, to bundle `migrate` (section 3).
   It is already in the lockfile. Not in the stack table of `AGENTS.md`, which names
   concerns, not build helpers. **Recommend: add it.**
3. **`node:22-bookworm-slim` pinned by digest**, updated by hand with the Node.js version
   of `.nvmrc`. **Recommend: as proposed.**
4. **The image job as its own workflow and required check**, not part of the five-step
   gate (section 6). **Recommend: as proposed.**
5. **App published on `127.0.0.1:3000`** in the example, so it is reachable only through
   the operator's reverse proxy. **Recommend: as proposed.**

## Deviations from the approved spec

1. **The command's logic is `src/server/db/migrate-command.ts`**, so it is tested as an
   integration test like any service; `scripts/migrate.ts` only loads the environment,
   runs it and sets the exit code. A bad environment prints the validation message, which
   names variables only (WS-003).
2. **`tests` stays in the build context.** `next build` type-checks the whole project,
   `playwright.config.ts` and its helpers included; the first build failed without them.
   `docs` and the other paths of section 5 are excluded.
3. **Compose reads the env file from `OPANEL_ENV_FILE`** (default `.env.production`) and
   publishes the app on `OPANEL_PORT` (default 3000), so the smoke test uses its own
   throwaway file and port without touching an operator's. The `db` service reads
   `POSTGRES_PASSWORD` from the same file.
4. **One more smoke check**: the app started with `APP_URL=not-a-url` exits with the
   validation message (acceptance criterion 3).
5. **`dist/` is ignored by git and ESLint**; it only holds the bundled `migrate.mjs`.
6. **`next build` needed no environment variable**, as section 2 expected: no build-time
   placeholder.

## Implementation record

- Red:
  - the integration test of `migrateCommand` failed before the module existed;
  - `scripts/smoke-production.sh` failed before `compose.production.yaml` and the
    `Dockerfile` existed.
- Green:
  - `migrateCommand`, and `scripts/migrate.ts` on top of it;
  - `esbuild` 0.28.2 and `build:migrate`; the bundle resolves the `@/` alias and leaves
    only `drizzle-orm`, `postgres`, `zod` and Node.js built-ins external; run locally, it
    migrates (exit 0) and, with a wrong password, prints
    `Migrations failed: DrizzleQueryError code=28P01` (exit 1);
  - `Dockerfile` on `node:22-bookworm-slim@sha256:e9f565d3…` (Node.js 22.23.5);
  - `.dockerignore`, `compose.production.yaml`, `.env.production.example`, a README
    pointer, `.github/workflows/image.yml`.
- `scripts/smoke-production.sh` passed every check locally (Docker 29.9.1, Compose 5.6.0):
  - migrate once, then health 200 and a healthy container;
  - setup 403 without the token, a loopback-only binding and a non-root user;
  - no development binary in the image;
  - a second migrate exits 0, and a wrong password fails without printing it;
  - a bad environment stops the app.
- Image size reported by Docker Desktop: 1.63 GB (every production dependency, as question
  1 accepted).
- `pnpm openapi:generate` and `pnpm db:generate`: no change.
- Gate on 2026-11-18:
  - typecheck and lint pass; Prettier passes on the whole repository;
  - Vitest 1247 of 1247;
  - `pnpm test:e2e` 79 of 79 with `--retries=0`;
  - Windows, Node 24, pnpm 10.28.0, Compose PostgreSQL on port 5433.
