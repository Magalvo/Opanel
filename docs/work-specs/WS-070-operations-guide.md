# WS-070 — The operations guide, `docs/operations.md`

- Status: Approved (by the owner on 2026-11-19, questions 1 to 6 as proposed)
- Work-item: [WI-070](../work-items/WI-070-operations-guide.md)
- Canonical docs: [0006](../canonical/0006-operations.md) (the whole doc; section 4: the
  proxy; section 6: upgrades; section 8: backup, retention, storage; section 10: logs);
  [0002](../canonical/0002-realtime-sync.md) (one process, SSE);
  [WS-062](WS-062-production-image.md) to [WS-069](WS-069-safe-logs.md) (what the guide
  describes); [WS-068](WS-068-backup-rehearsal.md) question 4 (the upgrade criterion)

## Approach

### 1. Where things stand (checked on 2026-11-19, `main` at `202bb71`)

- Everything the guide describes exists and CI rehearses it in the image workflow
  (`.github/workflows/image.yml`): the example install, migrate, health, the setup token,
  `recover-admin` and safe logs (`smoke-production.sh`); HSTS, the body limit and the
  unbuffered events stream behind Caddy (`smoke-proxy.sh`); a backup restored into a new
  install (`rehearse-backup.sh`). `maintenance` is covered by its integration tests.
- The operator's documentation is `README.md` "Running in production" (one paragraph or
  command per piece) and the comments of `compose.production.yaml`,
  `.env.production.example` and `docker/production/Caddyfile`. The README still says
  "The full operations guide comes with WT-12".
- What is written nowhere: the upgrade procedure; restoring (only the rehearsal script
  shows it); installing on the operator's own PostgreSQL (the runtime role and its
  grants); the nginx settings; storage growth; log access and retention.
- The example install sets no log rotation: Docker's default `json-file` driver keeps the
  app's standard output without limit.
- No release is tagged yet, so the image is built from a checkout (`build: .`); an upgrade
  means checking out a newer commit or tag and rebuilding.

### 2. The guide

`docs/operations.md`, for an operator who knows Docker and PostgreSQL but not Opanel. Plain
prose and `bash` blocks, the same voice as the README. Sections, in order:

1. **Before you start**: a Linux host with Docker Compose; a public name and a reverse
   proxy that terminates HTTPS; exactly one app process (doc 0002: the event hub is in
   memory), no serverless or edge hosting; what the example install contains and that it
   is an example (doc 0006 section 3).
2. **Install**: copy `.env.production.example`, generate each secret, `up -d --build`;
   `migrate` runs once before the app; open `APP_URL`, create the first Admin with
   `SETUP_TOKEN`, then remove it. Where the data lives (the `db-data` volume) and that the
   env file must be kept with the backups.
3. **Reverse proxy and HTTPS**: the four requirements of doc 0006 section 4, each with
   why; the Caddy example (`--profile proxy`, `OPANEL_SITE`); the same four as nginx
   settings (`proxy_pass`, `proxy_set_header X-Forwarded-For $remote_addr`,
   `client_max_body_size 1m`, `proxy_buffering off` and `proxy_read_timeout` for
   `/api/v1/projects/`, the HTTP-to-HTTPS redirect), marked as not rehearsed by CI; HSTS
   is sent by Opanel when `APP_URL` is `https:`; `CLIENT_IP_HEADER` and the start-up
   warning when it is missing.
4. **Upgrade**: back up; check out the new version; build; stop the app; run `migrate`;
   start; check health. A failed migration leaves the old schema; the app refuses a schema
   it does not match and names both versions (WS-064); going back means restoring the
   backup with the previous version. No zero-downtime upgrade. Marked as not yet rehearsed
   from a release (section 4 below).
5. **Backup and restore**: `pg_dump --format=custom` as the owner while the app runs, a
   schedule of the operator's choosing, keep the env file; restoring into a new install
   (the steps of `rehearse-backup.sh`: `down -v`, `up -d db`, wait, `pg_restore
--exit-on-error`, `up -d`); on the operator's own PostgreSQL, create the owner and the
   `opanel_app` login role first (the SQL of `docker/production/init/01-runtime-role.sh`),
   or the restored grants fail (WS-068, question 2).
6. **Recovering the last Admin**: `recover-admin --email`, what it refuses, that the link
   is printed once and audited with `via: "operator"`.
7. **Maintenance**: the daily command, what it deletes and what it never touches; a cron
   line as the example.
8. **Health and outages**: `GET /api/v1/health`, the image's health check; while the
   database is down requests answer `500` with no detail and the app recovers by itself.
9. **Storage**: the tables that grow (`audit_log`, `task_events`, `comments`, kept for the
   life of the install) and one query, run as the owner through `docker compose exec db
psql`, listing each table's total size, largest first.
10. **Logs**: standard output only; `docker compose logs app`; what Opanel's own lines
    contain (no secrets, errors as `describeError`: class, code, constraint, WS-042 and
    WS-069), that this applies to Next.js and Better Auth too in production, and what they
    do contain (paths of failed requests, the start-up warnings); access is whoever can run
    Docker on the host; retention is the operator's, with the example's rotation
    (section 3).

### 3. Log rotation in the example install

`compose.production.yaml` gives every service the `json-file` driver with `max-size: 10m`
and `max-file: "5"` (one `x-logging` anchor), so the example install keeps at most 50 MB of
logs per service. The smoke test needs no change: `docker compose logs` reads the same
driver. Open question 2.

### 4. Commands that CI runs, and the ones it does not

Each command of the guide for the example install is copied from the CI script that runs
it, with `-p "$PROJECT"` dropped. Two are not rehearsed and the guide says so in one line
each:

