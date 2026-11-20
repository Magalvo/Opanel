# WS-094 — The triage flow end to end, filing bug reports in the guide, and WT-06's amendments

- Status: Proposed
- Work-item: [WI-094](../work-items/WI-094-triage-flow-and-guide.md)
- Canonical docs: [0001](../canonical/0001-ai-qa-agents-and-triage.md) sections 5, 6 and
  7 (amended here); [0003](../canonical/0003-task-management.md) sections 7 and 13
  (section 7 amended here); [0002](../canonical/0002-realtime-sync.md) (live boards);
  [WT-06](../work-tracks/WT-06-bug-reports-and-triage.md) decisions 3, 4, 6, 7, 9, 10, 13
  and 16, and its exit criteria; [WS-078](WS-078-agent-flow-and-guide.md) (the guide and
  its check); [WS-086](WS-086-triage-data-model.md) to [WS-092](WS-092-triage-section.md)
  (what was built)

## Approach

Item H adds no application code. It proves the flow end to end, documents it for agent
authors, writes the canonical amendments WT-06 promised, and closes the track.

### 1. The end-to-end test (`tests/e2e/triage-flow.spec.ts`, new)

One test, in the style of `agent-flow.spec.ts` (WS-078) and `live-board.spec.ts` (WS-048).
Every name and key carries a random id, so parallel workers never meet.

**Setup, through the API, as the Admin** (the UI of each step is already tested: agents
and tokens in `agent-flow.spec.ts`, the Triage section in `projects.spec.ts`):

1. `seedAccount` an Admin and sign in.
2. `POST /api/v1/teams` twice: "API team <id>" and "Triage team <id>".
3. `POST /api/v1/projects` twice: the project under test and another one.
4. `POST /api/v1/projects/{key}/tasks`: one ordinary task, so "top of the first column" is
   not trivially true.
5. `PATCH /api/v1/projects/{key}/triage` with `{ triageTeamId, rules: { api }, version }`.
6. `POST /api/v1/agents` (`qa_agent`, restricted to the project under test) and
   `POST /api/v1/agents/{agentId}/tokens`: the agent's token, as an agent author receives
   it. The agent is then a separate `APIRequestContext` with only
   `Authorization: Bearer`, no cookie.

**Two open boards.** The Admin's page and a Member's page (a browser context of its own,
as `live-board.spec.ts` does) open the board and wait for the events stream (`200`).

**The flow**, each step asserted on both boards without a reload (the pages count
navigations, as `live-board.spec.ts` does, and must see none):

| Step | The agent sends                                             | The answer                                                                   | Both boards show                                                                                |
| ---- | ----------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| a    | a full report: layer `api`, severity `high`, fingerprint F1 | `201`, `outcome: created`, `assignedTeamId` = API team, `taskKey`            | the bug's card is the first card of the first column, with "API team <id>" and "Severity: High" |
| b    | the same fingerprint, another `runId`                       | `200`, `outcome: deduplicated`, same `taskId` and `taskKey`, `occurrences` 2 | still one card with that title; it shows "2 reports"                                            |
| c    | layer `unknown`, fingerprint F2                             | `201`, `assignedTeamId` = triage team                                        | a second bug card, first in the column, with "Triage team <id>"                                 |
| d    | F1 into the other project                                   | `403`                                                                        | nothing new                                                                                     |

**The detail**, on the Admin's page, of the bug of step a: the severity select reads High;
"Reported 2 times, last on …"; the Reports region has two articles, the newest naming the
agent with its "Agent" badge; the description has the "Steps to reproduce" heading and a
step's text; the Comments region has the two system comments ("Filed by <agent> from a
bug report: …Assigned to API team <id>." and "Reported again by <agent> in run …").

**The regression.** The Admin moves the bug to the `done` column (`POST /tasks/{key}/move`).
The agent sends F1 again: `201 created`, a new key. The new bug's detail has the Links
region with "Regression of" and a link to the first bug.

**Seeing it fail first.** The code under test exists, so the test cannot fail by being
written early (WS-091 met the same case). The test is written in full and first run
against two temporary mutations of `src/server/services/bug-reports.ts`, each reverted
right after and recorded in the Implementation record, to show it fails for the right
reason (question 1):

