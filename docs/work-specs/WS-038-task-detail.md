# WS-038 — Task detail: fields, Markdown description, assignment, epic, comments, delete

- Status: Done (approved by the owner on 2026-11-16, questions 1 to 6 as proposed)
- Work-item: [WI-038](../work-items/WI-038-task-detail.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 2 to 5;
  [0002](../canonical/0002-realtime-sync.md) section 4;
  [0004](../canonical/0004-api-conventions.md) sections 4, 6 and 7;
  [WT-03](../work-tracks/WT-03-board-core.md) decisions 8, 12, 14, 15, 17, 18 and question 3;
  [WS-030](WS-030-tasks-core.md), [WS-031](WS-031-move-task.md),
  [WS-032](WS-032-delete-and-restore-task.md), [WS-033](WS-033-epics.md),
  [WS-034](WS-034-comments.md) (the APIs); [WS-037](WS-037-board-page.md) (the board);
  [WS-041](WS-041-security-headers.md) (the policy the Markdown must respect)

## Approach

No API change. The screen is a client of the task, move, delete, comment, epic, team and
people endpoints, as the board is. Before any code, read for the installed versions
(hard rule 13): the Next.js guides on parallel routes, intercepting routes and `default.js`
(`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/`), and the
documentation of the installed `react-markdown`.

### 1. Routes: a page, and a dialog over the board (question 1)

```
src/app/(app)/projects/[projectKey]/
  layout.tsx                            renders {children} and the {modal} slot
  page.tsx                              the board (WS-037), unchanged
  default.tsx                           null, for `children` after a reload elsewhere
  tasks/[taskKey]/page.tsx              the full page: direct visit, reload, shared link
  @modal/default.tsx                    null: no dialog
  @modal/[...catchAll]/page.tsx         null: closes the dialog on any other navigation
  @modal/(.)tasks/[taskKey]/page.tsx    the same screen in a dialog over the board
```

This is the parallel plus intercepting routes pattern of the installed Next.js guides,
which WT-03 question 3 asks for. A click on a card is a client navigation, so it is
intercepted: the URL becomes `/projects/KEY/tasks/KEY-12` and the board stays mounted
under the dialog. Closing the dialog (its button, Escape, a click outside) calls
`router.back()`, so Back and Forward close and reopen it. A reload or a direct visit is not
intercepted and renders the full page.

Both pages are server components that call `requireAccount()`, check that the segment is a
task key (`taskKeySchema`) whose project key is the URL's (`notFound()` otherwise), and pass
to one client component, `TaskDetail`, the key and what the actor may do:
`canWriteTasks` (`tasks:write`), `canComment` (`comments:write`), `canDeleteAny`
(`tasks:delete_any`), `canDeleteOwn` (`tasks:delete_own`) and `accountId`. As on the board,
the data itself is read by the browser through the API, which stays the guard. A task the
API answers `404` for, or whose `projectId` is not the frame's project, shows "This task does
not exist." The project's "Board" tab stays current while a task is open.

### 2. The screen (`src/components/task/`)

`TaskDetail` loads the task, the project's columns and the task's comments, and shows, top
to bottom, with one status region (`role="status"`) for every outcome:

- **Header:** key, title, type badge and column; "Delete" where allowed; in the dialog, a
  close button.
- **Details**, for someone who may change the task (`canWriteTasks` and the project not
  archived), one form:
  - **Title** and **Type** (native `<select>`: Task, Bug, Story).
  - **Description**: a textarea with **Write** and **Preview** tabs; Preview uses the same
    renderer as the page.
  - **Team**: a select of every team (all pages of `GET /api/v1/teams`), with "No team".
  - **Person**: a search box over `GET /api/v1/people?q=`, listing active people, with "No
    one". The current person is shown even when deactivated, marked "(inactive)".
  - **Epic**: a select of the project's open epics, plus the task's own epic even when
    closed, with "No epic".
  - One **Save changes** button, enabled when something changed, sends one
    `PATCH /api/v1/tasks/{key}` with only the changed fields and the `version` (question 2).
  - For everyone else the same values are shown as text.
- **Answers to a save:**
  - `200`: the answer becomes the task shown; "Saved."
  - `409 version_conflict`: the form is refilled from `current`, and the message says
    "Someone else changed this task. Their version is shown; make your change again."
  - `409 account_inactive`: "This person is deactivated and cannot be assigned."
  - `400`: field errors next to their fields.
  - `409 project_archived`: the project is reloaded into the frame, and the screen turns
    read-only.
- **Column**: a select of the project's columns, for someone who may change the task. It
  moves the task at once to the end of the chosen column with
  `POST /api/v1/tasks/{key}/move` (no anchor) and the `version`: the way to move a task
  without dragging (decision 15). The same answers as a save apply.
- **Delete** (decision 12): shown with `canDeleteAny`, or with `canDeleteOwn` when the
  reporter is the actor. The API enforces the same rule. An alert dialog asks ("Delete
  OPA-12? A Manager can restore it from the project settings."); then `DELETE`, and the
  dialog closes, or the full page goes to `/projects/KEY`. A failure keeps the task and
  explains it.
- **Comments** (decision 19): oldest first, from `GET /api/v1/tasks/{key}/comments` with
  "Load more"; each shows author, time (local, formatted after load) and its body as
  Markdown. With `comments:write` and the project not archived, a form with Write and
  Preview tabs and "Add comment", which posts `{ body }` and appends the answer. Comments
  are not edited or deleted (WT-03 question 2).
- **Read-only** for a Viewer and on an archived project: no form, no column select, no
  comment form, no Delete; on an archived project a line says why.

Every write uses the `version` of the task as shown and takes the answer as the new state,
so a save followed by a move never sends a stale `version`. One write is in flight at a
time; the controls wait for its answer.

### 3. Markdown (decision 14, question 3)

`src/components/markdown.tsx`, built on `react-markdown` (exact version pinned here, the
latest release, 10.1.0):

- Raw HTML is not rendered (`skipHtml`), and no `rehype-raw` is installed.
- Images are not rendered: they are unwrapped to their alt text. The policy of WS-041
  would block other origins anyway, and a tracking pixel has no place in a task.
- Links keep their `href` only for `http`, `https` and `mailto` (`urlTransform`); any other
  scheme, such as `javascript:` or `data:`, loses it. Links open in a new tab with
  `rel="noopener noreferrer"`.
- No `remark-gfm` in this item (tables, task lists, strike-through); it can come with its
  own item.
- It renders React elements, never `dangerouslySetInnerHTML`, so it needs nothing from the
  Content Security Policy; the end-to-end tests run under the CSP guard of WS-041.
- Styled with a few Tailwind rules in the component (headings, lists, code, quotes,
  links), with no typography plugin.

### 4. The board (question 4 and 5)

- **A card's title is a link** to `/projects/KEY/tasks/KEY-12` (`next/link`), which
  replaces WS-037 question 2's "not clickable".
- **A drag handle for the keyboard.** Today the whole card is the draggable button, and a
  link cannot sit inside a button (nested interactive controls). So the card gets a small
  handle button with a grip icon, labelled "Move OPA-12 Write the board", that carries the
  keyboard drag and the drag instructions (`setActivatorNodeRef`). The pointer and touch
  still drag the card from anywhere on it, and a click without movement on the title
  follows the link (the 5 px activation distance of WS-037 already tells the two apart).
  The read-only card has the link and no handle.
- **The board follows changes made in the dialog**, until WT-04 brings live updates:
  `TaskDetail` dispatches a window event `opanel:task-changed` with the task the API
  returned after a save or a move, and `opanel:task-deleted` with its id after a delete.
  The board (`useBoard`) replaces the card in place, moves it to the end of its new column
  after a move, or removes it. The events carry only what the API already returned.

### 5. Out of scope

The activity timeline (WT-08); editing or deleting comments; labels, priority, due dates,
sprints, sub-tasks and links (later tracks); mentions and notifications; `remark-gfm`;
images in Markdown; keyboard shortcuts; live updates from other people (WT-04).

## Files

| Path                                                                                          | Change                                   |
| --------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `package.json`, `pnpm-lock.yaml`                                                              | add `react-markdown`, exact              |
| `src/components/markdown.tsx` (+ `markdown.test.tsx`)                                         | create (tests first)                     |
| `src/components/task/*.tsx`, `api.ts` (+ `*.test.tsx`)                                        | create (tests first)                     |
| `src/components/board/task-card.tsx`, `use-board.ts`, `board.tsx` (+ their tests)             | modify: link, handle, the two events     |
| `src/components/projects/project-frame.tsx` (+ test)                                          | modify: Board tab current under `tasks/` |
| `src/app/(app)/projects/[projectKey]/layout.tsx`, `default.tsx`                               | modify; create                           |
| `src/app/(app)/projects/[projectKey]/tasks/[taskKey]/page.tsx` (+ integration test)           | create (tests first)                     |
| `src/app/(app)/projects/[projectKey]/@modal/...` (`default`, `[...catchAll]`, `(.)tasks`)     | create (tests first)                     |
| `tests/e2e/task-detail.spec.ts`; `tests/e2e/board.spec.ts`; `tests/e2e/accessibility.spec.ts` | create; modify (handle); modify          |
| `docs/README.md`, WT-03, WI-038, WS-038                                                       | modify: statuses                         |

No migration, no new endpoint, no contract change.

## Data model changes

None.

## API contract

None. The screen uses `GET`, `PATCH` and `DELETE /api/v1/tasks/{taskId}`,
`POST /api/v1/tasks/{taskId}/move`, `GET` and `POST /api/v1/tasks/{taskId}/comments`,
`GET /api/v1/projects/{projectId}/columns`, `GET /api/v1/projects/{projectId}/epics`,
`GET /api/v1/teams` and `GET /api/v1/people`, as documented.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                             | Covers criterion |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | `Markdown`: headings, emphasis, lists, code, quotes and links render; `<script>`, `<img onerror>` and other raw HTML in the source render no element                                                             | Markdown         |
| 2   | unit        | `Markdown` links: `http`, `https`, `mailto` keep `href` and open in a new tab with `noopener noreferrer`; `javascript:`, `data:`, `vbscript:` have no `href`; images become their alt text                       | Markdown         |
| 3   | integration | the full page and the dialog page render for every role with the right booleans and `accountId`; an invalid key segment, or a key of another project, is not-found; no session redirects to `/sign-in`           | access           |
| 4   | unit        | `TaskDetail` shows key, title, type, column, team, person with "(inactive)", epic, reporter, times, and the description as Markdown; "This task does not exist." for `404` and for a task of another project     | content          |
| 5   | unit        | save: Save is disabled until something changes; only changed fields are sent with the `version`; the answer becomes the task, and the next save sends the new `version`                                          | edit             |
| 6   | unit        | save answers: `version_conflict` refills from `current` and explains; `account_inactive` and field errors are shown; `project_archived` turns the screen read-only                                               | edit             |
| 7   | unit        | person search lists only active people and sets or clears the person; the team select has every team and "No team"; the epic select has the open epics, the task's own closed epic and "No epic"                 | assignment       |
| 8   | unit        | Write and Preview of the description and of a new comment render what the page renders                                                                                                                           | Markdown         |
| 9   | unit        | the column select posts a move with no anchor and the `version`, and shows the new column                                                                                                                        | move             |
| 10  | unit        | Delete is offered with `canDeleteAny`, and with `canDeleteOwn` only to the reporter; it asks first, deletes, then closes or leaves; a failure keeps the task and explains                                        | delete           |
| 11  | unit        | comments: oldest first with Markdown, "Load more"; adding posts `{ body }` and appends the answer; no form without `comments:write`                                                                              | comments         |
| 12  | unit        | read-only: a Viewer and an archived project show no form, column select, comment form or Delete; the archived line is shown                                                                                      | read-only        |
| 13  | unit        | `opanel:task-changed` after a save and a move, and `opanel:task-deleted` after a delete, carry the task or its id                                                                                                | board follows    |
| 14  | unit        | board: a changed task replaces its card in place, a moved one goes to the end of its new column, a deleted one leaves; the card title links to the task; the handle has the drag attributes and the instructions | board follows    |
| 15  | unit        | accessibility: every field and control has a name; one status region announces outcomes; the dialogs close with Escape and return focus                                                                          | accessibility    |
| 16  | e2e         | from the board, a click on a card's title opens the dialog at the task's URL with the board behind; Back closes it and the board is unchanged; Forward reopens it                                                | dialog, URL      |
| 17  | e2e         | a reload and a direct visit of the task's URL show the full page; an unknown key and a deleted task show "This task does not exist."                                                                             | page             |
| 18  | e2e         | a Member edits title, type, description, team, person and epic, saves, reloads and sees them; moves the task with the column select, and the board behind shows the card in its new column                       | edit, move       |
| 19  | e2e         | a Member comments with Markdown and sees it rendered; a `<script>`, an `<img onerror>` and a `javascript:` link written in a description and a comment neither run nor link; the CSP guard sees no violation     | Markdown         |
| 20  | e2e         | the reporter deletes their task from the dialog and it leaves the board; another Member sees no Delete; a Manager does                                                                                           | delete           |
| 21  | e2e         | a Viewer and an archived project show no controls; a second context changes the task first, and the first one's save shows the conflict with the current values                                                  | read-only        |
| 22  | e2e         | the board's drag tests pass with the handle: mouse on the card, keyboard on the handle                                                                                                                           | dragging         |
| 23  | e2e         | axe finds no violations on the full page and on the dialog in light and dark mode; at phone width there is no horizontal page scroll                                                                             | accessibility    |
| 24  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm db:generate` and `pnpm openapi:generate` leave no diff                                                                                            | gate             |

## Risks and open questions

For the owner:

1. **A dialog over the board by intercepting routes**, as WT-03 question 3 asks. It is the
   framework's own pattern and gives a shareable URL, Back, Forward and reload, but it is
   the most delicate routing in the project so far: a slot in the project layout,
   `default.tsx` in two places and a catch-all to close the dialog. The alternative, a
   dialog managed by the board with `history.pushState`, is simpler and less standard.
   **Recommend: the framework pattern.**
2. **One Save button for the fields; the column, comments and Delete act at once.** The
   alternative, saving each field when it loses focus, sends more requests, raises more
   version conflicts and shows half-saved states. **Recommend: as proposed.**
3. **`react-markdown` 10.1.0**, exact, with its dependencies from the unified ecosystem
   (several dozen small packages by the same maintainers). Its last release is from March
   2025; it is stable and widely used. No `remark-gfm`, no images, no raw HTML. A
   hand-written renderer is not safe to recommend. **Recommend: as proposed.**
4. **A drag handle for the keyboard** (section 4), because a link cannot be inside the
   draggable button. Pointer and touch dragging do not change; keyboard users tab to the
   handle instead of the card. The alternative, opening the task with Enter on the card
   and dragging only with Space, keeps one control but hides the link from assistive
   technology. **Recommend: the handle.**
5. **The board follows the dialog through two window events**, a small bridge until WT-04
   replaces it with live updates. The alternative, a shared client store, is more than
   this item needs. **Recommend: the events.**
6. **Older branches.** The remote has `claude/wi-038-task-detail` and
   `claude/wi-038-task-detail-spec` from a parallel line of work of 2026-11-15, built on a
   `main` that predates WI-035 to WI-041 as merged. Its WS-038 was marked approved on that
   branch only and never reached `main`. This spec reuses its good decisions, rewritten for
   the code on `main` (hard rule 11: raised, not silently picked). **Recommend: this spec
   replaces it, and those branches can be deleted** together with the older
   `claude/wi-041-security-headers`.

Technical, settled by the tests:

7. **Stale versions between the dialog and the board.** The dialog and the board each hold
   the task's `version`; the events of section 4 give the board the version the dialog got,
   so a drag after an edit does not conflict.
8. **The catch-all of the slot** keeps the dialog from staying open when someone navigates
   from it to another page of the project (the guides' advice for modals).

## Deviations from the approved spec

- **`@modal/page.tsx` as well**, returning nothing. Besides the slot's `default.tsx` and
  catch-all, the guide needs it so that a client navigation back to the board itself (the
  Board tab, for example) closes an open dialog.
- **The pages share `task-access.ts`** in the project's route folder: the session, the task
  key check and the rights, for the full page and the dialog alike.
- **The form keeps edits not saved yet** when a save or a move returns a new version, and
  takes the new values for every other field; only a version conflict starts it again from
  the current task. The spec said "the answer becomes the state"; read literally, a move
  would have thrown away a title being typed. The form also stays mounted, so the keyboard
  focus is not lost after a save. Covered by a unit test written first.
- **Headings inside Markdown are rendered one or two levels lower** (`#` as `h3`), so text
  written in a description never outranks the page's own headings.
- **The team select reads team summaries** (`GET /api/v1/teams` returns `TeamSummary`, not
  `Team`); the spec did not name the type.
- **`AlertDialogTrigger` was added to `src/components/ui/alert-dialog.tsx`**, the standard
  shadcn piece, so Radix returns the focus to "Delete task" when the confirmation closes.
- **The dialog's accessible title is "Task OPA-12", visually hidden**; the visible heading
  is the task's title, the same on the full page.
- **The end-to-end tests were not run red**: `next build` type-checks the new tests, which
  import modules that did not exist yet (as in WS-041). The unit and integration tests were.

## Implementation record

- Red: the unit and integration tests failed on the missing modules, the missing handle,
  link and events, and the layout's missing `modal` slot (committed before any code).
- Fixed after Red, in tests of mine: the team list's items are summaries with
  `memberCount` (my code assumed the same wrong type and was fixed with it), and one
  `as const` for a typed loop.
- Read for the installed versions (hard rule 13): the Next.js guides on parallel routes,
  intercepting routes and `default.js`; the `react-markdown` 10.1.0 readme and types
  (`skipHtml`, `urlTransform`, `components`); and `@dnd-kit/core`'s keyboard sensor, which
  starts a drag only from the activator node, which is what lets the handle carry the
  keyboard drag while the card keeps the pointer drag.
- Green: 921 Vitest tests (up from 866) and 56 Playwright tests (up from 49) pass, all
  under the CSP guard of WS-041, with no policy violation; the task and board specs passed
  three repeated runs. Typecheck, lint and format pass; `pnpm db:generate` and
  `pnpm openapi:generate` leave no diff.
- Locally the database was PostgreSQL 16 (no Docker in the sandbox); CI runs the
  PostgreSQL 18 of `compose.yaml`.
