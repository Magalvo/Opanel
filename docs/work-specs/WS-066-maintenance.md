# WS-066 — `maintenance`: remove what has expired

- Status: Done (approved by the owner on 2026-11-18, questions 1 to 4 as proposed)
- Work-item: [WI-066](../work-items/WI-066-maintenance.md)
- Canonical docs: [0006](../canonical/0006-operations.md) (section 8: retention);
  [WS-022](WS-022-sign-in-hardening.md) (rate limits and their opportunistic purge);
  [WS-059](WS-059-link-lifecycle-locks.md) (one unused link per account);
  [WS-062](WS-062-production-image.md), [WS-063](WS-063-database-roles.md),
  [WS-065](WS-065-recover-admin.md) (one-shot commands)

## Approach

### 1. Where things stand (checked on 2026-11-18)

- `sessions(expires_at)`: Better Auth sets it 7 days ahead and moves it on use once a day
  (`expiresIn`, `updateAge`). An expired session is refused but never deleted. Index:
  `account_id` only.
- `account_tokens(expires_at, used_at, created_at)`: a used link keeps its row (it is the
  proof the link was used); replaced unused links are deleted when a new one is issued
  (WS-059). Indexes: `account_id`, and unique `account_id where used_at is null`.
- `rate_limits(window_started_at)`, indexed; `purgeExpiredRateLimits` deletes counters
  older than the longest window, on about 2% of sign-ins (WS-022).
- `verification(expires_at)`: Better Auth's table, empty in v1 (no email flows).
- The runtime role may `DELETE` all four (WS-063); it may not on `audit_log`,
  `task_events`, `comments`.

### 2. The service

`runMaintenance(db = getDb())` in `src/server/services/maintenance.ts`, four statements,
each its own transaction, in this order, returning the counts:

```sql
delete from sessions where expires_at < now();
delete from account_tokens
  where (used_at is not null and used_at < now() - interval '30 days')
     or (used_at is null and expires_at < now() - interval '30 days');
-- purgeExpiredRateLimits (WS-022), changed to return its count
delete from verification where expires_at < now();
```

The 30 days (doc 0006 section 8) are a constant, `LINK_RETENTION_DAYS`. A used link is kept
a while so an Admin asking "did they accept?" still finds it; after that only the audit
entry (`account.password_changed`, kept forever) remains.

No audit entry: the command removes nothing a person did (doc 0006 section 8). No account
lock: an expired session or a link that old is never written by anyone else.

### 3. The command

`scripts/maintenance.ts`, like `recover-admin` (WS-065): no arguments (anything given
prints `Usage: maintenance` and exits `2`); loads the environment; connects as the runtime
role (`DATABASE_URL`); prints
`Deleted 12 expired sessions, 3 old links, 40 rate-limit counters, 0 verifications.`;
exits `0`; on a failure prints `Maintenance failed: <describeError>` and exits `1`.
`pnpm maintenance` runs it with `tsx`; `build:commands` bundles it to
`dist/maintenance.mjs`; the `Dockerfile` copies it. README, under "Running in production":
schedule it daily, for example

```bash
docker compose -f compose.production.yaml run --rm app node dist/maintenance.mjs
```

The opportunistic purge of WS-022 stays: it keeps the limiter table small between runs.

### 4. Measuring before indexing

The audit asked to measure, not guess. While implementing, a script run once (not
committed) fills a scratch test database with representative volumes, larger than a
self-hosted install should see:

- 200 000 sessions, a quarter expired;
- 50 000 links, a third older than 30 days;
- 100 000 rate-limit counters, half ended.

It then times `runMaintenance` and records `EXPLAIN (ANALYZE)` of each delete.

**Rule** (open question 2): if a delete takes more than 1 second on those volumes, the item
adds a plain index on its column (`sessions(expires_at)`, `account_tokens(expires_at)`) in
a new migration; otherwise it adds none. The numbers and the decision go into the
implementation record.

### 5. Tests

- **Integration** (`maintenance.integration.test.ts`), rows seeded with explicit times:
  expired and live sessions (the live one still authenticates through `authenticate`);
  links used 31 and 29 days ago, unused expired 31 and 29 days ago, unused still valid;
  ended and running rate-limit counters; expired and valid `verification` rows; audit,
  task-event and comment rows that must stay; the counts returned; a second run returns
  zeros; run through a runtime-role connection (WS-063), it succeeds.
- **Unit** (`scripts/maintenance.test.ts`): no arguments is accepted, any argument is the
  usage.
- **Smoke**: `maintenance` in the image prints the `Deleted …` line and exits `0`.