- `placeNewBug` returns a position after the last card: step a fails on "first card".
- `routeBugReport` ignores the rule for the layer: step a fails on the team.

Then it runs green against the unchanged code.

### 2. The guide (`docs/agents.md`)

A new section **"Filing bug reports"**, after "Live updates" and before "Rotating and
revoking" (question 2):

- **The endpoint.** `POST /api/v1/projects/{projectId}/bug-reports`, scope
  `reports:write`; `projectId` is the id or the key. Only agents hold the scope.
- **The body.** A complete JSON example (the one doc 0001 section 5 shows, in strict
  JSON), then a table of the fields: required `title` and `fingerprint`; defaults
  (`originLayer` `unknown`, `severity` `medium`); `confidence` 0 to 1; `runId`; the limits
  of WS-089 section 1 summarised, with "the OpenAPI document has every limit"
  (`SubmitBugReportRequest`). Unknown fields are refused.
- **The two outcomes.** `201` with `outcome: "created"`, `taskId`, `taskKey` and
  `assignedTeamId` (`null` when no team owns the layer: the bug is created unassigned and
  a comment says why). `200` with `outcome: "deduplicated"`, `taskId`, `taskKey` and
  `occurrences`. Both mean the report is kept; never retry a `2xx`.
- **Where a bug goes.** The layer table of doc 0001 section 5 (meaning of each layer);
  routing by the project's triage settings (`GET /api/v1/projects/{projectId}/triage`
  with `projects:read` shows which team gets each layer); `unknown` and a layer without a
  team go to the triage team. A new bug goes to the top of the first column.
- **Fingerprints.** What makes two reports the same bug: a hash (for example SHA-256, hex)
  of the layer, the normalised route or endpoint (`/orders/{id}`, not `/orders/42`) and
  the error signature (the error type and message without values). Never timestamps, ids,
  run ids or random values. 1 to 128 printable ASCII characters. While the bug is open,
  a repeat counts on it; once it is closed, the same fingerprint opens a new bug linked
  as a regression of the old one.
- **Repeats and comments.** A repeat adds a comment only when the last report is over an
  hour old or came from another `runId`; send the same `runId` for one test run.
- **Reading reports.** `GET /api/v1/tasks/{taskId}/bug-reports` (`tasks:read`), newest
  first, 10 by default and 25 at most; the task's `GET` has `severity`, `occurrences`,
  `lastReportedAt` and `links`.
- **Errors specific to it**: `409 project_archived`, `403` for a project outside the
  restriction, `400` naming the field.
- **A ready-made client.** One line pointing to the optional PostHog add-on
  ([`addons/posthog/README.md`](../../addons/posthog/README.md), WT-13, WI-093), which
  files reports this way from PostHog alerts.

Other changes in the guide:

- The `reports:write` row: "Submit bug reports" (drop "WT-06, not yet").
- "What comes next" keeps only the MCP server (WT-11).

### 3. The guide's doc check (`scripts/agents-guide.test.ts`, tests first)

- `SECTIONS` gains "Filing bug reports" in its place.
- **The layers.** The code spans of the section that are origin layers equal
  `ORIGIN_LAYERS` as a set, and the section has a table row for each.
