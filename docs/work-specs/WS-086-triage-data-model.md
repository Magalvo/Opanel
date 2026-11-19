# WS-086 — The data model of bug reports and triage

- Status: Approved (by the owner on 2026-11-19, questions 1 to 3 as recommended)
- Work-item: [WI-086](../work-items/WI-086-triage-data-model.md)
- Canonical docs: [0001](../canonical/0001-ai-qa-agents-and-triage.md) sections 5 to 7;
  [0003](../canonical/0003-task-management.md) sections 4, 5 and 7;
  [0006](../canonical/0006-operations.md) section 5 (append-only tables);
  [WT-06](../work-tracks/WT-06-bug-reports-and-triage.md) decisions 1, 2, 4, 5, 9, 10, 11

## Approach

### 1. Shared vocabularies

`src/lib/schemas/bug-reports.ts` (new) exports the value lists the database checks and
later items validate with, so the two cannot drift:

- `SEVERITIES = ["low", "medium", "high", "critical"]`, `severitySchema`;
- `ORIGIN_LAYERS = ["frontend", "api", "backend", "unknown"]`, `originLayerSchema`;
- `ROUTED_LAYERS = ["frontend", "api", "backend"]`, the layers a rule may name;
- `BUG_REPORT_OUTCOMES = ["created", "deduplicated"]`;
- `TASK_LINK_TYPES = ["regression_of"]` (WT-09 adds the others);
- `FINGERPRINT_MAX_LENGTH = 128`.

