# WS-091 — Bugs in the UI

- Status: Done (2026-11-20; approved by the owner the same day, questions 1 to 7 as
  recommended)
- Work-item: [WI-091](../work-items/WI-091-bugs-in-the-ui.md)
- Canonical docs: [0001](../canonical/0001-ai-qa-agents-and-triage.md) section 5 (what a
  report holds); [0002](../canonical/0002-realtime-sync.md) (live updates);
  [0003](../canonical/0003-task-management.md) sections 4 (severity) and 7 (links);
  [WT-06](../work-tracks/WT-06-bug-reports-and-triage.md) decision 15 and item F;
  [WS-037](WS-037-board-page.md) and [WS-038](WS-038-task-detail.md) (the board and the
  detail), [WS-049](WS-049-live-detail-epics-settings.md) (live detail), [WS-074](WS-074-agent-badge.md)
  (`AccountName`), [WS-080](WS-080-lists-without-duplicates.md) (`usePagedList`),
  [WS-088](WS-088-task-severity.md) (severity), [WS-090](WS-090-reading-bug-reports.md)
  (reports and `links`)

## Approach

The API is complete (WS-088, WS-090); this item is UI only. Everything is read and written
through `/api/v1` (AGENTS.md section 3). No new dependency, no migration, no contract
change.

### 1. Shared labels (`src/components/task/bug-labels.ts`, new)

One place for the words the card and the detail use, so they cannot drift:

- `SEVERITY_LABELS`: `low` "Low", `medium` "Medium", `high` "High", `critical` "Critical".
- `LAYER_LABELS`: `frontend` "Frontend", `api` "API", `backend` "Backend", `unknown`
  "Unknown".
- `OUTCOME_LABELS`: `created` "New bug", `deduplicated` "Repeat".
- `reportedText(occurrences, lastReportedAt)`: "Reported once, last …" is wrong English, so
  1 gives "Reported once, on {time}" and N gives "Reported N times, last on {time}".
- `confidenceText(0.8)`: "80%"; `null` gives "Not given".

Times use `toLocaleString()`, as every other time in the detail does (question 4).

### 2. The card (`src/components/board/task-card.tsx`)

`CardBody` gains, in its badge row after the type badge:

- **Severity**, when `task.severity !== null`: `<Badge>` with the label, `destructive`
  variant for `high` and `critical`, `outline` for `low` and `medium`, and a visually
  hidden "Severity: " before the word, so a screen reader says "Severity: High" and the
  card stays short (question 1). Colour is never the only signal: the word is always there.
- **Count**, when `task.occurrences > 1`: "{N} reports" as muted text with a small icon.

`TaskSummary` already carries both fields (WS-088), and the board reads a task again on
`task.updated` ([WS-048](WS-048-live-board.md)), so an open board shows a new count with no further change.

### 3. Severity in the detail (`src/components/task/details-section.tsx`)

- `Draft` gains `severity: Severity | null`; `draftOf` and `changesOf` handle it.
  `changesOf` sends `severity` only when it changed **and** the draft's type is `bug`;
  when the draft's type is not `bug`, nothing is sent for severity (the server clears it
  on the type change, WS-088 section 2).
- The form shows a "Severity" select (options "No severity", Low, Medium, High, Critical)
  only while `draft.type === "bug"`, beside Type. Changing the type to `bug` shows it with
  the task's value (`null` unless set); a type change and a severity in the same save is
  one `PATCH`, which the server accepts (it computes the type first).
- A `400` with an issue at `severity` shows under the select, like the other fields.
- The read-only list gains a "Severity" row for a bug ("None" when `null`).

### 4. The bug section (`src/components/task/bug-section.tsx`, new)

Rendered by `TaskDetail` between `DetailsSection` and `CommentsSection`, and only when
there is something to show: `occurrences > 0`, or `links` not empty. It holds:

- **"Reported N times, last on …"** when `occurrences > 0` (section 1).
- **Links**, when `links` is not empty: a list grouped by direction, "Regression of" for
  `outgoing` and "Regressed by" for `incoming`, each item a `next/link` to
  `taskHref(link.task.key)` showing the key in mono and the title (question 7). Inside the
  board's dialog the link opens the other task the same way a card does (the intercepting
  route of WS-038).
