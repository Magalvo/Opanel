# WS-079 — Each production service gets only the secrets it needs

- Status: Approved (by the owner on 2026-11-19, every question as proposed)
- Work-item: [WI-079](../work-items/WI-079-production-secrets-split.md)
- Canonical docs: [0006](../canonical/0006-operations.md) sections 3 and 5;
  [WS-062](WS-062-production-image.md), [WS-063](WS-063-database-roles.md); audit of
  2026-11-19, finding B01

## Approach

### 1. What each service needs today

| Service   | Reads                                                                                                                       | Source                                                                                                                                                                                                          |
| --------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db`      | `POSTGRES_PASSWORD` (owner, used on a new volume), `OPANEL_APP_DB_PASSWORD` (init script)                                   | `compose.production.yaml:31-36`, `docker/production/init/01-runtime-role.sh:6`                                                                                                                                  |
| `migrate` | `MIGRATION_DATABASE_URL`; but `getMigrationDb` calls `getEnv()`, the full schema                                            | `src/server/db/client.ts:45`, `src/server/env.ts:25-70`: so `migrate` also requires `DATABASE_URL`, `BETTER_AUTH_SECRET` (32+ characters) and `APP_URL`, none of which it uses                                  |
| `app`     | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `APP_URL`, `SETUP_TOKEN` and `CLIENT_IP_HEADER` (optional); `NODE_ENV` from the image | `src/server/env.ts:29-69`, `Dockerfile:32`; `recover-admin.mjs` and `maintenance.mjs` run in the `app` service (`docs/operations.md`, sections "Recovering the last Admin" and "Maintenance") and need the same |

### 2. How Compose hands them over

Three ways were weighed:

- **A. One env file per service** (`.env.production.db`, `.app`, `.migrate`). Simple
  `env_file:` lines, but each password is written twice (the owner's in `db` and
  `migrate`, the app's in `db` and `app`), an existing install must split its file, and
  the `OPANEL_ENV_FILE` knob becomes three.
- **B. Compose interpolation with `--env-file .env.production`.** Each service lists its
  own `environment:` entries (`DATABASE_URL: ${DATABASE_URL}`). One file, unchanged. But
  interpolation reads `.env` beside the Compose file, or the files given by `--env-file`;
  every `docker compose` command of the guide (19 of them) gains a flag, forgetting it
  starts services with empty values, and `--env-file` stops Compose reading the `.env` the
  proxy's `OPANEL_SITE` lives in today (`compose.production.yaml:63-66`).
- **C. Interpolation through `include`** (proposed). `compose.production.yaml` keeps its
  name and its commands, and becomes a short file that includes the services, with the
  operator file as the included file's interpolation source:

  ```yaml
  include:
    - path: docker/production/services.yaml
      project_directory: .
      env_file: ${OPANEL_ENV_FILE:-.env.production}
  ```

  `docker/production/services.yaml` holds today's services, without any `env_file:`, and
  each service maps only its own names:
  - `db`: `POSTGRES_USER`, `POSTGRES_DB` (as now), `POSTGRES_PASSWORD`,
    `OPANEL_APP_DB_PASSWORD`.
  - `migrate`: `MIGRATION_DATABASE_URL`.
  - `app`: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `APP_URL`, `SETUP_TOKEN: ${SETUP_TOKEN:-}`,
    `CLIENT_IP_HEADER: ${CLIENT_IP_HEADER:-}` (an empty value already means "not set",
    `env.ts:38,57,66`).
  - `proxy`: `OPANEL_SITE`, `OPANEL_CADDY_TLS`, as now.

  The operator's file, the `OPANEL_ENV_FILE` knob and every command of the guide stay as
  they are. Hard rule 13: `include` with `env_file` and `project_directory` was probed on
  2026-11-19 against the installed Docker Compose v5.6.0, with a two-service sketch of this
  layout: `docker compose config` gave each service only the names it maps, filled from
  `.env.production`, and from `.env.smoke` when `OPANEL_ENV_FILE=.env.smoke` was set; an
  unset `SETUP_TOKEN` became `""`. Should a later Compose behave otherwise, the fallback is
  B, raised with the owner first.

The values are passed as given, not rebuilt from the passwords (`DATABASE_URL` is not
derived from `OPANEL_APP_DB_PASSWORD`), so an install that points at another database keeps
working.

### 3. `migrate` validates only its connection

`src/server/env.ts` gains `parseMigrationEnv(source)` and `getMigrationEnv()`, a separate
schema with `NODE_ENV`, `MIGRATION_DATABASE_URL` and `DATABASE_URL`, both optional and both
checked as `postgres://` URLs as now (`env.ts:29-41`), refined so that at least one is set;
otherwise an `EnvValidationError` naming `MIGRATION_DATABASE_URL`. `migrationDatabaseUrl`
(`env.ts:75-77`) takes this narrower type. `getMigrationDb` (`client.ts:43-49`) uses it;
`scripts/migrate.ts:11-17` already prints an `EnvValidationError` and exits 1. The app's
`getEnv()` and `envSchema` do not change. In development `pnpm db:migrate` keeps falling
back to `DATABASE_URL`.

### 4. The smoke test checks it

`scripts/smoke-production.sh` (run by `.github/workflows/image.yml:61-62`, its own Compose
project and throwaway `.env.smoke` via `OPANEL_ENV_FILE`, `:13-15,33-41`) gains a step after
"the app answers healthy" (`:54-68`): for each of `app`, `db` and `migrate` (the exited
container, `compose ps -aq migrate`), it reads the variable **names** with
`docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' | cut -d= -f1`, and
fails naming any forbidden one (WI-079 criteria 1 to 3). No value is printed, so CI logs
hold no secret. `docker inspect` needs no shell in the image and works on an exited
container. The workflow already runs on changes to `compose.production.yaml` and `docker/**`
(`image.yml:17,27`); it needs no change.