### Considered and not chosen

- **A timer inside the app**: decided against in doc 0006 (question 4).
- **Batches of N rows**: at the measured volumes one statement per table is enough; if the
  measurement says otherwise, that is the index rule's case, revisited then.
- **Deleting used links at once**: they are the record that a link was used, which an
  Admin may want for a while; 30 days, as doc 0006 says.

## Files

| Path                                                       | Change                                  |
| ---------------------------------------------------------- | --------------------------------------- |
| `src/server/services/maintenance.ts` (+ integration test)  | create: section 2                       |
| `src/server/services/rate-limit.ts`                        | modify: the purge returns its count     |
| `scripts/maintenance.ts` (+ `scripts/maintenance.test.ts`) | create: section 3                       |
| `package.json`, `Dockerfile`                               | modify: `maintenance`, `build:commands` |
| `scripts/smoke-production.sh`, `README.md`                 | modify: run it; schedule it             |
| a migration, only if section 4 asks for an index           | create                                  |
| `docs/README.md`, WT-12, WI-066, WS-066                    | modify: statuses                        |

## Data model changes

None, unless the measurement of section 4 asks for an index.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                 | Covers criterion |
| --- | ----------- | ---------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | integration | each table's kept and deleted rows; the live session still authenticates; the counts                 | 1, 2, 3, 4, 6    |
| 2   | integration | audit, task events and comments untouched; a second run deletes nothing; it runs as the runtime role | 5, 7             |
| 3   | unit        | the command's arguments                                                                              | 6                |
| 4   | measured    | section 4, recorded with the decision                                                                | 8                |
| 5   | smoke       | the command in the image                                                                             | 9                |
| 6   | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `openapi:generate` unchanged                | 10               |

## Risks and open questions

For the owner:

1. **Also empty expired `verification` rows**, a Better Auth table Opanel does not use in
   v1. **Recommend: yes**, so the command is complete if a later item uses it.
2. **The index rule** (section 4): more than 1 second on the stated volumes adds an index,
   else none. **Recommend: as proposed.**
3. **Keep used links 30 days**, and unused expired ones 30 days past expiry, as doc 0006
   says. **Recommend: as proposed.**
4. **Keep the opportunistic rate-limit purge** next to the command. **Recommend: as
   proposed.**

## Deviations from the approved spec

1. **The four deletes run as plain statements**, not each in an explicit transaction: a
   single statement is already atomic, and none depends on another.
2. **`runMaintenance` takes anything with `execute`**, so the test runs it on a connection
   as the runtime role (WS-063) as well as on the default client.
3. **`maintenanceSummary` and `parseMaintenanceArgs` are exported** from the script and
   unit tested; the link of WS-065 goes to standard output the same way.

## Implementation record

- Red:
  - the integration tests of `runMaintenance` failed before the module existed;
  - the unit tests of the command failed before the script existed.
- Green:
  - `src/server/services/maintenance.ts`;
  - `purgeExpiredRateLimits` returns its count;
  - `scripts/maintenance.ts`, `pnpm maintenance`, `build:commands` and the `Dockerfile`;
  - a README section on scheduling it; a smoke check.
- Measured on 2026-11-18 (section 4), in a scratch database `opanel_volume_test`, dropped
  afterwards. Volumes: 60 000 accounts, 200 000 sessions (a quarter expired), 50 000 links
  (a third older than 30 days), 100 000 rate-limit counters (half ended).

  | Delete         | Rows deleted | Plan                     | Execution time |
  | -------------- | ------------ | ------------------------ | -------------- |
  | sessions       | 50 000       | sequential scan          | 180 ms         |
  | account_tokens | 16 666       | sequential scan          | 20 ms          |
  | rate_limits    | 50 000       | bitmap scan of its index | 27 ms          |
  | verification   | 0            | sequential scan          | 0.1 ms         |

  The whole command, Node.js start-up included: 1.1 s. **Decision (question 2): no new
  index**; every delete is well under 1 second at volumes beyond a self-hosted install.

- Smoke (local Docker): every earlier check, plus `maintenance` in the image prints its
  `Deleted …` line and exits `0`.
- `pnpm db:generate`: nothing to migrate. `pnpm openapi:generate`: no change.
- Gate on 2026-11-18:
  - typecheck, lint and Prettier pass;
  - Vitest 1297 of 1297;
  - `pnpm test:e2e` 79 of 79 with `--retries=0`;
  - Windows, Node 24, pnpm 10.28.0, Compose PostgreSQL on port 5433.