- **The outcomes.** The section names each of `BUG_REPORT_OUTCOMES` in a code span.
- **The example.** The first ` ```json ` block of the section parses as JSON and
  `submitBugReportRequestSchema` accepts it, so the example can never drift from the API.
- **No "not yet".** The guide no longer says "not yet" anywhere (question 3).

The existing checks then cover the rest: `unknownEndpoints` checks the two new endpoints,
and the errors section's codes stay real.

### 4. The amendments to the canonical docs (written to match the code)

Every point below was read in the code or in WS-086 to WS-092; where a work-spec deviated
from WT-06, the amendment follows the code and names the work-spec.

**Doc 0001, header.** "Amended by" gains: WT-06 decisions 3, 6, 9, 10 and 13 (applied
2026-11-20 by WI-094).

**Doc 0001, section 5 (the contract).**

- The answers: `201 { outcome: "created", taskId, taskKey, assignedTeamId }`, where
  `assignedTeamId` may be `null`; `200 { outcome: "deduplicated", taskId, taskKey,
occurrences }`. `taskKey` is the amendment (WT-06 decision 13, WS-089 question 4).
- The errors: add `409 project_archived`, `413`, `415`; a person (no `reports:write`) gets
  `403`.
- Defaults: `originLayer` `unknown`, `severity` `medium`; the limits are those of the
  request schema (WS-089 section 1), published in the OpenAPI document.

**Doc 0001, section 6 (the pipeline).**

- **"Open"** is: not deleted, and in a column whose category is not `done`. A
  soft-deleted bug is neither counted nor linked: a report about it creates a new task
  (WT-06 decision 9).
- **Found**: the repeat counts on the task whatever its type is now (WS-089 question 3).
  The system comment is added only when the previous report on the task is more than an
  hour old or came with another `runId` (WT-06 decision 10, question 4 here).
- **Not found, closed match**: the new bug gets a `regression_of` link to the most
  recently updated closed task with that fingerprint, and its first comment names it.
- **Route**: with no rule for the layer and no triage team, the bug is created with no
  team, and its first system comment says no team owns the layer (WT-06 decision 3).
  "Fallback triage team" becomes "triage team" (`projects.triage_team_id`).
- **Create**: at the top of the first column (`placeNewBug`, the one function WT-10
  changes for sprint projects).
- **Audit**: `bug_report.triaged` with the report, task, outcome and team, the agent as
  actor; the task's history records `created` or `reported_again` with the agent.
- **Concurrency** (replaces "A unique partial index … makes dedupe safe"): the
  transaction takes `pg_advisory_xact_lock` on the project and fingerprint before looking
  for the open task, so reports with one fingerprint run one after another; a non-unique
  index on `(project_id, fingerprint)` keeps the lookup fast. Why not a partial index:
  "open" depends on the column's category, which an index on `tasks` cannot see (WT-06
  decision 6). The window WS-089 accepted is stated: a person closing or deleting the
  task in the instant between the lookup and its lock gets the repeat counted on it.
- **Routing rules**: read and changed through `GET`/`PATCH
/api/v1/projects/{projectId}/triage` and the project's "Triage" settings section,
  `teams:manage` to change.

**Doc 0001, section 7 (the sketch).** `projects(…, fallback_team_id)` becomes
`triage_team_id`; `tasks` gains `version` and `deleted_at`; `task_links(from_task_id,
to_task_id, type, created_by, created_at)`; `bug_reports(id, project_id,
agent_account_id, task_id, outcome, origin_layer, confidence, severity, fingerprint,
run_id, payload, created_at)`, append-only (question 5).

**Doc 0003 section 7.** After the links table: WT-06 created `task_links` with the one
type `regression_of`, written only by the triage pipeline; WT-09 adds the other types and
linking by hand to the same table. A task's answer leaves out links to deleted tasks
(WS-090). Header: "Amended by: WT-06 (section 7, applied 2026-11-20 by WI-094)".

**WT-06 decision 4 and item B's row** say `PUT`; WS-087 built `PATCH` (doc 0004 section 6
uses no `PUT` in v1), approved by the owner. The text is corrected to `PATCH` with a
pointer to WS-087 (question 6).

### 5. Closing WT-06

- Each exit criterion is checked off with the test that proves it, read again in the
  code, not taken from the work-specs' summaries. If one turns out unmet, this item
  stops and raises it rather than closing the track.
- Item H's row links WI-094; WT-06's status becomes Done.
- `docs/README.md` Follow-ups gains: **WT-10 places agent-filed bugs at the top of the
  backlog in sprint projects** (doc 0003 section 13, question 1; WT-06 decision 7): its
  work-spec changes `placeNewBug` in `src/server/services/bug-reports.ts`, and nothing
  else in the pipeline.
- "Where the project stands": WI-094 last finished, WT-06 done, "Next:" WT-11 (the MCP
  server).

## Files

| Path                                               | Change                                                    |
| -------------------------------------------------- | --------------------------------------------------------- |
| `tests/e2e/triage-flow.spec.ts`                    | create: the flow (section 1)                              |
| `scripts/agents-guide.test.ts`                     | modify: the new section's checks (section 3, tests first) |
| `docs/agents.md`                                   | modify: "Filing bug reports", the scope row, next steps   |
| `docs/canonical/0001-ai-qa-agents-and-triage.md`   | modify: sections 5, 6, 7 and the header                   |
| `docs/canonical/0003-task-management.md`           | modify: section 7 and the header                          |
| `docs/work-tracks/WT-06-bug-reports-and-triage.md` | modify: `PATCH`, item H, exit criteria, status Done       |
| `docs/README.md`, WI-094, WS-094                   | modify: statuses, index, Follow-up for WT-10, "Next:"     |

`src/server/services/bug-reports.ts` is mutated only temporarily for section 1's red
runs and is unchanged in the commit. No migration, no new dependency, no API change, so
`docs/api/openapi.json` does not change.

## Data model changes

None.

## API contract

None. The docs describe the contract that exists.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                                                                    | Covers criterion |
| --- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit  | the guide's check: `SECTIONS` with "Filing bug reports" after "Live updates" (red until the section exists)                                                             | 6                |
| 2   | unit  | the section's origin layers are exactly `ORIGIN_LAYERS`, each in a table row; both `BUG_REPORT_OUTCOMES` are named                                                      | 5, 6             |
| 3   | unit  | the section's first JSON example parses and `submitBugReportRequestSchema` accepts it                                                                                   | 5, 6             |
| 4   | unit  | the guide says "not yet" nowhere (red on today's `reports:write` row)                                                                                                   | 5, 6             |
| 5   | e2e   | setup and step a: `201`, the layer's team, the card first in the first column on both boards with team and severity, no reload; red with the two mutations of section 1 | 1                |
| 6   | e2e   | step b: `200 deduplicated`, `occurrences` 2, one card, "2 reports" on both boards, no reload                                                                            | 2                |
| 7   | e2e   | steps c and d: `unknown` to the triage team; the other project `403`                                                                                                    | 3                |
| 8   | e2e   | the detail: severity, "Reported 2 times", two reports with the agent, the description's evidence, both system comments; the regression after a move to `done`           | 4                |
| 9   | gate  | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                                                                 | 9                |

Tests 5 to 8 are one Playwright test, written whole before its first run.

## Risks and open questions

For the owner:

1. **Red for the E2E test by temporary mutation** (section 1). The code already exists,
   so the test would pass on its first run; two mutations show it fails on the right
   assertions, then are reverted, and the record says so, as WS-086 deviation 1 did.
   The alternative is to record that it could not fail first. **Recommend: the two
   mutations.**
2. **Where the new guide section goes:** after "Live updates", before "Rotating and
   revoking", so the guide reads from reading the API to writing reports to token
   upkeep. **Recommend: there.**
3. **The guide check refuses "not yet" anywhere** in `docs/agents.md`, so no
   "coming soon" row survives the feature landing. The alternative is to fix the row
   only. **Recommend: the check.**
4. **Doc 0001 is also amended for WT-06 decision 10** (a repeat's comment only after an
   hour or another `runId`). WT-06 named decisions 3, 6 and 9 as amendments, but
   section 6 says "add a system comment" on every repeat, which the code no longer does;
   hard rule 11 does not let the doc and the code disagree. **Recommend: amend for
   decision 10 too.**
5. **Doc 0001 section 7's sketch is brought to the names that exist**
   (`triage_team_id`, the columns of `bug_reports` and `task_links`), though it says "not
   a final schema". It is the one place an agent author or a new contributor sees the
   model whole. **Recommend: update it.**
6. **WT-06 decision 4's `PUT` is corrected to `PATCH`** in the text and in item B's row,
   with a pointer to WS-087, where the owner approved `PATCH`. The alternative is to leave
   WT-06 as approved and rely on WS-087. **Recommend: correct it, so the closed track
   reads true.**
7. **The E2E test sets up through the API, not the UI** (section 1), because the UI of
   agents, tokens and the Triage section has its own end-to-end tests; the flow's subject
   is triage. **Recommend: the API.**

Risks:

- **Load on the shared PostgreSQL.** WS-091 saw end-to-end timeouts while another
  session's tests loaded the same server. The gate is run when no other `opanel_*_test`
  database has connections, and any flaky run is recorded, never papered over.
- **Live assertions.** Boards learn of the bug through `task.created` and of the count
  through `task.updated`; the test waits for the board's stream before the first report,
  as `live-board.spec.ts` does, so no event is lost to a stream that opened late.
- **An exit criterion found unmet** while closing the track stops this item (section 5).