- **The nginx settings** (doc 0006 section 4 asks for settings only, Caddy being the
  tested example).
- **An upgrade from a release**: there is none yet. As approved in WS-068 question 4,
  WT-12's upgrade criterion is recorded as covered by today's checks (each migration is
  tested against a database built by the earlier ones, WS-063, and the schema check
  refuses a mismatch, WS-064), and a Follow-up asks to rehearse a real upgrade, from the
  first tagged release to the next, once there is one.

### 5. A test that keeps the guide in step

`scripts/operations-guide.test.ts` (Vitest, the `unit` project already includes
`scripts/**/*.test.ts`) reads `docs/operations.md` and checks:

- every `dist/<name>.mjs` in it is copied by the `Dockerfile` into the runtime image;
- every `UPPER_CASE` variable it puts in an env file or the shell (`NAME=`, or in backticks
  followed by "in `.env.production`") is in `.env.production.example`, and is a key of the
  env schema of `src/server/env.ts` unless it belongs to the Compose file
  (`POSTGRES_PASSWORD`, `OPANEL_APP_DB_PASSWORD`, `OPANEL_SITE`, `OPANEL_*_PORT`, listed in
  the test with the reason);
- every relative link and every backticked path of a repository file resolves to a file
  that exists;
- the headings of section 2 are there, in order (criterion 1).

It does not try to run the commands: CI already runs them through the scripts.

### 6. The README and the docs

- `README.md` "Running in production": one paragraph (what the image and example install
  are, the one-process rule) and a link to `docs/operations.md`; the commands move to the
  guide. The `.env.production.example` header and `compose.production.yaml` comment point
  to the guide.
- WT-12: exit criteria ticked, each with its item or test; status `Done`.
- `docs/README.md`: the index rows; "Where the project stands"; the Follow-up "No
  work-track covers production deployment" removed, its questions answered by the guide's
  sections; the line "Planned in WT-12" removed; a new Follow-up for the upgrade rehearsal.
  "Create the first Admin through a command" stays.
- Doc 0006: no decision changes. Section 10's last sentence ("after the check that WS-042
  left open") gets "(done in WI-069)". Owner's approval is asked for that one line here.

### Considered and not chosen

- **Keeping everything in the README**: it is the developer's entry point, and the guide is
  ten sections long.
- **Running the guide's `bash` blocks in CI** (extracting and executing them): the commands
  need a public name, real secrets and minutes of waiting each; the scripts already run the
  same commands with test values. Section 5's test checks what can drift cheaply.
- **A tested nginx example** like the Caddy one: doc 0006 question 2 decided settings only.

## Files

| Path                                    | Change                                                       |
| --------------------------------------- | ------------------------------------------------------------ |
| `docs/operations.md`                    | create: section 2                                            |
| `scripts/operations-guide.test.ts`      | create: section 5                                            |
| `compose.production.yaml`               | modify: log rotation (section 3); a pointer to the guide     |
| `.env.production.example`               | modify: header points to the guide                           |
| `README.md`                             | modify: "Running in production" becomes a summary and a link |
| `docs/canonical/0006-operations.md`     | modify: one line in section 10 (section 6)                   |
| `docs/README.md`, WT-12, WI-070, WS-070 | modify: statuses, exit criteria, Follow-ups                  |

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level  | Test                                                                                                                                 | Covers criterion |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 1   | unit   | `operations-guide.test.ts` before the guide exists: fails on the missing file (red, recorded)                                        | 3                |
| 2   | unit   | the same test against a temporary copy naming `dist/nope.mjs`, an unknown variable and a missing file: each fails (red, recorded)    | 3                |
| 3   | unit   | with the guide written: passes, headings in order                                                                                    | 1, 3             |
| 4   | manual | on the example install (`smoke-production.sh` left running, or a local `up -d`): the storage query lists the three tables with sizes | 4                |
| 5   | manual | a side-by-side check that each example-install command in the guide matches its CI script line; the two unrehearsed ones are marked  | 2                |
| 6   | smoke  | `smoke-production.sh`, `smoke-proxy.sh` and `rehearse-backup.sh` pass with the log rotation; `docker inspect` shows `max-size`       | 8                |
| 7   | gate   | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                              | 8                |

Criteria 5, 6 and 7 are doc changes checked in review.

## Risks and open questions

For the owner:

1. **The guide's shape** (section 2): one file, ten sections, the example install first
   and the operator's own PostgreSQL only where it differs (roles, restore).
   **Recommend: as proposed.**
2. **Log rotation in the example install** (section 3), 10 MB × 5 files per service,
   rather than only telling operators to configure it. A small config change in a docs
   item; without it the example fills the disk slowly. **Recommend: add it.**
3. **The test of section 5**, rather than review alone. It catches a renamed command, a
   renamed variable or a moved file, which is how a guide goes stale. **Recommend: add
   it.**
4. **The upgrade criterion** recorded as covered by today's checks, with a Follow-up for
   a rehearsal after the first tagged release (WS-068, question 4, already approved).
   WT-12 then closes now rather than waiting for a release. **Recommend: as proposed.**
5. **The one line in doc 0006 section 10** (section 6). **Recommend: as proposed.**
6. **Cutting the README's production section to a link**, rather than keeping its
   commands as a quick reference beside the guide. Two copies would drift.
   **Recommend: as proposed.**

Risks:

- The nginx settings are untested; a mistake there affects only operators who use nginx,
  and the guide says they are not rehearsed.
- The heading check of the test makes reordering the guide a two-file change; that is
  intended.