### 5. The documents

- `docs/operations.md`: "Install" step 1 (`:41-53`) says the file holds every secret and
  Compose hands each service only its own; the proxy note (`:97-100`) says `OPANEL_SITE` may
  now also live in `.env.production`. "Upgrade" (`:149-188`) gains a paragraph, not a `##`
  heading (the test fixes the sections, `operations-guide.test.ts:20-31`): the env file is
  unchanged; step 3's `up -d` recreates `db`, `migrate` and `app` with the narrower
  environments (the data volume is kept); a locally edited `compose.production.yaml` must
  carry its changes over to `docker/production/services.yaml`.
- `scripts/doc-checks.ts:98-106`: Compose variables are read from both Compose files; the
  special list of database variables goes, since the services file now names them.
- `.env.production.example`: each variable's comment names the service that receives it.
- Canonical doc 0006, section 5, a new bullet: "Each service of the example install gets
  only its own variables. The app's environment holds no owner credential
  (`MIGRATION_DATABASE_URL`, `POSTGRES_PASSWORD`); the database's holds no app secret;
  `migrate` holds only the owner's connection (amended by WS-079)." Section 3 (`:50-52`)
  points to it.

## Files

| Path                                          | Change                                                       |
| --------------------------------------------- | ------------------------------------------------------------ |
| `compose.production.yaml`                     | modify: the `include` of section 2                           |
| `docker/production/services.yaml`             | create: the services, per-service `environment:`             |
| `src/server/env.ts`, `src/server/env.test.ts` | modify: `parseMigrationEnv`, `getMigrationEnv` (tests first) |
| `src/server/db/client.ts`                     | modify: `getMigrationDb` uses `getMigrationEnv()`            |
| `scripts/smoke-production.sh`                 | modify: the environment check of section 4                   |
| `scripts/doc-checks.ts`                       | modify: read both Compose files                              |
| `.env.production.example`                     | modify: comments                                             |
| `docs/operations.md`                          | modify: "Install" and "Upgrade"                              |
| `docs/canonical/0006-operations.md`           | modify: sections 3 and 5                                     |
| `docs/README.md`, WI-079, WS-079              | modify: statuses                                             |

No new dependency, no migration.

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                                                                             | Covers criterion |
| --- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | smoke | `smoke-production.sh`: the names in `app`, `db` and `migrate` include none of the forbidden ones; fails today on all three (run before the Compose change)                       | criteria 1 to 3  |
| 2   | unit  | `parseMigrationEnv({ MIGRATION_DATABASE_URL })` succeeds without `BETTER_AUTH_SECRET`, `APP_URL` or `DATABASE_URL` (fails before: no such function)                              | criterion 4      |
| 3   | unit  | it falls back to `DATABASE_URL`; with neither, or with a non-`postgres://` value, it throws an `EnvValidationError` naming `MIGRATION_DATABASE_URL` whose message holds no value | criterion 4      |
| 4   | unit  | the existing `MIGRATION_DATABASE_URL (WS-063)` cases (`env.test.ts:186-212`) kept against the new type                                                                           | criterion 4      |
| 5   | smoke | every existing step still passes: `migrate` exits 0 (`:46-52`), wrong owner password fails unprinted (`:109-117`), setup token, `recover-admin`, `maintenance`                   | criteria 3, 6    |
| 6   | smoke | `smoke-proxy.sh` (proxy still gets `OPANEL_SITE`) and `rehearse-backup.sh` (`pg_dump` as the owner inside `db`) pass                                                             | criterion 6      |
| 7   | unit  | `operations-guide.test.ts`: the guide names only known variables with both Compose files read                                                                                    | criterion 8      |
| 8   | gate  | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; then the image workflow                                                                                                 | criteria 5, 9    |

## Risks and open questions

- `docker compose config` still prints every interpolated value, as it does today with
  `env_file`. That command is the operator's, not a service's; out of scope.
- `db` keeps `OPANEL_APP_DB_PASSWORD` after the volume is initialised: the official image
  reads its environment only at container creation. It already holds the owner's password,
  so this widens nothing.

For the owner:

1. **The mechanism: `include` with an interpolation `env_file` (C), `--env-file` on every
   command (B), or one file per service (A).** C keeps the operator's file, the knob and
   the guide's commands; B adds a flag to 19 commands and drops `.env`; A duplicates the
   passwords and splits existing files. **Recommend: C, which behaves as described on the
   installed Compose v5.6.0 (section 2); B is the fallback.**
2. **`migrate` gets a narrower parser, rather than receiving `BETTER_AUTH_SECRET` and
   `APP_URL` it never uses.** Passing them would keep the code unchanged but leave the
   session secret in a second container. **Recommend: the narrower parser.**
3. **Values passed as given, not `DATABASE_URL` rebuilt from `OPANEL_APP_DB_PASSWORD`.**
   Rebuilding would remove one duplication from the env file but break installs on another
   database host. **Recommend: passed as given.**
4. **Upgrade by documentation only, no script.** An existing `.env.production` works
   unchanged; only a locally edited `compose.production.yaml` needs carrying over.
   **Recommend: a paragraph in "Upgrade", no script.**

## Deviations from the approved spec

None yet.

## Implementation record

Not started.