- **Reports** (`ReportsSection`, below), when `occurrences > 0` (question 2).

### 5. The reports (`src/components/task/reports-section.tsx`, new)

- `api.ts` gains `listBugReports(key, cursor?)`, calling
  `GET /api/v1/tasks/{key}/bug-reports` with `cursor` when given and **no** `limit`, so the
  server's default of 10 applies (WS-090 section 2), parsed with `bugReportPageSchema`.
- `TaskDetail.load()` reads the first page together with the comments, only when the task
  has `occurrences > 0`; `Loaded` gains `reports` and `reportsCursor`. A task without
  reports makes no extra request.
- The section uses `usePagedList<BugReport>` (WS-080) with "Load more", and "Could not load
  more reports." on a failure, as the comments do.
- Each report is an `<article>` with a heading line that is always visible:
  `AccountName` of the agent (badge, WS-074), time, outcome; then a small `<dl>`: Layer,
  Confidence, Severity, Run ("None" when `runId` is `null`), Fingerprint. Below, the report's
  `title` in bold, and a native `<details>` "Evidence" (closed by default) holding the
  `summary` and each evidence field present: steps to reproduce as an ordered list;
  Expected, Actual, Diagnosis; URL; HTTP as "{METHOD} {path} → {status}" and the response
  snippet; console errors. Every value the agent sent is **plain text** in a
  `whitespace-pre-wrap break-words` element (long values in `<pre>` with
  `overflow-x-auto`), never Markdown, and the URL is text, not a link (question 3). React
  escapes text, so nothing the agent sent becomes markup.
- No report has been read yet but `occurrences > 0` (a race with the pipeline): "No
  reports yet."

### 6. Live (`task-detail.tsx`)

`refresh()` already reads the task again on `task.updated` and shows it (WS-049). When the
new task's `occurrences` or `lastReportedAt` differs from the shown one, the detail asks
the reports section to read again from the start, as many as it shows (at least the first
page), the way the comments do on a reconnect (WS-049 section 3); `onReconnect` does the
same. The count and the time come with the task itself. A repeat bumps the task's
`version` (WT-06 decision 10), so a viewer editing the form gets the usual "Someone else
changed this task" handling; no new message is added.

### 7. End to end (`tests/e2e/bugs.spec.ts`, new; `tests/e2e/seed.ts`)

`seed.ts` gains `seedAgentToken(agentId)`, which inserts an `api_tokens` row from
`generateApiToken()` (WS-072) for an agent from `seedAgent` and returns the token, so the
test files reports through the real `POST /api/v1/projects/{projectId}/bug-reports`.

## Files

| Path                                            | Change                                                         |
| ----------------------------------------------- | -------------------------------------------------------------- |
| `src/components/task/bug-labels.ts`, `.test.ts` | create: labels and texts (tests first)                         |
| `src/components/board/task-card.tsx`            | modify: severity badge and count                               |
| `src/components/board/board.test.tsx`           | modify: the card's badge and count (tests first)               |
| `src/components/task/details-section.tsx`       | modify: severity in the draft, the form and the read-only list |
| `src/components/task/bug-section.tsx`           | create: reported line, links, the reports section              |
| `src/components/task/reports-section.tsx`       | create: the paged list of reports and their evidence           |
| `src/components/task/api.ts`                    | modify: `listBugReports`                                       |
| `src/components/task/task-detail.tsx`           | modify: load reports, render the bug section, live reload      |
| `src/components/task/task-detail.test.tsx`      | modify: severity, links, reports, live (tests first)           |
| `src/components/board/test-data.ts`             | modify: a `bugReport()` fixture builder                        |
| `tests/e2e/seed.ts`                             | modify: `seedAgentToken`                                       |
| `tests/e2e/bugs.spec.ts`                        | create: the flow of test 9 (test first)                        |
| `docs/README.md`, WT-06, WI-091, WS-091         | modify: statuses                                               |

## Data model changes

None.

## API contract

