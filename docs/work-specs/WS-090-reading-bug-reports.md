# WS-090 — Reading the reports behind a task, and its regression links

- Status: Proposed
- Work-item: [WI-090](../work-items/WI-090-reading-bug-reports.md)
- Canonical docs: [0001](../canonical/0001-ai-qa-agents-and-triage.md) sections 5 and 6;
  [0003](../canonical/0003-task-management.md) section 7 (links);
  [0004](../canonical/0004-api-conventions.md) section 5 (lists; see section 2 and
  question 1); [WT-06](../work-tracks/WT-06-bug-reports-and-triage.md) decisions 9 and 15;
  [WS-086](WS-086-triage-data-model.md) (tables), [WS-089](WS-089-bug-report-pipeline.md)
  (what the pipeline stores)

## Approach

### 1. The report as read (`src/lib/schemas/bug-reports.ts`)

```ts
export const bugReportSchema = z
  .strictObject({
    id: z.uuid(),
    taskId: z.uuid(),
    agent: accountRefSchema, // kind is always "agent"; shown with the badge (WS-074)
    outcome: z.enum(BUG_REPORT_OUTCOMES),
    originLayer: originLayerSchema,
    confidence: z.number().min(0).max(1).nullable(),
    severity: severitySchema,
    fingerprint: z.string(),
    runId: z.string().nullable(),
    title: z.string(),
    summary: z.string().nullable(),
    evidence: bugReportEvidenceSchema.nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "BugReport" });
```

The columns give everything but `title`, `summary` and `evidence`, which come from
`payload`, the validated body as stored (WS-089). The service parses the payload with
`submitBugReportRequestSchema`; a stored payload that no longer parses is a server error.
This cannot happen in v1: the schema only gets looser within a version (doc 0004
section 8).

### 2. Page size: a conflict with doc 0004, raised first (hard rule 11)

Doc 0004 section 5 gives every list a `limit` of 50 by default, 100 at most. A report can
be about 500 KB at the limits of WS-089 section 1, so a full page could pass 50 MB. This
spec proposes that a list whose items can be that large may set a lower default and
maximum, and says so in its contract (question 1):

- `bugReportListQuerySchema`: `limit` 10 by default, 25 at most; `cursor` as usual.
- Doc 0004 section 5 gains one sentence: "A list whose items can be large (the bug reports
  of a task) may set a lower default and maximum; its work-spec and its contract say so."
  Item H writes the doc's other amendments, but this one lands with this item, the first to
  use it.

### 3. The list (`listBugReports`, in `src/server/services/bug-reports.ts`)

`listBugReports(actor, taskRef, query)`: `requirePermission(actor, "tasks:read")`;
`findLiveTask` (`404` for an unknown or deleted task); `requireProjectAccess`. Then:

```sql
select r.id, r.task_id, r.outcome, r.origin_layer, r.confidence, r.severity,
  r.fingerprint, r.run_id, r.payload, a.id as agent_id, a.name as agent_name,
  to_char(r.created_at at time zone 'utc', ISO_MS) as created_at,
  to_char(r.created_at at time zone 'utc', ISO_US) as cursor_time
from bug_reports r join accounts a on a.id = r.agent_account_id
where r.task_id = $task [and (r.created_at, r.id) < ($time, $id)]
order by r.created_at desc, r.id desc
limit $limit + 1
```

The cursor holds the time with microseconds and the id (doc 0004 section 5, WI-080), and
`bug_reports_task_idx (task_id, created_at, id)` serves the order. `confidence` is a
`real`: it is read as `r.confidence::float8` and rounded to 6 decimals, so `0.8` reads
back as `0.8`.

### 4. The operation

| Operation                                | Access       | Answers                                                                            |
| ---------------------------------------- | ------------ | ---------------------------------------------------------------------------------- |
| `GET /api/v1/tasks/{taskId}/bug-reports` | `tasks:read` | `200 BugReportPage`; `400` path or query; `404`; `401`/`403`/`429` by the document |

Viewers read reports, as they read the task's description, which already holds the same
evidence (question 3).

### 5. Links on the task (`src/lib/schemas/tasks.ts`, `services/tasks.ts`)

```ts
export const taskLinkSchema = z
  .strictObject({
    type: z.enum(TASK_LINK_TYPES),
    direction: z.enum(["outgoing", "incoming"]).meta({
      description: "`outgoing`: this task is a regression of the other; `incoming`: the reverse.",
    }),
    task: z.strictObject({ id: z.uuid(), key: z.string(), title: z.string() }),
  })
  .meta({ id: "TaskLink" });
```

`taskSchema` gains `links: z.array(taskLinkSchema)`; `taskSummarySchema` does not, so
board lists stay as they are (question 2). One list, with a `direction`, rather than a
`regressionOf` field: WT-09 adds its types to the same list without a breaking change.

