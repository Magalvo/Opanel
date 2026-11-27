# WS-136 — Links in the UI

- Status: Proposed
- Work-item: [WI-136](../work-items/WI-136-links-ui.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) section 7 (links and their
  readings); [0002](../canonical/0002-realtime-sync.md) section 3 (`task.updated`);
  [WT-09](../work-tracks/WT-09-subtasks-and-links.md) decisions 6 to 8, 10 and 12;
  [WS-134](WS-134-links-api.md) (the API: `POST` and `DELETE /tasks/{taskId}/links`)

## Approach

### 1. Starting point, checked against `main` (`cdb2c8d`)

- **The API (WI-134):**
  - `POST /api/v1/tasks/{taskId}/links` with `{ type, direction, taskId }` answers `200`
    with the full task, its version one higher.
  - `DELETE` with the same fields as query parameters answers `204`. It also raises the
    version by one (`version = version + 1` in `task-links.ts`).
  - Both send `task.updated`, with the new version, for both tasks. Neither takes a
    `version`.
  - Refusals: `400` (`taskId` names no task, a deleted one or the task itself), `403`,
    `404`, `409 link_exists`, `409 too_many_links` and `409 project_archived`.
- **The task's links:** `task.links` lists `{ type, direction, task: { id, key, title } }`.
  `relates_to` is always `outgoing`.
- **`BugSection`** (`src/components/task/bug-section.tsx`) shows only `regression_of` links,
  under "Regression of" and "Regressed by", in a region named "Links". Other link types
  show nowhere.
- **The timeline:** `activity-text.tsx` already says "linked this task: blocks API-3" and
  "removed the link: …", with doc 0003's readings (`LINK_READINGS`).
- **`TaskDetail`:**
  - It reads a `task.updated` for its own task only when the version is newer, and then
    shows "changed elsewhere" (`changedElsewhere`).
  - A write of its own goes through `saved()`, which sets the held version, so the echo of
    that write is ignored.
- **`searchParents`** (`task/api.ts`, WI-135) reads `GET /tasks` within one project. The
  list endpoint also searches across every project the caller may reach when `projectId`
  is left out (WI-118).

### 2. The "Links" section

`LinksSection` (`src/components/task/links-section.tsx`) is a `region` named "Links",
placed after "Sub-tasks" and before the bug section, on every task:

- **Groups.** The groups are the readings, in a fixed order: "Blocks", "Is blocked by",
  "Duplicates", "Is duplicated by", "Regression of", "Has regression" and "Relates to"
  (question 1).
  - Each group is a `dt` and its links are a list in the `dd`. Within a group, links keep
    the API's order.
  - Each link shows the other task's key and title as one link to that task.
  - Groups with no links are left out.
- **Empty.** With no links, the section says "No links yet.". It is left out for someone
  who cannot edit tasks when there are none, as "Sub-tasks" is.
- **"Add link"** (for people who edit, while the project is not archived) opens the dialog
  of section 3.
- **"Remove"** sits beside each link for people who edit. Its accessible name says what it
  removes, for example "Remove link: blocks API-3". It removes the link at once, with no
  confirmation (question 2). The removal is recorded in both histories, and the link can
  be added back. Afterwards the focus moves to "Add link".

The readings move into one shared `LINK_READINGS` in `src/components/task/link-readings.ts`,
which the timeline imports too. The headings are those words with a capital letter, apart
from `regression_of`, which keeps "Regression of", doc 0003's name for the type.

### 3. "Add link"

The dialog is titled "Link KEY to another task" and has two controls:

- **"Link type"**: a select of the seven readings, "Blocks" first. Each reading maps to
  `{ type, direction }`, and "Relates to" maps to `relates_to` with `outgoing`.
- **"Find a task"**: a search box. 300 ms after typing stops it reads a new
  `searchTasks(q)` in `task/api.ts`: `GET /tasks?limit=20&sort=-updated&q=…`, with no
  `projectId`, so it covers every project the person may reach.
  - The results are buttons, each named "KEY Title". The task itself is left out.
  - With no results it says "No task found.".
  - `searchParents` and `searchTasks` share one helper.

Choosing a result sends `POST` with the chosen reading and the task's id:

- **On success,** the dialog closes and the answer goes through a new `linked()` with
  "Link added.", so the held version moves and the echo is ignored. Unsaved form edits
  stay, since the form keeps them when the task changes, as it does for "Parent" (WI-135).
  `linked()` is `saved()` without clearing `saveVersion`: if someone else changed the task
  while the person was editing, their next save still gets the conflict, because a link
  touches none of the form's fields.
- **Refusals shown inside the dialog,** which stays open (`role="alert"`):
  - `link_exists`: "That link exists already.";
  - `too_many_links`: "One of the tasks already has 100 links.";
  - `403`: "You cannot link to that task.";
  - a `400` on `taskId`: the API's message.