None. Consumed: `GET`/`PATCH /api/v1/tasks/{taskId}` (`severity`, `occurrences`,
`lastReportedAt`, `links`) and `GET /api/v1/tasks/{taskId}/bug-reports`.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Covers criterion |
| --- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit  | `bug-labels`: every severity, layer and outcome has a label; `reportedText` for 1 and 3; `confidenceText` for 0.8, 1, 0 and `null`                                                                                                                                                                                                                                                                                                                                                     | 1, 3, 5          |
| 2   | unit  | the board: a bug with severity `high` and `occurrences` 3 shows "Severity: High" (accessible name) and "3 reports"; `occurrences` 1 shows no count; a task with no severity shows no badge; after a `task.updated`, the new count is shown                                                                                                                                                                                                                                             | 1, 6             |
| 3   | unit  | the detail, editable bug: the Severity select shows the value; choosing Critical and saving sends exactly `{ severity: "critical", version }`; "No severity" sends `null`; a `400` at `severity` shows under the select                                                                                                                                                                                                                                                                | 2                |
| 4   | unit  | the detail, type changes: a task changed to Bug shows the select and saves `{ type, severity }` in one `PATCH`; a bug changed to Task hides it and sends no `severity`                                                                                                                                                                                                                                                                                                                 | 2                |
| 5   | unit  | the detail, read-only (Viewer, archived): a Severity row, no select                                                                                                                                                                                                                                                                                                                                                                                                                    | 2, 7             |
| 6   | unit  | "Reported 3 times, last on …" and "Reported once, on …"; nothing for `occurrences` 0, and no request to `/bug-reports` then                                                                                                                                                                                                                                                                                                                                                            | 3, 5             |
| 7   | unit  | links: an outgoing and an incoming link render under "Regression of" and "Regressed by" as links to `/projects/OPA/tasks/OPA-n` with key and title; no links, no section                                                                                                                                                                                                                                                                                                               | 4                |
| 8   | unit  | reports: the first page is requested without `limit`; each report shows the agent with the "Agent" badge, outcome, layer, confidence, severity, run id; "Evidence" opens to the steps, HTTP line and console errors as plain text (a value with `**bold**` and `<b>` shows literally); "Load more" appends the next page once; a failed load shows the alert                                                                                                                           | 5                |
| 9   | unit  | live: a `task.updated` whose reread task has a higher `occurrences` updates "Reported …" and reads the reports again from the start; a reconnect does too                                                                                                                                                                                                                                                                                                                              | 6                |
| 10  | e2e   | `bugs.spec.ts`: a Manager's project; an agent token files a report (`high`, full evidence), then the same fingerprint twice; the board's card shows "Severity: High" and "3 reports"; the detail shows "Reported 3 times", three reports with the agent and "Agent", and the evidence; the Manager sets severity to Critical and the card follows; a report matching the bug after it is moved to Done creates a regression whose detail links back, and the link opens the closed bug | 1–6              |
| 11  | e2e   | the detail of a bug with reports passes axe in light and dark mode, and has no horizontal page scroll at phone width (as `task-detail.spec.ts` checks)                                                                                                                                                                                                                                                                                                                                 | 7                |
| 12  | gate  | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                                                                                                                                                                                                                                                                                                                                                                                | 8                |

## Risks and open questions

For the owner:

1. **The card's severity badge** (section 2): the word with a visually hidden "Severity: ",
   red (`destructive`) for High and Critical, outlined for Low and Medium; the count as
   "{N} reports" when above 1. The alternative is an icon or colour only, which fails
   people who cannot see colour and screen readers. **Recommend: as proposed.**
2. **When the Reports section shows** (section 4): when `occurrences > 0`, whatever the
   type (a person may turn a filed bug into a task; its reports still exist). A bug made
   by hand has none and shows none, with no request. **Recommend: `occurrences > 0`.**
3. **Evidence as plain text, the URL not a link** (section 5). Rendering it as Markdown
   would let a report shape the page, and a clickable URL from an agent is an easy
   phishing step; the description already holds the same evidence safely fenced (WS-089).
   Evidence is collapsed under "Evidence" per report so a long list stays readable.
   **Recommend: plain text, URL as text, collapsed.**
4. **Absolute times** (`toLocaleString()`), like every time in the detail today, rather
   than "3 minutes ago", which needs a ticking clock and a new helper. **Recommend:
   absolute.**
