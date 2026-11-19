# WT-12 — Production deployment and operations

- Status: In progress (outline approved by the owner on 2026-11-18 with doc 0006; started
  on 2026-11-18, after WT-04). Items A to I are WI-062 to WI-070 (item H added on 2026-11-19); each gets its files and
  work-spec just before it starts.
- Canonical docs: [0006](../canonical/0006-operations.md) (the design),
  [0002](../canonical/0002-realtime-sync.md) (one process, SSE),
  [0004](../canonical/0004-api-conventions.md) (health, setup token); audit of
  2026-11-17, finding A12

## Goal

An operator installs Opanel from the repository's image behind their own HTTPS reverse
proxy, upgrades it, backs it up and restores it by following one guide, every step of
which CI rehearses; and can get back in if the only Admin loses their password.

## Depends on

- **WT-04** (real-time board sync): the first usable release, and the SSE endpoint the
  proxy settings must serve.

## In scope

- The production image and the example Compose file (doc 0006 section 3).
- The two database roles and the grants in migrations (section 5).
- The `migrate` command and the schema version check at start-up (section 6).
- `recover-admin` (section 7).
- The `maintenance` command (section 8).
- `Strict-Transport-Security` on `https:` installs (section 4).
- The backup and restore rehearsal in CI (section 8).
- `docs/operations.md`: install, reverse proxy (Caddy example, nginx settings), upgrade,
  backup and restore, recovery, maintenance, storage and logs.

## Out of scope

Doc 0006 section 11.

## Work-items (outline)

| Item                                               | Title                                                                                    | Status   | Depends on     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------- | -------------- |
| [WI-062](../work-items/WI-062-production-image.md) | A: production image and example Compose file; `migrate` as a one-shot command            | Done     | WT-04          |
| [WI-063](../work-items/WI-063-database-roles.md)   | B: database roles: owner and runtime, grants in migrations, the runtime role in CI       | Done     | WI-062         |
| [WI-064](../work-items/WI-064-schema-check.md)     | C: schema version check at start-up                                                      | Done     | WI-062         |
| [WI-065](../work-items/WI-065-recover-admin.md)    | D: `recover-admin` operator command                                                      | Done     | WI-062         |
| [WI-066](../work-items/WI-066-maintenance.md)      | E: `maintenance` command: expired sessions, old links, rate limits; measured index check | Done     | WI-062         |
| [WI-067](../work-items/WI-067-https-and-proxy.md)  | F: `Strict-Transport-Security` on `https:` installs; the reverse-proxy requirements      | Done     | WI-062         |
| [WI-068](../work-items/WI-068-backup-rehearsal.md) | G: backup and restore rehearsal in CI                                                    | Done     | WI-063, WI-064 |
| [WI-069](../work-items/WI-069-safe-logs.md)        | H: no request data in the logs when a query fails (found while drafting item I)          | Done     | WI-062         |
| [WI-070](../work-items/WI-070-operations-guide.md) | I: `docs/operations.md`, and closing the Follow-ups of `docs/README.md` it answers       | Proposed | WI-062–WI-069  |

## Exit criteria

- [ ] A fresh install from `compose.production.yaml` and the guide reaches the first-run
      setup over HTTPS, and only with the setup token.
- [ ] The app connects as the runtime role; a test shows it cannot `TRUNCATE`, alter a
      table, or update or delete `audit_log` and `task_events` rows.
- [ ] Upgrading from the previous release by the guide keeps all data; the app refuses to
      start on a schema it does not match, naming both versions.
- [x] CI restores a backup into a new database and the app serves the seeded data
      (WI-068).
- [ ] `recover-admin` issues a working reset link for a named Admin, audited with
      `via: "operator"`, and refuses any other account.
- [ ] `maintenance` removes expired sessions and old links, and nothing else.
- [ ] The full quality gate passes; the new CI jobs pass.

## Risks and open questions

Doc 0006 section 12. Also:

1. **Image size and build time in CI**: the image is built in a separate job, only when
   the files it uses change, and on the weekly run.
2. **Migrations already applied with the single role**: item B's migration changes
   ownership and grants on existing installs; it is tested against a database created by
   the current migrations.