`loadLinks(executor, taskId)` reads both directions in one statement, joined to `tasks` and
`projects` for the key, leaving out deleted tasks (question 4), ordered by type, direction,
then the other task's number. Every function that answers a `Task` calls it: `getTask`,
`createTask`, `updateTask`, `moveTask`, `restoreTask`, and the `current` of their
version conflicts. `toTask(row)` becomes `toTask(row, links)`, so the compiler finds every
call.

A new link changes the linked task's answer but not its `version`, and publishes nothing
for it: an open detail page of the closed bug shows the new incoming link on its next
load. This is acceptable for item F; WT-09, which lets people link by hand, decides the
event (question 5).

### 6. Access coverage

`bug-reports.listBugReports` joins `PROJECT_SCOPED` in
`project-access.integration.test.ts`; `tasks.loadLinks`, if exported, is internal.

## Files

| Path                                                                    | Change                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| `src/lib/schemas/bug-reports.ts`, `.test.ts`                            | modify: `BugReport`, its page, query, contract (tests first) |
| `src/lib/schemas/tasks.ts`, `tasks.test.ts`                             | modify: `TaskLink`, `links` on `Task` (tests first)          |
| `src/lib/openapi/contracts.ts`                                          | modify: register the contract                                |
| `src/server/services/bug-reports.ts`, `bug-reports.integration.test.ts` | modify: `listBugReports` (tests first)                       |
| `src/server/services/tasks.ts`, a new `task-links.integration.test.ts`  | modify: `loadLinks`, `toTask(row, links)` (tests first)      |
| `src/app/api/v1/tasks/[taskId]/bug-reports/route.ts`, its test          | create: `GET` (tests first)                                  |
| `src/server/services/project-access.integration.test.ts`                | modify: the new function                                     |
| test fixtures that build a `Task`                                       | modify: `links: []`                                          |
| `docs/canonical/0004-api-conventions.md`                                | modify: the sentence of section 2 (question 1)               |
| `docs/api/openapi.json`                                                 | regenerate                                                   |
| `docs/README.md`, WT-06, WI-090, WS-090                                 | modify: statuses                                             |

No migration, no new dependency.

## Data model changes

None.

## API contract

Additive: one operation (`BugReport`, `BugReportPage`) and one field on `Task` (`links`,
`TaskLink`). No existing field changes.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                 | Covers criterion |
| --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | `bugReportListQuerySchema`: default 10, 25 accepted, 0 and 26 refused; `bugReportSchema` parses a full and a minimal report; `taskSchema` requires `links`           | 1, 4, 5          |
| 2   | integration | two reports filed by the pipeline (one with full evidence, one minimal) read back newest first, every field as sent, the agent with kind `agent`, `confidence` `0.8` | 1                |
| 3   | integration | an empty page for a task with no reports; `404` for an unknown task and a deleted one                                                                                | 2                |
| 4   | integration | 12 reports sharing one `created_at` (set by SQL with the triggers off, as in WS-089) read in pages of 5: 12 distinct reports, in `id` order within the time          | 3                |
| 5   | integration | a regression filed by the pipeline: the new bug has an `outgoing` link to the closed one, the closed one an `incoming` link back, each with key and title            | 5                |
| 6   | integration | `links` is in the answers of get, update, move, restore and a `409`'s `current`; a task with no link has `[]`; the deleted linked task is left out                   | 5, 6             |
| 7   | integration | the route through `route()`: a Viewer's cookie and an agent's token with `tasks:read` read; `limit=26` is `400`; a restricted agent on another project is `403`      | 1, 2, 4          |
| 8   | integration | `project-access`: the coverage test classifies `listBugReports`; the restricted call answers `403`                                                                   | 7                |
| 9   | unit        | the OpenAPI document: the operation with `BugReportPage`, its `limit` maximum 25; `Task.links` of `TaskLink`; `docs/api/openapi.json` regenerated                    | 7                |
| 10  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                                                              | 7                |

## Risks and open questions

For the owner:

1. **A lower page size for reports, and a sentence in doc 0004** (section 2): 10 by
   default, 25 at most, rather than doc 0004's 50 and 100. The alternative is a lean list
   (no evidence) plus `GET /bug-reports/{id}` for one report, which WT-06 decision 15 did
   not plan. **Recommend: the lower size, and amend doc 0004 now.**
2. **`links` on `Task` only, not on `TaskSummary`** (section 5). Boards do not show links,
   and a summary stays one row. **Recommend: `Task` only.**
3. **Viewers read reports** (section 4): they already read the same evidence in the
   description. **Recommend: allowed, with `tasks:read`.**
4. **A deleted linked task is left out of `links`**, as deleted tasks leave every view
   (WT-03 decision 12); restoring it brings the link back. **Recommend: leave it out.**
5. **No event for the linked task** when the pipeline links to it (section 5).
   **Recommend: none in v1; WT-09 decides when people link by hand.**

Risks:

- **Response size.** Even at 25 reports a page can reach about 12 MB at the extreme
  limits. Real reports are far smaller; item F asks for the default 10.
- **Every `Task` answer gains one query** (`loadLinks`), on the primary key index of
  `task_links` and on `task_links_to_task_idx`. Lists are unaffected.