- **Any other failure** goes through `failed()`, which also covers `project_archived`, and
  the dialog closes.

### 4. Removing

"Remove" sends `DELETE` with the link's `type`, `direction` and the other task's id. The
`204` carries no task, so the page reads the task again:

- **The version read is the held version plus one:** only this removal happened, so the
  task goes through `linked()` with "Link removed.".
- **The version read is higher still:** someone else wrote too, so it goes through
  `changedElsewhere()`, as an event would (WT-04 decision 10).
- **A `404`** (someone removed the link already) reads the task again the same way and
  says "That link was already removed.".
- **Any other failure** goes through `failed()`.

The page's busy flag (`setWriting`) is held from the `DELETE` until the read ends, so an
event that arrives in between is read after it (as today).

### 5. Following changes

There is nothing new to follow. A link added or removed elsewhere sends `task.updated` with
a newer version for both tasks, and `TaskDetail` already reads that and shows the task's
new `links`. Test 8 checks it on the other task's page.

### 6. The bug section

`BugSection` drops its `LinksSection` and shows only how often the bug was reported and its
reports. It now renders only for a task that was reported. The existing tests that read
"Regressed by" read "Has regression" in "Links" (question 1): one in
`task-detail.test.tsx` and one in `tests/e2e/bugs.spec.ts`. `triage-flow.spec.ts` reads
"Regression of", which does not change.

## Files

| Path                                            | Change                                              |
| ----------------------------------------------- | --------------------------------------------------- |
| `src/components/task/links-section.tsx`         | create: sections 2 to 4                             |
| `src/components/task/link-readings.ts`          | create: the readings, shared with the timeline      |
| `src/components/task/api.ts`                    | modify: `searchTasks`, `addLink`, `removeLink`      |
| `src/components/task/bug-section.tsx`           | modify: section 6                                   |
| `src/components/task/activity-text.tsx`         | modify: imports the shared readings                 |
| `src/components/task/task-detail.tsx`, its test | modify: the section, the messages, section 4's read |
| `tests/e2e/links.spec.ts`                       | create: tests 8 and 9                               |
| `tests/e2e/bugs.spec.ts`                        | modify: "Has regression"                            |
| `tests/e2e/accessibility.spec.ts`               | modify: test 10                                     |

## Data model changes

None.

## API contract

None. The UI uses the API of WI-134.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                                                                             | Covers criterion |
| --- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit  | the section groups links of all four types under the seven readings in order, links each task, and says "No links yet."; a Viewer with none sees no section                      | 1                |
| 2   | unit  | "Add link" searches with `q` and no `projectId`, leaves the task out, and sends the chosen reading's `type` and `direction` with the id; "Link added."                           | 2                |
| 3   | unit  | the dialog shows `link_exists`, `too_many_links`, a `403` and a `400` on `taskId` and stays open; `project_archived` shows the page message                                      | 4                |
| 4   | unit  | "Remove" is named for its link, sends the `DELETE` query, reads the task, says "Link removed." and moves the focus to "Add link"                                                 | 3                |
| 5   | unit  | after a removal, a read one version higher is taken as saved, and a read two higher shows "changed elsewhere"; a `404` says it was already removed                               | 3, 5             |
| 6   | unit  | with unsaved edits, adding a link keeps them and the save sends the new version; after a change elsewhere, the save still sends the old one                                      | 5                |
| 7   | unit  | the bug section shows reports and no links; "Has regression" reads in "Links"                                                                                                    | 7                |
| 8   | e2e   | a Member links two tasks of two projects ("Blocks"); the other task's open page shows "Is blocked by" with no reload; removing it from there clears both; both timelines read it | 2, 3, 6          |
| 9   | e2e   | a Viewer reads a task's links and sees no "Add link" or "Remove"                                                                                                                 | 1                |
| 10  | e2e   | the accessibility checks of a page with links of several types and of the "Add link" dialog, in light and dark mode                                                              | 8                |

`tests/e2e/bugs.spec.ts`'s change covers criterion 7 end to end. The full quality gate
covers criterion 9.

## Risks and open questions

Questions for the owner, each with a recommendation:

1. **The name of an incoming regression.** The page says "Regressed by" today (WS-091), and
   doc 0003 and the timeline say "has regression". **Recommend: "Has regression"**, so the
   page, the timeline and doc 0003 use one set of words. The alternative is to keep
   "Regressed by" on the page only.
2. **Confirming a removal.** **Recommend: no confirmation.** A removal is one click to
   undo, and both histories record it. The alternative is a confirmation dialog, as
   deleting a task has.
3. **Which tasks "Add link" offers.** **Recommend: every project the person may reach,
   with the 20 most recently updated matches**, since links cross projects (WT-09 decision
   8). A task in a project where the person cannot write is still offered, and the API's
   `403` is shown. The alternative is this project only, with a project picker.

Risk: item E (the MCP link tools) touches no file here. Item F's end-to-end flow builds on
test 8.