A unit test checks each check constraint of the migration names exactly these values (it
reads the Drizzle schema's SQL text, as `agents.integration.test.ts` does for scopes).

### 2. `tasks` (decision 1)

New columns, all safe for existing rows:

| Column             | Type          | Rule                                                                        |
| ------------------ | ------------- | --------------------------------------------------------------------------- |
| `severity`         | `text`, null  | `tasks_severity_check`: null, or one of `SEVERITIES` **and** `type = 'bug'` |
| `fingerprint`      | `text`, null  | `tasks_fingerprint_check`: null, or 1 to 128 characters                     |
| `occurrences`      | `integer`     | not null, default 0, `tasks_occurrences_check`: `>= 0`                      |
| `last_reported_at` | `timestamptz` | null                                                                        |

Index `tasks_project_fingerprint_idx` on `(project_id, fingerprint)` where `fingerprint is
not null`: the lookup of decision 6 (non-unique; the lock serialises, WT-06 question 1).
`task_events_type_check` gains `reported_again` (decision 10).

### 3. `projects.triage_team_id` (decision 2)

`uuid`, null, references `teams(id)` **on delete restrict**. Index on it, so deleting a team
does not scan `projects`.

### 4. `routing_rules` (decision 4)

```
routing_rules(
  project_id   uuid not null references projects(id) on delete cascade,
  origin_layer text not null check (origin_layer in ('frontend', 'api', 'backend')),
  team_id      uuid not null references teams(id) on delete restrict,
  primary key (project_id, origin_layer)
)
```

Index on `team_id`. A missing row means "no rule": the pipeline falls back to the triage
team. Projects are never deleted in v1 (they are archived), so the cascade only keeps a
future delete clean.

### 5. Teams in use (decision 5)

`deleteTeam` already maps a foreign-key violation to `409 team_in_use`
(`services/teams.ts:188`). With both new references `restrict`, a team named by a triage
team or a rule is refused the same way, with no service change. The message stays the
existing one; item B may name the projects. An integration test pins it.

### 6. `bug_reports` (decision 11)

```
bug_reports(
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects(id) on delete restrict,
  agent_account_id uuid not null,
  account_kind     text not null default 'agent' check (account_kind = 'agent'),
  task_id          uuid not null references tasks(id) on delete restrict,
  outcome          text not null check (outcome in ('created', 'deduplicated')),
  origin_layer     text not null check (origin_layer in (… ORIGIN_LAYERS)),
  confidence       real check (confidence is null or confidence between 0 and 1),
  severity         text not null check (severity in (… SEVERITIES)),
  fingerprint      text not null check (length between 1 and 128),
  run_id           text check (run_id is null or length between 1 and 128),
  payload          jsonb not null,
  created_at       timestamptz not null default now(),
  foreign key (agent_account_id, account_kind) references accounts(id, kind) on delete restrict
)
```

The `(account id, kind)` foreign key is the one WS-071 used for agent-only rows
(`accounts_id_kind_idx`): a human can never be a report's author. Indexes:
`(task_id, created_at, id)` for item E's list, newest first; `(project_id, created_at)`.

Append-only, as `task_events` (migrations 0009, 0014): a trigger
`bug_reports_append_only` refuses `UPDATE` and `DELETE`, and the migration revokes both
from `opanel_app` (default privileges already grant them, WS-063).

### 7. `task_links` (decision 9)

```
task_links(
  from_task_id uuid not null references tasks(id) on delete restrict,
  to_task_id   uuid not null references tasks(id) on delete restrict,
  type         text not null check (type in ('regression_of')),
  created_by   uuid references accounts(id) on delete restrict,
  created_at   timestamptz not null default now(),
  primary key (from_task_id, to_task_id, type),
  check (from_task_id <> to_task_id)
)
```

Index on `to_task_id` (WT-09 reads links both ways). Not append-only: WT-09 lets people
remove links. Tasks are soft-deleted, so `restrict` never blocks anything in v1.

### 8. Migrations

Two, as WT-03 and WT-05 did: `0017_triage.sql`, generated by `pnpm db:generate` from the
Drizzle schema and checked by hand; `0018_bug_reports_append_only.sql`, custom
(`drizzle-kit generate --custom`), with the trigger and the `REVOKE`. Each is tested against
a database migrated to 0016 with data in it (an existing task keeps `occurrences = 0` and
no severity).

## Files

| Path                                                                       | Change                                         |
| -------------------------------------------------------------------------- | ---------------------------------------------- |
| `src/lib/schemas/bug-reports.ts`, `.test.ts`                               | create: the vocabularies (tests first)         |
| `src/server/db/schema/tasks.ts`, `projects.ts`, `task-events.ts`           | modify: columns, checks, indexes               |
| `src/server/db/schema/routing-rules.ts`, `bug-reports.ts`, `task-links.ts` | create                                         |
| `src/server/db/schema/index.ts`                                            | modify: export them                            |
| `src/server/db/schema/triage.integration.test.ts`                          | create: every check (tests first)              |
| `src/server/db/migrations/0017_triage.sql`, `0018_…`, `meta/*`             | create: generated, and custom                  |
| `src/server/db/runtime-role.integration.test.ts`                           | modify: `bug_reports` is append-only           |
| `src/server/services/teams.integration.test.ts`                            | modify: a team used by triage is `team_in_use` |
| `docs/README.md`, WT-06, WI-086, WS-086                                    | modify: statuses                               |

## Data model changes

Sections 2 to 7; migrations `0017_triage` and `0018_bug_reports_append_only`.

## API contract

None. No response changes: services select their columns explicitly, so the new `tasks`
columns are not returned until item C adds them to the task schema.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                            | Covers criterion |
| --- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | the vocabularies: values, and each schema refuses anything else                                                                                                 | vocabularies     |
| 2   | integration | `tasks`: a bug accepts each severity; a `task` or `story` with a severity is refused; a fingerprint of 0 or 129 characters is refused; occurrences `-1` refused | 1                |
| 3   | integration | `tasks`: a task created as before has no severity, no fingerprint, `occurrences = 0`                                                                            | 1                |
| 4   | integration | `projects.triage_team_id` accepts a team and null                                                                                                               | 2                |
| 5   | integration | `routing_rules`: one row per project and layer; `unknown` and a second row for the same layer are refused                                                       | 3                |
| 6   | integration | `deleteTeam` on a team that is a triage team, or in a rule, is `409 team_in_use`, and the team stays                                                            | 4                |
| 7   | integration | `bug_reports`: an agent's report is stored; a human author, an unknown outcome, layer or severity, a confidence of 1.5, a 129-character fingerprint are refused | 5                |
| 8   | integration | `bug_reports`: `update` and `delete` raise "append-only" as the owner; the runtime role has no `UPDATE` or `DELETE` (runtime-role test lists it)                | 5                |
| 9   | integration | `task_links`: a `regression_of` link is stored once; a link to itself, another type, or the same link twice are refused                                         | 6                |
| 10  | integration | `task_events`: a `reported_again` entry is accepted                                                                                                             | 7                |
| 11  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm openapi:generate` leaves no diff                                                                 | 9                |

## Risks and open questions

For the owner:

1. **`confidence` as `real`** (single precision, enough for an agent's 0..1 estimate) rather
   than `numeric(4,3)`. **Recommend: `real`.**
2. **`routing_rules` cascade on project delete, everything else `restrict`.** Projects and
   tasks are never hard-deleted in v1, so this only matters to a later delete feature.
   **Recommend: as proposed.**
3. **`bug_reports.severity` not null**, filled with the default `medium` when the agent
   sends none (WT-06 decision 12), so every report says what severity it was triaged
   with. **Recommend: as proposed.**

## Deviations from the approved spec

None yet.

## Implementation record

Not started.
