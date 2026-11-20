# WS-088 — Severity on tasks

- Status: Proposed
- Work-item: [WI-088](../work-items/WI-088-task-severity.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 4 (severity, "set
  by the reporter") and 9 (history); [0004](../canonical/0004-api-conventions.md) sections
  3, 6 and 8 (`PATCH`; responses may gain fields within v1);
  [WT-06](../work-tracks/WT-06-bug-reports-and-triage.md) decision 1 and question 7;
  [WS-086](WS-086-triage-data-model.md) (the columns and `tasks_severity_check`)

## Approach

### 1. The task's shape (`src/lib/schemas/tasks.ts`)

`taskFields`, shared by `TaskSummary` and `Task`, gains four fields:

```ts
severity: severitySchema.nullable().meta({ description: "Bugs only." }),
fingerprint: z.string().nullable().meta({
  description: "Set by the triage pipeline from the agent's report; read-only.",
}),
occurrences: z.int().min(0).meta({
  description: "How many bug reports this task stands for; read-only.",
}),
lastReportedAt: z.iso.datetime().nullable().meta({ description: "Read-only." }),
```

`severitySchema` comes from `bug-reports.ts` (WS-086). The four are in the summary too,
because the card shows severity and the count (WT-06 decision 15, item F) and a board
reads summaries. Responses gaining fields is allowed within v1 (doc 0004 sections 3 and 8).

### 2. Setting severity

- `createTaskRequestSchema` gains `severity: severitySchema.optional()`, with a refine
  that refuses it unless `type` is `bug`: issue path `severity`, message "Only a bug has a
  severity." A bug created without one has `null` (question 1).
- `updateTaskRequestSchema` gains `severity: severitySchema.nullable().optional()`
  (`null` clears it), and joins the "Send at least one field to change." check.
- `updateTask` computes `after.type` first, then:
  - `input.severity` is a value and `after.type !== "bug"`: `fieldError("severity",
"Only a bug has a severity.")`, before any write;
  - `after.type !== "bug"`: `after.severity = null`, so a bug that becomes a task or a
    story loses its severity in the same `update` (WT-06 decision 1);
  - otherwise `input.severity === undefined ? before.severity : input.severity`. A task
    that becomes a bug keeps `null` (question 2).
- `fingerprint`, `occurrences` and `lastReportedAt` are in no request schema; both bodies
  are strict, so sending them is the usual `400`.

`tasks_severity_check` (WS-086) already refuses a severity on a task that is not a bug,
so the database backs the rule.

### 3. History (doc 0003 section 9)

`EDITABLE` gains `["severity", "severity"]` right after `type`, so a type change that
clears the severity records `type` then `severity` (old value, `null`), both
`field_changed` with the actor. `createTask`'s `created` entry gains `severity` in its
`newValue` when one is set. No new event type; `task.updated` and `task.created` are
published as today (doc 0002).

### 4. Reading

`TASK_SELECT` gains `t.severity, t.fingerprint, t.occurrences` and `last_reported_at` in
the same ISO form as the other times; `TaskRow` and `toSummary` map them. Every operation
that answers a task (get, list, create, edit, move, restore, deleted list, the `current`
of a `409`) then carries them with no further change.

### 5. Who may set it

`tasks:write`, the permission of the edit itself (WT-06 question 7, approved). That
includes agents holding it, such as `worker_agent`; a QA agent's severity comes through
its report (item D).

## Files

| Path                                                            | Change                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/lib/schemas/tasks.ts`, `tasks.test.ts`                     | modify: the four fields, `severity` in both requests (tests first) |
| `src/server/services/tasks.ts`, `tasks.integration.test.ts`     | modify: select, mapping, create, edit, history (tests first)       |
| `src/app/api/v1/tasks/[taskId]/route.integration.test.ts`       | modify: a `PATCH` with `severity` through `route()`; full shapes   |
| other tests that compare a whole task (route and service tests) | modify: the four new fields in their expected objects              |
| `src/components/board/test-data.ts` and the UI tests' task data | modify: the four fields, so fixtures parse with the strict schemas |
| `docs/api/openapi.json`                                         | regenerate                                                         |
| `docs/README.md`, WT-06, WI-088, WS-088                         | modify: statuses                                                   |

No migration (WS-086 added the columns), no new dependency, no UI change (item F).

## Data model changes

None.

## API contract

Additive, within v1:

- `Task` and `TaskSummary`: `severity` (`Severity` or `null`), `fingerprint` (string or
  `null`), `occurrences` (integer), `lastReportedAt` (date-time or `null`), all required
  in the answer.
- `CreateTaskRequest`: optional `severity`, only with `type: "bug"`.
- `UpdateTaskRequest`: optional, nullable `severity`.
- No new error code: a misplaced severity is `400 invalid_request` naming `severity`.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                      | Covers criterion |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | `taskSchema`: requires the four fields; `severity` refuses `urgent`; `occurrences` refuses `-1`                                                                           | 1                |
| 2   | unit        | `createTaskRequestSchema`: `severity` with `type: "bug"` passes; without `type`, or with `task`, fails on `severity`; `fingerprint` and `occurrences` are refused         | 2, 3, 6          |
| 3   | unit        | `updateTaskRequestSchema`: `{ severity, version }` alone passes; `severity: null` passes; `lastReportedAt` is refused                                                     | 2, 6             |
| 4   | integration | a task created as before answers `null`, `null`, `0`, `null`; a bug created with `high` answers `high` and its `created` entry names it                                   | 1, 2, 5          |
| 5   | integration | `updateTask` sets, changes and clears a bug's severity; each is one `field_changed` entry with the actor and old and new values; the version grows by one each time       | 2, 5             |
| 6   | integration | `severity` on a `task` is `400` naming `severity` and writes nothing; `{ type: "task", severity: "low" }` on a bug is the same `400`                                      | 3                |
| 7   | integration | a bug with `critical` changed to `story` answers `severity: null`, with a `type` and a `severity` entry in that order; a `task` changed to `bug` answers `severity: null` | 4, 5             |
| 8   | integration | the fields written by SQL (`fingerprint`, `occurrences = 3`, `last_reported_at`) come back from get, the project list, move and restore, and in a `409`'s `current`       | 1                |
| 9   | integration | the route: `PATCH` with `severity` by a Member with a cookie and by an agent token holding `tasks:write`; a Viewer gets `403`                                             | 2                |
| 10  | unit        | the OpenAPI document: `Task`, `TaskSummary` and both requests carry the fields; `docs/api/openapi.json` regenerated                                                       | 7                |
| 11  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                                                                   | 7                |

## Risks and open questions

For the owner:

1. **Severity on creation, not only on `PATCH`.** WT-06 decision 1 names `PATCH`; but a
   person filing a bug by hand (decision 13) is its reporter, and doc 0003 section 4 says
   severity is "set by the reporter". Without it a person must create, then edit.
   **Recommend: accept `severity` on create for bugs; no default, so a hand-filed bug has
   none until someone sets it.**
2. **A task that becomes a bug gets no severity**, rather than `medium` (the pipeline's
   default for a report). A default would claim an assessment nobody made. **Recommend:
   `null`.**
3. **All four fields in `TaskSummary` too**, not only in `Task`. The card needs severity
   and the count; `fingerprint` and `lastReportedAt` add a few bytes per row but keep one
   field list and one mapping. **Recommend: all four in both.**

Risks:

- **Fixtures and whole-object assertions.** The schemas are strict and some tests compare
  whole tasks; each needs the four fields. This is mechanical, and the typecheck finds
  every fixture that misses one.
