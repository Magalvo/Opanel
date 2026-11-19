# 0006 — Operations: deployment, database roles, backup and recovery

- Status: **Approved** (2026-11-18, questions 1 to 6 as proposed)
- Date: 2026-11-18
- Supersedes: none
- Relates to: [0002](0002-realtime-sync.md) (one long-lived Node.js process, SSE),
  [0001](0001-ai-qa-agents-and-triage.md) (the audit log), [0004](0004-api-conventions.md)
  (the health endpoint, the setup token); audit of 2026-11-17, finding A12

## 1. Context

Opanel is self-hosted, one organization per install (`AGENTS.md` section 1), and its first
usable release is the end of WT-04. Today the repository runs it only for development and
CI: `compose.yaml` holds PostgreSQL with local defaults, the app runs from `pnpm dev` or
`pnpm start`, and the operator is left to guess the rest. The docs already list the gaps
(`docs/README.md`, Follow-ups): no production deployment, no way back in if the only Admin
loses their password, and open questions about the reverse proxy, HTTPS, `CLIENT_IP_HEADER`,
`Strict-Transport-Security`, request size and logs. The audit of 2026-11-17 (A12) adds:
the app connects as the database owner, nothing removes expired sessions or used links,
and no backup, restore or upgrade has ever been rehearsed.

This doc decides how Opanel is installed, run, upgraded, backed up and recovered. WT-12
implements it.

## 2. Summary of decisions

| Topic              | Decision                                                                               |
| ------------------ | -------------------------------------------------------------------------------------- |
| Packaging          | One container image built from the repository, plus an example production Compose file |
| Process model      | Exactly one app process per install (doc 0002), behind the operator's reverse proxy    |
| HTTPS              | Terminated by the reverse proxy; Opanel documents the requirements and one example     |
| Migrations         | A one-shot `migrate` command, run before the new version starts; never at app start-up |
| Database roles     | An owner role for migrations, a least-privilege runtime role for the app               |
| Admin recovery     | An operator command on the server that issues a reset link for a named Admin, audited  |
| Retention          | Expired sessions and old used or expired links are deleted; the audit log is kept      |
| Backup and restore | `pg_dump`/`pg_restore` procedure, rehearsed automatically in CI                        |
| Upgrades           | Back up, stop, migrate, start; forward-only migrations; no zero-downtime upgrade in v1 |
| Health             | `GET /api/v1/health` (`503` without the database) drives the container health check    |

## 3. Packaging and process model

- A `Dockerfile` at the repository root builds a production image: Node.js of `.nvmrc`, the
  pinned pnpm, `next build`, and a non-root user. The same image runs the app (`next start`)
  and the operator commands (`migrate`, Admin recovery, maintenance).
- `compose.production.yaml` is an **example**, not the only supported setup: the app, a
  one-shot `migrate` service, and PostgreSQL with a named volume. `compose.yaml` stays the
  development and CI file. The operator fills in one env file; each service receives only
  its own variables from it (section 5, amended by WS-079).
- One app process (doc 0002: the event hub lives in memory). Scaling out is out of scope
  for v1 and is refused in the docs, not silently allowed.
- Configuration stays the validated environment of `src/server/env.ts`; the image adds no
  default secret. `NODE_ENV=production` makes `SETUP_TOKEN` required for the first-run
  setup (WS-055).

## 4. Reverse proxy and HTTPS

The operator's reverse proxy terminates HTTPS. The operations guide states what it must do,
with one complete example (Caddy) and the equivalent settings for nginx:

- forward to the one app process; set the client IP header Opanel is told about in
  `CLIENT_IP_HEADER`, and strip any value the client sent;
- not buffer `GET /api/v1/projects/*/events` (doc 0002) and allow long-lived responses;
- accept request bodies of at least 512 KiB and refuse larger ones itself (WI-044);
- redirect HTTP to HTTPS.

Opanel sends `Strict-Transport-Security` when `APP_URL` is `https:` (the follow-up of
WI-041).

## 5. Database roles and threat model

- **Owner role** (`opanel_owner`): owns the schema, runs migrations, used by `migrate` and
  backups only.
- **Runtime role** (`opanel_app`): what `DATABASE_URL` uses. `SELECT`, `INSERT`, `UPDATE`,
  `DELETE` on the application tables; on `audit_log` and `task_events` only `SELECT` and
  `INSERT`; `USAGE` on sequences. No `TRUNCATE`, no DDL, no ownership. Default
  privileges give the runtime role these rights on every table and sequence a migration
  creates; a migration that creates an append-only table revokes `UPDATE` and `DELETE` on
  it; a test checks both (amended by WS-063, 2026-11-18). `opanel_app` is a group role:
  the app connects as any login role that is a member of it.