5. **Live reports** (section 6): read again from the start when the task's count or last
   time changes, rather than appending only the new report (the list is newest first, so a
   new one goes to the top; reading the first page again is simplest and cannot skip one).
   **Recommend: as proposed.**
6. **Severity editing only while the type is Bug** (section 3), and nothing sent for
   severity when the type changes away (the server clears it). **Recommend: as proposed.**
7. **Link labels**: "Regression of" (outgoing) and "Regressed by" (incoming). WT-09 adds
   other types to the same list and its own labels. **Recommend: these two.**

Risks:

- **The detail grows.** The bug section is a separate component and renders nothing for
  tasks that are not bugs and have no links, so ordinary tasks are unchanged.
- **Large evidence.** A report can be long (WS-089 section 1); the server's page of 10, the
  collapsed evidence and `overflow-x-auto` on `<pre>` keep the page usable and the phone
  width test guards against horizontal page scroll.
- **Item G runs at the same time** and edits `docs/README.md` and WT-06; this item touches
  only its own rows and lines there, and no shared code (the settings pages are G's).

## Deviations from the approved spec

1. **The card's High and Critical badge is outlined, with red text and a red border**, not
   the shadcn `destructive` variant. The axe check of test 11 found that variant's red text
   on its tinted background at a contrast of 4:1 in light mode (4.5:1 needed). Red text on
   the card's own background passes in both modes; Low and Medium stay plain outlined.
2. **The reports section reads again on its own**: `ReportsSection` takes a `marker` (the
   task's `occurrences` and `lastReportedAt`) and reads the shown reports again when it
   changes, and on a reconnect, rather than being told to by `TaskDetail`. Same behaviour,
   no new callback between the two.
3. **`ReportsSection` takes `initial: null`** and then reads the first page itself, for a
   task whose count rises above 0 while it is open. The pipeline never does that today (a
   repeat needs a fingerprint, which only a created bug has), so it is a guard, not a path
   the tests cover.
4. **`bugReport()` and `QA_BOT`** went into the board's `test-data.ts`, next to `task()` and
   `full()`, which the task detail's tests already import.

## Implementation record

- Red:
  - `bug-labels.test.ts` failed to import `./bug-labels`;
  - the 2 board cases (badge and count, live count) and the 18 detail cases of "TaskDetail:
    bugs (WS-091)" failed: no badge, no Severity select or row, no "Reported", no Links or
    Reports region, no request to `/bug-reports`.
- The end-to-end spec and `seedAgentToken` were written before the code, but the spec was
  first run after it (a run builds the whole app); its first run passed every case but the
  light-mode axe check, which led to deviation 1.
- Green: the 88 cases of `src/components/task` and `board.test.tsx` pass.
- Gate on 2026-11-20:
  - typecheck, lint and Prettier pass;
  - Vitest 1733 of 1733;
  - `pnpm test:e2e --retries=0` 92 of 92 on the third full run. The first two each failed
    one live test that waits 2 seconds for another page to update, a different one each
    time and in specs this item does not touch (`live-board.spec.ts` "a deleted task
    disappears…", `live-pages.spec.ts` "a column renamed…"); both passed alone (12 of 12
    and 17 of 17, `--repeat-each=3`). Another session ran tests on the same database
    server meanwhile; recorded here, not changed;
  - Windows 11, Node 24.18.0, pnpm 10.28.0, Compose PostgreSQL 18 on port 5433.
- Merged `main` after WI-092 (item G, Magalvo/Opanel#89) landed. The conflicts were the
  index rows, "Last finished" and "Next:" in `docs/README.md` and the WT-06 table, where
  both items' lines are kept, and `src/components/task/api.ts`, where `listAllTeams` now
  comes from `components/teams/api` as WI-092 moved it. Gate on the merge, 2026-11-20:
  typecheck, lint and Prettier pass; Vitest 1748 of 1748; `pnpm test:e2e --retries=0` 93
  of 93. Two earlier full runs on the merge timed out in many specs while another session's
  tests loaded the shared PostgreSQL (55% CPU); the 93 of 93 run waited until it was idle.
