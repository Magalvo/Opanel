# WS-089 — The bug report endpoint and the triage pipeline

- Status: Done (2026-11-20; approved by the owner the same day, questions 1 to 5 as
  recommended)
- Work-item: [WI-089](../work-items/WI-089-bug-report-pipeline.md)
- Canonical docs: [0001](../canonical/0001-ai-qa-agents-and-triage.md) sections 5 and 6;
  [0003](../canonical/0003-task-management.md) sections 4, 5, 7, 9 and 13;
  [0002](../canonical/0002-realtime-sync.md) (events);
  [0004](../canonical/0004-api-conventions.md) sections 4, 6 and 7;
  [WT-06](../work-tracks/WT-06-bug-reports-and-triage.md) decisions 3, 6 to 14 and
  questions 1 to 6; [WS-086](WS-086-triage-data-model.md) (tables),
  [WS-087](WS-087-triage-settings-api.md) (routing), [WS-088](WS-088-task-severity.md)
  (the task's bug fields)

## Approach

### 1. The request (`src/lib/schemas/bug-reports.ts`)

`submitBugReportRequestSchema` follows doc 0001 section 5 and WT-06 decision 12. Every
object is strict:

| Field                       | Rule                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `title`                     | required, trimmed, 1 to 200 characters (the task's title rule)                            |
| `fingerprint`               | required, 1 to 128 characters of printable ASCII (`/^[\x20-\x7E]{1,128}$/`)               |
| `originLayer`               | `OriginLayer`, default `unknown`                                                          |
| `severity`                  | `Severity`, default `medium`                                                              |
| `confidence`                | optional, a number from 0 to 1                                                            |
| `summary`                   | optional, up to 10 000 characters                                                         |
| `runId`                     | optional, 1 to 128 characters                                                             |
| `evidence`                  | optional object, every field optional:                                                    |
| `evidence.stepsToReproduce` | up to 50 strings of 1 to 1 000 characters                                                 |
| `evidence.expected`         | up to 4 000 characters; likewise `actual` and `diagnosis`                                 |
| `evidence.url`              | an `http:` or `https:` URL, up to 2 000 characters                                        |
| `evidence.http`             | `{ method, path, status, responseSnippet? }`: `method` 1 to 16 letters; `path` 1 to 2 000 |
|                             | characters; `status` an integer from 100 to 599; `responseSnippet` up to 4 000 characters |
| `evidence.consoleErrors`    | up to 50 strings of 1 to 2 000 characters                                                 |

The whole body is still under the 512 KiB of every request (WS-044): `413` beyond it.

### 2. The answers

```ts
createdBugReportSchema = z
  .strictObject({
    outcome: z.literal("created"),
    taskId: z.uuid(),
    taskKey: z.string(),
    assignedTeamId: z.uuid().nullable(),
  })
  .meta({ id: "BugReportCreated" });
deduplicatedBugReportSchema = z
  .strictObject({
    outcome: z.literal("deduplicated"),
    taskId: z.uuid(),
    taskKey: z.string(),
    occurrences: z.int().min(2),
  })
  .meta({ id: "BugReportDeduplicated" });
```

| Operation                                       | Access          | Answers                                                                                                                                          |
| ----------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/v1/projects/{projectId}/bug-reports` | `reports:write` | `201 BugReportCreated`; `200 BugReportDeduplicated`; `400`; `404`; `409 project_archived`; `413`; `415`; `401`/`403`/`429` added by the document |

Only agents hold `reports:write`, so a person gets `403`, as WT-06 decision 13 says.
`assignedTeamId` is `null` when no team owns the layer (WT-06 decision 3).

### 3. The pipeline (`src/server/services/bug-reports.ts`, new)

`fileBugReport(actor, projectRef, input)`: `requirePermission(actor, "reports:write")`,
then one transaction.

**Lock order.** `claimTaskNumber` locks the project's row for update. If two reports took
a shared lock on the project first and then tried to claim a number, they would deadlock.
The pipeline therefore never holds a shared project lock before a claim:

1. Read the project without a lock: `404`, then `requireProjectAccess` (`403`), then
   `409 project_archived`. This answers early; the locks below settle any race.
2. Take `pg_advisory_xact_lock(hashtextextended(project_id || ':' || fingerprint, 0))`.
   From here on, reports with the same fingerprint in the project run one at a time
   (WT-06 decision 6).
3. Look for the open task:
   `tasks t join columns c … where t.project_id = $p and t.fingerprint = $f and
t.deleted_at is null and c.category <> 'done' order by t.last_reported_at desc nulls
last, t.created_at desc limit 1`. Normally there is at most one. Several can exist
   when a person moves a closed bug back to an open column; the latest reported wins.
4. **Found: a repeat.**
   - `lockWritableProject(tx, actor, project, "shared")`, as every task edit takes it,
     which also re-checks the archive.
   - Lock the task `for update`.
   - Read the previous report on it (the latest `bug_reports` row of that task).
   - `update tasks set occurrences = occurrences + 1, last_reported_at = now(),
version = version + 1, updated_at = now()`. Column, team, assignee and severity
     stay as they are (doc 0001 section 6).
   - Insert the report (`outcome = 'deduplicated'`).
   - Record `reported_again` in the history (actor: the agent; `newValue:
{ reportId, occurrences }`).
   - Add the system comment if section 5 says so.
   - Publish `task.updated`, and answer `200`.
5. **Not found: a creation.**
   - `claimTaskNumber(tx, actor, project.id)` (the exclusive lock; it re-checks the
     archive).
   - Route (section 4). Place the bug (section 6).
   - Find the closed bug to link: the same fingerprint, not deleted, in a `done` column,
     ordered by `updated_at desc` (WT-06 decision 9).
   - Insert the task: type `bug`, the title, the severity, the description (section 7),
     reporter the agent, the team or `null`, no person, the fingerprint,
     `occurrences = 1`, `last_reported_at = now()`.
   - Record `created` with the agent as actor (`newValue` as in `createTask`, plus
     `severity` and `reportId`).
   - Insert the `regression_of` link (`created_by` the agent).
   - Insert the report (`outcome = 'created'`).
   - Add the system comment (section 5). Publish `task.created`, and answer `201`.
6. **Audit** in both cases: `bug_report.triaged`, entity `bug_report`, entity id the
   report's id, `data: { taskId, outcome, assignedTeamId }` (WT-06 decision 14);
   `assignedTeamId` is the task's team at that moment.

Two reports with different fingerprints take different advisory locks and meet only on
the project's row. Two repeats share it, as two edits do; two creations wait for each
other's claim, as two `createTask` calls do. Nothing takes the advisory lock while holding
a project lock, so there is no cycle.

### 4. Routing (`routeBugReport`, in the same file)

`unknown` goes to `projects.triage_team_id`. Any other layer goes to its
`routing_rules` row if there is one, else to the triage team. With neither, the result
is `null` (WT-06 decision 3). It is read inside the transaction, after the claim, so a
concurrent triage change (which bumps the project's version under the same row lock) is
either fully before or fully after.

### 5. System comments (`addSystemComment`, exported from `comments.ts`)

`insert into comments (task_id, kind, author_account_id, body) values (…, 'system', null,
…)`. It records `commented` in the history with the agent as actor (the account whose
action caused the comment) and publishes `comment.created`, as `createComment` does. The
comment itself has no author and shows as "Opanel" (WS-034, WS-074).

Texts, in English like the rest of the UI:

- Created, routed: `Filed by <agent name> from a bug report: layer <layer>, confidence
<n>, severity <s>. Assigned to <team>.` (`confidence` is left out when absent.)
- Created, no team: the same first sentence, then `No team owns the <layer> layer in
this project, and it has no triage team: triage this bug by hand.`
- Regression: one more sentence, `Regression of <KEY>.`
- Repeat: `Reported again by <agent name>` + ` in run <runId>` when there is one + `.
Reported <n> times.`

Names, layers and keys are placed as plain text; `runId` is in a code span whose
backticks are longer than any run inside it (section 7).

**When a repeat gets a comment** (WT-06 decision 10): the previous report on the task is
more than an hour old (`created_at < now() - interval '1 hour'`), or its `run_id` is
distinct from the new one (`is distinct from`, so `null` and a value differ). The previous
report is read before the new one is inserted.

### 6. Placement (`placeNewBug`, in the same file)

`placeNewBug(tx, projectId)` locks the first column (`order by position limit 1 for no key
update`) and returns `{ columnId, position: positionBetween(null, first) }`, where `first`
is the lowest position in that column, deleted tasks included, as `createTask` counts them.
That puts the bug at the top (WT-06 decision 7). WT-10 changes only this function.

### 7. The description (`src/server/services/bug-report-description.ts`, pure)

`renderBugDescription(input): string` builds Markdown from fixed `###` headings, in this
order, each present only when its value is:

| Heading            | Content                                                            |
| ------------------ | ------------------------------------------------------------------ |
| Summary            | `summary`                                                          |
| Steps to reproduce | one fenced block per step, numbered in plain text before it (`1.`) |
| Expected           | `expected`                                                         |
| Actual             | `actual`                                                           |
| URL                | `url`                                                              |
| HTTP               | `method path → status` on one line, then `responseSnippet` if any  |
| Console errors     | one fenced block per error                                         |
| Diagnosis          | `diagnosis`                                                        |

Every value goes in a fenced block (` ```text `), whose fence has three backticks or one
more than the longest run of backticks in the value. Before that:

- Control characters other than newline and tab are removed.
- `\r\n` and `\r` become `\n`.

A value therefore cannot close its fence, open a heading, a link or HTML outside it.
Markdown is already rendered without raw HTML (WS-038).

The task's description is at most 50 000 characters (`taskDescriptionSchema`), and a
report at its limits can render longer. Sections are added in order until the next would
pass 49 800 characters. Then a last line says `The report is longer than a description
holds; it is kept whole in the task's reports.` (item E lists them). People can then still
save the description without trimming it first (question 2).

### 8. Access coverage

`bugReports.fileBugReport` joins `PROJECT_SCOPED` in
`project-access.integration.test.ts`, with a restricted agent filing into another project
(`403`). `placeNewBug`, `routeBugReport` and `comments.addSystemComment` are listed as
internal.

## Files

| Path                                                                    | Change                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/lib/schemas/bug-reports.ts`, `.test.ts`                            | modify: request, answers, contract (tests first)                   |
| `src/lib/openapi/contracts.ts`                                          | modify: register the contract                                      |
| `src/lib/schemas/audit.ts`, `audit.test.ts`                             | modify: `bug_report.triaged`                                       |
| `src/server/services/bug-report-description.ts`, `.test.ts`             | create: the renderer (unit tests first)                            |
| `src/server/services/bug-reports.ts`, `bug-reports.integration.test.ts` | create: the pipeline, routing, placement (tests first)             |
| `src/server/services/comments.ts`, `comments.integration.test.ts`       | modify: `addSystemComment`                                         |
| `src/server/services/task-events.ts`                                    | modify: `reported_again` in `TaskEventType`                        |
| `src/app/api/v1/projects/[projectId]/bug-reports/route.ts`, its test    | create: `POST` (tests first)                                       |
| `src/server/services/project-access.integration.test.ts`                | modify: the new functions                                          |
| `docs/api/openapi.json`                                                 | regenerate                                                         |
| `docs/README.md`, WT-06, WI-089, WS-089                                 | modify: statuses; a Follow-up on `bug_reports` growth (WT-06 q. 6) |

No migration (WS-086 created every table, `reported_again` included), no new dependency.

## Data model changes

None.

## API contract

Additive: one new operation, its request schema and its two answers (section 2). No
existing schema changes.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                               | Covers criterion |
| --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | the request: defaults (`unknown`, `medium`); every limit of section 1 at its edge and one past it; a non-ASCII fingerprint, a `ftp:` URL, status 600, an unknown key at each level are refused     | 9                |
| 2   | unit        | `renderBugDescription`: headings in order, absent sections left out; a value with ` ``` ` and ` ```` ` gets a longer fence; `# h`, `[x](y)`, `<img>`, `\u0000`, `\r\n` stay inside their fence     | 8                |
| 3   | unit        | `renderBugDescription`: a report at every limit stays under 50 000 characters and ends with the "kept whole" line                                                                                  | 8                |
| 4   | integration | a creation: answer `201`, the task's fields, top of the first column (above an existing task), `occurrences` 1, history `created` by the agent, the stored report, the audit entry, `task.created` | 1, 7             |
| 5   | integration | routing: a layer with a rule, a layer without one (triage team), `unknown` (triage team), nothing at all (`null` and the "no team" comment)                                                        | 2                |
| 6   | integration | a repeat: answer `200`, count 2, `lastReportedAt` moves, column, team, assignee and severity unchanged after a person changed them, `reported_again` by the agent, `task.updated`, no new task     | 3, 7             |
| 7   | integration | the comment rule: same run within the hour, no comment; another `runId`, a comment; a previous report backdated past an hour (by SQL), a comment                                                   | 6                |
| 8   | integration | a closed match: a new bug linked `regression_of` to the most recently updated closed bug, named in the comment; a soft-deleted open bug of that fingerprint is neither counted nor linked          | 5                |
| 9   | integration | concurrency: ten identical reports at once give one task with `occurrences` 10 and ten stored reports; ten different fingerprints give ten tasks with distinct keys; no error                      | 4                |
| 10  | integration | access: a person (Admin) `403`; an agent without `reports:write` `403`; a restricted agent on another project `403`; unknown project `404`; archived project `409 project_archived`                | 9                |
| 11  | integration | `addSystemComment`: kind `system`, no author, a `commented` entry with the agent, `comment.created`                                                                                                | 7                |
| 12  | integration | the route through `route()` with a bearer token: `201` then `200`; an invalid body is `400` naming `evidence.http.status`; a cookie session (an Admin) gets `403`                                  | 1, 3, 9          |
| 13  | integration | `project-access`: the coverage test classifies the new functions; the restricted call answers `403`                                                                                                | 10               |
| 14  | unit        | the audit catalogue includes `bug_report.triaged`; the OpenAPI document has the operation with `200` and `201`; `docs/api/openapi.json` regenerated                                                | 7, 10            |
| 15  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                                                                                            | 10               |

## Risks and open questions

For the owner:

1. **System comment texts** (section 5), in English, plain and fixed. **Recommend: as
   written.**
2. **A description that would pass 50 000 characters is cut at a section boundary**
   (section 7), with a line pointing to the stored report, rather than storing a longer
   description that people could then not save. **Recommend: cut.**
3. **A repeat on a task that is no longer a bug** (a person changed its type) still counts
   on it: the fingerprint is what matches. The alternative is to match only `type =
'bug'`, which would create a duplicate. **Recommend: count it.**
4. **The answers add `taskKey`** to doc 0001's shapes, as WT-06 decision 13 says, and
   nothing more (no report id). **Recommend: as decided.**
5. **A system comment records a `commented` history entry with the agent as actor**
   (section 5), like a person's comment, so the history shows why the comment appeared.
   **Recommend: record it.**

Risks:

- **Throughput.** Each report holds its advisory lock for one short transaction. Repeats
  of one fingerprint are serial by design, and creations in one project are serial as
  `createTask` already is. Test 9 measures both shapes. Volume beyond that is limited by
  the per-token rate limit (WS-083).
- **Untrusted text.** Section 7 and tests 2 and 3. The task's title is plain text, shown
  escaped like every title.
- **Growth of `bug_reports`.** Every repeat adds a row (WT-06 question 6). A Follow-up
  names it in `docs/operations.md`'s list of tables that grow.

## Deviations from the approved spec

1. **The renderer also exports `fenced` and `codeSpan`.** `codeSpan` puts the `runId` of a
   repeat's comment in a code span (section 5). The coverage test lists the three as pure.
2. **`addSystemComment` and `createComment` share one private `insertComment`**, so a
   system comment records its history entry and event exactly as a person's does.
3. **The task's event comes before its comment's.** `task.created` and `task.updated` are
   published before the system comment's `comment.created`, so a board learns of a task
   before its comment. Section 3 listed the comment first.
4. **The comment rule's test backdates reports.** The test database's owner disables the
   user triggers of `bug_reports` for one `update`, then enables them again. There is no
   other way to make a stored report an hour old; the append-only rule is unchanged.

## Implementation record

- Red:
  - the request, answer and contract tests failed on the missing schemas;
  - the renderer tests and the pipeline tests failed to import their modules;
  - the `addSystemComment` test failed (`addSystemComment is not a function`);
  - the audit catalogue test failed on 37 actions;
  - the coverage test failed with the seven new functions unclassified;
  - the route test failed to import `./route`;
  - the OpenAPI test failed with the operation missing, as did the routes test.
- Green:
  - request and contract: 5 cases; renderer: 4 cases; pipeline: 7 cases, ten concurrent
    reports included; `addSystemComment`: 1 case; route: 1 case; OpenAPI: 1 case;
  - the coverage test: 89 of 89, with `fileBugReport` refusing another project with `403`,
    archived or not.
- One test expectation was wrong, not the code: at every limit the steps alone are 50 000
  characters, so the description stops after the summary, as section 7 says.
- `pnpm openapi:generate` adds the operation, `SubmitBugReportRequest`,
  `BugReportEvidence`, `BugReportCreated` and `BugReportDeduplicated`; `Severity` moves
  earlier in the file, unchanged.
- **A narrow race, accepted.** Between the lookup of the open task and its lock, a person
  can move it to a `done` column or delete it, and the repeat is then counted on it.
  Retrying as a creation would take the exclusive project lock after the shared one, the
  deadlock section 3 avoids. The window is one statement long, and the report is kept
  either way.
- Gate on 2026-11-20:
  - typecheck, lint and Prettier pass;
  - Vitest 1695 of 1695;
  - `pnpm test:e2e --retries=0` 88 of 88;
  - Windows 11, Node 24.18.0, pnpm 10.28.0, Compose PostgreSQL 18 on port 5433.
