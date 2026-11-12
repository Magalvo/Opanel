# WS-014 — Audit log table and writer

- Status: Done (approved by the owner on 2026-11-12, all open questions accepted as proposed)
- Work-item: [WI-014](../work-items/WI-014-audit-log.md)
- Canonical docs: [0001](../canonical/0001-ai-qa-agents-and-triage.md) sections 4 and 7;
  [0003](../canonical/0003-task-management.md) section 9;
  `AGENTS.md` hard rules 5, 7, 8; [WT-02](../work-tracks/WT-02-accounts-and-permissions.md)

## Approach

1. **Action list and data guard** (`src/lib/schemas/audit.ts`, pure). `AUDIT_ACTIONS` is a
   const list and `auditActionSchema` a Zod enum of it, in the form `entity.verb`. It
   starts with the actions WT-02 needs, and each later work-track appends its own:
   `setup.first_admin_created`, `auth.sign_in`, `auth.sign_in_failed`, `auth.sign_out`,
   `account.invited`, `account.invitation_accepted`, `account.reset_link_created`,
   `account.password_changed`, `account.role_changed`, `account.deactivated`,
   `account.reactivated`, `account.name_changed`.
   `assertAuditDataSafe(data)` walks the value (objects, arrays, any depth) and throws if
   a key matches `/pass(word)?|secret|token|hash|authorization|cookie/i`, if the value is
   not JSON-serialisable, or if its JSON is over 8 KiB. The message names the key path or
   the size and never a value.
2. **Table** (`src/server/db/schema/audit-log.ts`): see below.
3. **Writer** (`src/server/services/audit.ts`). `recordAudit(executor, event)` where
   `executor` is the Drizzle database or a transaction (`Database | Transaction`) and
   `event` is `{ actor: Actor | null; action; entity; entityId?; data? }`. It validates
   the action with Zod, runs the data guard, then inserts and returns the row id.
   `actor` has no default: `null` means "no authenticated actor" and must be written out.
   A service calls it inside its own `db.transaction`, so the change and its audit row
   commit or roll back together. It lives in `services/` because that is the only layer
   allowed to touch the database.
4. **Append-only trigger.** A custom migration statement adds a `BEFORE UPDATE OR DELETE`
   trigger on `audit_log` that raises an exception. `TRUNCATE` is not affected, so the
   test harness (`resetDatabase`) keeps working; it is also, deliberately, the only way
   to empty the table, and the harness refuses to run outside a `_test` database.

### Table `audit_log`

| Column             | Type          | Notes                                                                      |
| ------------------ | ------------- | -------------------------------------------------------------------------- |
| `id`               | bigint        | `generated always as identity`, primary key; gives a total order           |
| `actor_account_id` | uuid null     | references `accounts(id)` `on delete restrict`; null only for no actor     |
| `action`           | text not null | one of `AUDIT_ACTIONS`                                                     |
| `entity`           | text not null | what was acted on, for example `account`                                   |
| `entity_id`        | text null     | the entity's id, as text                                                   |
| `data`             | jsonb null    | small structured detail, for example `{ "from": "member", "to": "admin" }` |
| `created_at`       | timestamptz   | not null, default `now()`                                                  |

Indexes: `(entity, entity_id, created_at)` and `(actor_account_id, created_at)`.
Migration: `0002_audit_log` (generated), plus the trigger statements appended through
`drizzle-kit generate --custom`'s sibling migration `0003_audit_log_append_only`, so each
file stays one concern and neither is edited after it is applied.

## Files

| Path                                                        | Change                 |
| ----------------------------------------------------------- | ---------------------- |
| `src/lib/schemas/audit.ts`, `audit.test.ts`                 | create (test first)    |
| `src/server/db/schema/audit-log.ts`, `index.ts`             | create / modify        |
| `src/server/db/migrations/0002_*.sql`, `0003_*.sql`         | generated              |
| `src/server/services/audit.ts`, `audit.integration.test.ts` | create (test first)    |
| `docs/canonical/0001-*.md` section 7                        | modify: table as built |
| `docs/README.md`, WT-02, WI-014, WS-014                     | statuses               |

No new dependencies.

## Data model changes