- Threat model: the operator and the owner role are trusted; the append-only triggers
  protect the audit log from the application (a bug or a compromised app process), not
  from the database owner. A compromised app process can read and change application data
  through the API's own rules, but cannot rewrite history, drop tables or disable triggers.
- Each service of the example install gets only its own variables. The app's environment
  holds no owner credential (`MIGRATION_DATABASE_URL`, `POSTGRES_PASSWORD`); the database's
  holds no app secret; `migrate` holds only the owner's connection (amended by WS-079,
  2026-11-19).

## 6. Migrations and upgrades

- `migrate` applies pending migrations with the owner role and exits; the app never
  migrates at start-up. Migrations are forward-only (`AGENTS.md` hard rule 5); there are
  no down migrations.
- Upgrade procedure: back up (section 8), stop the app, run the new image's `migrate`,
  start the new app, check `GET /api/v1/health`. A failed migration leaves the old schema
  in place (each migration runs in a transaction); the operator restores the backup to go
  back to the previous version.
- The app refuses to start when the database has migrations it does not know (a newer
  schema) or lacks ones it needs (an older one), with a message naming both.

## 7. Recovering the last Admin

An operator command, run on the server with the image (never an HTTP endpoint):
`recover-admin --email <email>`. It refuses unless the email is a human Admin account; it
reactivates nothing and changes no role. It issues a reset link exactly as
`issueResetLink` does (one unused link per account, WS-059), prints the link once, and
writes `account.reset_link_created` with no acting account and `data.via = "operator"`.
This closes the follow-up "No way back in if the only Admin loses their password".

## 8. Backup, restore and retention

- **Backup**: `pg_dump --format=custom` with the owner role, documented with a schedule the
  operator chooses. Restoring: into an empty database, with `pg_restore`, then `migrate`,
  then start the app of the same or a newer version.
- **Rehearsal**: a CI job builds the image, seeds a database through the API, backs it up,
  restores it into a new database, starts the app on it and checks health and the seeded
  data. It runs weekly and on changes to migrations or the operations files.
- **Retention**, by a `maintenance` command the operator schedules (daily is enough):
  expired sessions are deleted; used or expired links older than 30 days are deleted;
  expired rate-limit rows are deleted (today also done opportunistically, WS-022). The
  audit log and task history are kept for the life of the install; archiving them is out
  of scope for v1. The command writes no audit entry: it removes nothing a person did.
- Storage growth: the operations guide names the tables that grow (`audit_log`,
  `task_events`, `comments`) and a query to watch their size.

## 9. Health and outages

`GET /api/v1/health` already answers `503` when the database is unreachable and exposes no
detail (WS-005). The image's health check and the example Compose file use it. While the
database is down, every other request fails with `500` and no detail; the process keeps
running and recovers when the database returns (the connection pool reconnects).

## 10. Logs

Opanel logs to standard output only; collection and retention are the operator's. The
operations guide states what Opanel's own logs may contain (no secrets, no error messages
of database errors, WS-042) and what Next.js and Better Auth may add, after the check that
WS-042 left open (done in WI-069).

## 11. Out of scope for v1

High availability and more than one app process; zero-downtime upgrades; managed-cloud
templates (Kubernetes, Helm, Terraform); automatic backups run by Opanel; archiving or
pruning the audit log; email delivery of reset links; monitoring beyond the health
endpoint.

## 12. Questions decided by the owner (2026-11-18, all as recommended)

1. **Packaging** (section 3): a container image plus an example Compose file, rather than
   only written instructions for running `next start`. **Recommend: the image.**
2. **Reverse proxy example** (section 4): Caddy as the full example, nginx as settings
   only. Neither becomes a dependency of Opanel. **Recommend: as proposed.**
3. **Two database roles** (section 5), with grants written in every future migration.
   **Recommend: as proposed.**
4. **Retention** (section 8): a `maintenance` command the operator schedules, rather than
   a timer inside the app process, and 30 days for used or expired links.
   **Recommend: as proposed.**
5. **Version check at start-up** (section 6): refuse to start on a schema mismatch.
   **Recommend: as proposed.**
6. **When WT-12 runs**: right after WT-04, before WT-05, so the first usable release can
   be installed safely. **Recommend: right after WT-04.**