The table above and the append-only trigger.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                          | Criterion          |
| --- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | unit        | `auditActionSchema` accepts every listed action and rejects `account.exploded`, `""` and wrong case                                                                                           | closed list        |
| 2   | unit        | `assertAuditDataSafe` accepts plain data (strings, numbers, nested objects, arrays, `null`)                                                                                                   | data guard         |
| 3   | unit        | it rejects `password`, `Secret`, `apiToken`, `passwordHash`, `Authorization`, `cookie` as keys, top level, nested, and inside arrays                                                          | data guard         |
| 4   | unit        | the error names the key path and never contains the value; an 8 KiB + 1 payload is rejected, 8 KiB accepted; a function or `bigint` is rejected                                               | data guard         |
| 5   | integration | migration applies; `recordAudit` stores actor, action, entity, entity id, data and a timestamp, and returns the id                                                                            | writer             |
| 6   | integration | inside `db.transaction`, a thrown error afterwards leaves no audit row; a normal commit leaves exactly one                                                                                    | same transaction   |
| 7   | integration | an unknown action and unsafe data throw and write nothing                                                                                                                                     | closed list, guard |
| 8   | integration | `actor: null` writes a row with a null actor; the type does not allow leaving `actor` out (compile-time check with `@ts-expect-error` is **not** used: a type-level test with `expectTypeOf`) | explicit no actor  |
| 9   | integration | `UPDATE` and `DELETE` on `audit_log` fail; `INSERT` succeeds; `resetDatabase` still empties it                                                                                                | append-only        |
| 10  | integration | an unknown actor id fails; deleting an account that has an audit row fails                                                                                                                    | actor integrity    |
| 11  | integration | lookups by `(entity, entity_id)` and by actor use their index (`EXPLAIN` shows an index scan on a table with a few hundred rows, after `ANALYZE`)                                             | indexes            |
| 12  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm db:generate` reports nothing to generate                                                                                       | gate               |

## Risks and open questions

For the owner:

1. **Append-only trigger.** Hard rule 8 only asks that actions are recorded. I propose
   also enforcing "cannot be edited or deleted" in the database, like the task history of
   doc 0003 section 9, so a bug or a compromised service cannot rewrite history. The cost
   is one extra migration and that a database owner has to drop the trigger to purge old
   rows. Keep it?
2. **Nullable actor.** Failed sign-ins and rate-limited attempts have no authenticated
   account, and the first-run setup acts before any account exists. I allow a null actor,
   but only when the caller writes `actor: null`. Alternative: never log those events.
   Failed sign-ins are the most useful security signal, so I recommend keeping them.
3. **Deleting accounts.** `on delete restrict` means an account with history cannot be
   deleted, only deactivated, which matches the plan (accounts are deactivated, never
   deleted, in v1). It also means the cascade test of WI-013 stays valid, since it uses
   accounts with no audit rows.
4. **The action list** starts with the twelve WT-02 actions above. Adding an action is a
   one-line change in the same item that first records it. Alternative: free-form
   strings, which lose the check against typos.

Technical:

5. **Transaction type.** Drizzle's transaction object and the database object have
   different types. `Executor` is the narrowest type both satisfy (`insert` is all the
   writer needs); this is settled when the first integration test compiles against the
   installed Drizzle 0.45 documentation (hard rule 13).

## Deviations from the approved spec

1. **The append-only trigger is migration `0003`, written with `drizzle-kit generate
--custom`** as planned; `pnpm db:generate` afterwards reports nothing to generate, so
   the hand-written file does not disturb the schema snapshot.
2. **Test 8 (no actor)** is split: the runtime part (a row with a null actor) and the
   type part (`actor` is required and typed `Actor | null`, checked with `expectTypeOf`).
3. **`AuditExecutor` is `Pick<Database, "insert">`.** Both the database and a Drizzle
   transaction satisfy it; the integration tests compile and run against both.

## Implementation record

- Red: the unit test failed on the missing module; the integration test failed on the
  missing module (committed before any code).
- Green: 200 tests pass (about 20 new), up from 180. Playwright: 12 pass. `pnpm
db:generate` reports nothing to generate.
- Locally the database was PostgreSQL 16 (no Docker in the sandbox); CI runs the
  PostgreSQL 18 of `compose.yaml`.
