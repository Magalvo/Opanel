# WS-038 — Task detail

- Status: Done (approved by the owner on 2026-11-15, with the proposals of questions 1 to 7)
- Work-item: [WI-038](../work-items/WI-038-task-detail.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 2, 3, 4, 5;
  [0004](../canonical/0004-api-conventions.md) sections 4, 6, 7;
  [WS-030](WS-030-tasks-core.md), [WS-031](WS-031-move-task.md),
  [WS-032](WS-032-delete-and-restore-task.md), [WS-033](WS-033-epics.md),
  [WS-034](WS-034-comments.md), [WS-037](WS-037-board-page.md),
  [WS-041](WS-041-security-headers.md);
  [WT-03](../work-tracks/WT-03-board-core.md) decisions 8, 12, 14, 15 and question 3;
  `AGENTS.md` hard rules 4, 6 and 13

## Approach

No API change: the task detail is a client of the task, move, delete, comment, epic, team and
people endpoints. Before any code, read for the installed Next.js 16.4.6 the guides on parallel
routes and intercepting routes (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/`),
and the `react-markdown` package's own documentation (hard rule 13).

### 1. Routes: a page, and a dialog over the board

```
src/app/(app)/projects/[projectKey]/
  layout.tsx                          renders {children} and {modal}
  page.tsx                            the project page (WS-037), as it is
  default.tsx                         `null`, for the slot when nothing is open
  tasks/[taskKey]/page.tsx            the full page, for a direct visit or a reload
  @modal/default.tsx                  `null`
  @modal/(.)tasks/[taskKey]/page.tsx  the same content in a dialog, over the board
```

This is the parallel plus intercepting routes pattern of the Next.js guide, which WT-03
question 3 asked for ("its own URL and opens as a dialog over the board when reached from
it"). The board stays mounted under the dialog; closing it calls `router.back()`.
`/projects/KEY/tasks/KEY-12` is a full page for a direct visit, a reload and a shared link.

Both routes load the task through the service (`getTask`) in a server component and hand it,
with the actor's permissions (`canWrite`, `canDelete`, `canComment`), to one client component,
`TaskDetail`. The key must belong to the project of the URL, otherwise `notFound()`; an unknown
or deleted task is `notFound()` too. The typed-routes types are regenerated with `next typegen`.

### 2. The screen (`src/components/task/`)

`TaskDetail` shows, top to bottom, with `role="status"` for outcomes:

- **Header:** the key, the title, the type badge and the column's name; a "Delete" button where
  allowed; in the dialog a close button.
- **Fields.** For someone who can write, a form with: Title, Type (select), Description (a
  textarea with **Write** and **Preview** tabs; Preview uses the same renderer as the page),
  Team (select of every team, "No team"), Person (a search box over `GET /api/v1/people?q=`
  that lists active people, with "No one"; the current assignee shows even if deactivated,
  with a "Deactivated" badge), Epic (select of the project's open epics plus the task's own
  even if closed, "No epic"). One **Save changes** button, enabled when something changed,
  sends a single `PATCH /api/v1/tasks/{key}` with only the changed fields and the `version`.
  For everyone else the same values are shown as text.
- **Conflicts.** `409 version_conflict` replaces the form with the `current` task and says
  "Someone else changed this task. Your edit was not saved; the current values are shown."
  `409 account_inactive` is "This person is deactivated and cannot be assigned." Field errors
  of a `400` go next to the field. `409 project_archived` makes the task read-only.
- **Column.** A select of the project's columns that moves the task at once, to the end of the
  chosen column, with `POST /api/v1/tasks/{key}/move` (no anchor) and the task's `version`.
  It is the way to move a task without dragging (decision 15).
- **Delete.** Shown to a Manager or Admin, and to a Member for a task they reported (the
  `canDeleteTask` rule, which the API enforces anyway). An alert dialog asks; `DELETE
/api/v1/tasks/{key}`; then the dialog closes, or the page goes to `/projects/KEY`.
- **Comments.** The task's comments oldest first (`GET /api/v1/tasks/{key}/comments`, "Load
  more"), each with author, time and the body as Markdown. For someone with `comments:write` a
  form with Write and Preview tabs and "Add comment"; the new comment is appended from the
  response. No editing or deleting (WT-03 question 2).
- **Read only.** A Viewer, an archived project and a task the person may not change show no
  form, no Column select, no comment form and no Delete.

Every write uses the version the screen holds and takes the answer as the new state, so
consecutive actions (save, then move) never send a stale `version`. One write is in flight at a
time; the controls wait for its answer.

### 3. Markdown (decision 14)

`react-markdown` 10.1.0, exact, in `src/components/markdown.tsx`:

- Raw HTML is not rendered (`skipHtml`), and no `rehype-raw` is installed.
- Images are not rendered (`disallowedElements: ["img"]`, with `unwrapDisallowed`): the policy
  would block other origins anyway and a tracking pixel has no place in a task.
- Links keep only `http`, `https` and `mailto` (`urlTransform`); any other scheme, such as
  `javascript:` or `data:`, loses its `href`. Links open in a new tab with
  `rel="noopener noreferrer"`.
- No `remark-gfm` now (tables, task lists and strike-through are not asked for); it can be added
  later with its own item.
- The component renders React elements, never `dangerouslySetInnerHTML`, so the Content Security
  Policy of WS-041 is not touched; a test in the browser proves it.

### 4. Cards and the board

- A card's title becomes a link to `/projects/KEY/tasks/KEY-12` (a `next/link`); the drag handle
  and the menu are unchanged.
- **The board behind the dialog is kept current** without a reload by two browser events,
  until WT-04 brings live updates: `TaskDetail` dispatches `opanel:task-updated` (with the
  task) after a save, a move or a comment count change, and `opanel:task-deleted` (with its
  id). The board listens and replaces or removes the card. The events carry no more than the
  API already returned.

### 5. Out of scope

History and the timeline (WT-08); editing or deleting comments; labels, priority, due date,
sprints, sub-tasks and links (later tracks); mentions and notifications; `remark-gfm`; images
in Markdown; keyboard shortcuts.

## Files

| Path                                                                     | Change                          |
| ------------------------------------------------------------------------ | ------------------------------- |
| `package.json`, `pnpm-lock.yaml`                                         | modify: `react-markdown`, exact |
| `src/components/markdown.tsx` (+ `.test.tsx`)                            | create (tests first)            |
| `src/components/task/*.tsx`, `api.ts` and `*.test.tsx`                   | create (tests first)            |
| `src/components/board/task-card.tsx`, `board.tsx` (+ tests)              | modify: link, the two events    |
| `src/app/(app)/projects/[projectKey]/layout.tsx`, `default.tsx`          | create                          |
| `src/app/(app)/projects/[projectKey]/tasks/[taskKey]/page.tsx`           | create                          |
| `src/app/(app)/projects/[projectKey]/@modal/default.tsx`                 | create                          |
| `src/app/(app)/projects/[projectKey]/@modal/(.)tasks/[taskKey]/page.tsx` | create                          |
| page integration tests                                                   | create                          |
| `tests/e2e/task-detail.spec.ts`                                          | create                          |
| `docs/README.md`, WT-03, WI-038, WS-038                                  | modify: statuses                |

## Data model changes

None.

## API contract

None. The screen uses `GET /api/v1/tasks/{taskId}`, `PATCH` and `DELETE` on it,
`POST .../move`, `GET` and `POST .../comments`, `GET /api/v1/projects/{id}/epics`,
`GET /api/v1/teams` and `GET /api/v1/people`.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                             | Criterion           |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 1   | unit        | `Markdown`: renders headings, emphasis, lists, code and links; a `<script>` and `<img onerror>` in the source appear as text or not at all and no `script` element exists                                        | Markdown            |
| 2   | unit        | links: `http`, `https` and `mailto` keep their `href` and open in a new tab with `noopener noreferrer`; `javascript:`, `data:` and `vbscript:` links have no `href`; images are not rendered                     | Markdown            |
| 3   | integration | the full page and the dialog's page: render for every role with `canWrite`, `canDelete`, `canComment` right; the key of another project, an unknown key and a deleted task are `notFound`; no session redirects  | access              |
| 4   | unit        | `TaskDetail` shows key, title, type, column, team, person (with Deactivated), epic, reporter, dates and the description as Markdown                                                                              | content             |
| 5   | unit        | edit: only changed fields are sent with the `version`; Save is disabled until something changes; the answer becomes the state and the next save sends the new `version`                                          | edit                |
| 6   | unit        | `409 version_conflict` shows the `current` values and the message; `account_inactive`, field errors and `project_archived` show their messages                                                                   | conflicts           |
| 7   | unit        | the person picker searches as one types, lists only active people, sets and clears the person; the epic select has the open epics, the task's own closed epic and "No epic"; the team select has every team page | assignment          |
| 8   | unit        | the Write and Preview tabs of the description and of a new comment show the same rendering as the page                                                                                                           | preview             |
| 9   | unit        | the column select posts a move to the end of that column with the `version` and updates the column shown                                                                                                         | move                |
| 10  | unit        | delete is offered to a Manager, an Admin and the reporter, not to another Member or a Viewer; it asks first, deletes, then leaves; a failure keeps the task                                                      | delete              |
| 11  | unit        | comments: listed oldest first with Markdown, "Load more", add posts `{ body }` and appends the answer; a Viewer has no form                                                                                      | comments            |
| 12  | unit        | read only: a Viewer, an archived project and a task the person cannot change show no form, no select, no comment form and no Delete                                                                              | read only           |
| 13  | unit        | `opanel:task-updated` and `opanel:task-deleted` are dispatched with the right payload after a save, a move and a delete                                                                                          | board sync          |
| 14  | unit        | the board replaces a card on `opanel:task-updated` and removes it on `opanel:task-deleted`; the card title is a link to the task                                                                                 | board sync, link    |
| 15  | unit        | accessibility: named fields and controls, one announced status region, dialogs close with Escape and return focus                                                                                                | accessibility       |
| 16  | e2e         | from the board a click on a card opens the dialog at `/projects/KEY/tasks/KEY-1` over the board; Back closes it and the board is still there                                                                     | dialog and URL      |
| 17  | e2e         | a reload and a direct visit of that URL show the full page; the same content, no board behind                                                                                                                    | page                |
| 18  | e2e         | a Member edits title, type, description, team, person and epic, saves, reloads and sees them; moves the task with the column select and the board behind shows it                                                | edit, board sync    |
| 19  | e2e         | a Member comments, with Markdown, and sees it rendered; a `<script>` and a `javascript:` link written in a description and a comment do not run and are not linked, and no CSP violation is reported             | Markdown, CSP       |
| 20  | e2e         | the reporter deletes their task from the dialog and it leaves the board; another Member does not see Delete; a Manager does                                                                                      | delete              |
| 21  | e2e         | a Viewer and an archived project see the task with no controls; a second context changes the task first and the first one's save shows the conflict message                                                      | read only, conflict |
| 22  | e2e         | phone width has no sideways scroll, dark theme renders, no axe violations on the page and on the dialog                                                                                                          | responsive          |
| 23  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm openapi:generate` leaves no diff                                                                                                                  | gate                |

## Risks and open questions

For the owner:

1. **A dialog over the board by intercepting routes**, as decision question 3 asked. It is the
   framework's own pattern and gives the shareable URL, Back and reload behaviour, but it is the
   most delicate routing in the project so far (a layout with a slot, a `default.tsx` in two
   places, regenerated route types). The alternative is a dialog managed by the board with
   `history.pushState`, simpler and less standard. I recommend the framework pattern. Agree?
2. **One Save button for the fields, immediate actions for the rest.** Moving to a column,
   commenting and deleting act at once; title, type, description, team, person and epic are
   saved together. The alternative is to save each field when it loses focus, which sends more
   requests and shows half-saved states. Agree?
3. **`react-markdown` 10.1.0**, exact, and its dependencies from the unified ecosystem (about
   forty small packages, all by the same maintainers). Without `remark-gfm`, images and raw
   HTML. The alternative of a hand-written renderer is not safe to recommend. Agree?
4. **Pickers load whole lists.** The team and epic selects load every page of teams and open
   epics (small lists); only the person picker searches. If a project ever has hundreds of
   epics this needs a search, which can come then. Agree?
5. **The board is kept current by two window events**, a deliberately small bridge until WT-04
   replaces it with live updates. The alternative is a shared client store, which WT-04 will
   need anyway but which is more than this item needs. Agree?
6. **Cards become links now**, closing question 2 of WS-037. Dragging by the handle is unchanged.
   Agree?
7. **Dependencies on other branches.** This item needs WI-034 (comments API) and WI-041 (the
   policy) merged first, as they sit on branches of their own. The implementation branch is cut
   from a branch that has both.

## Deviations from the approved spec

1. **The pages cannot pass `onLeave`.** A server component cannot hand a function to a client
   one, so each route renders a small client wrapper that supplies it: `TaskPageView` (goes to
   the board with the router) and `TaskDialog` (closes the dialog with `router.back()`). Both
   take the same props the tests state. The shared loading and the permission rules are in
   `src/app/(app)/projects/load-task.ts`.
2. **Two more files in the `@modal` slot**, from the Next.js guide: `[...catchAll]/page.tsx`
   (so a soft navigation to the project's settings does not leave the dialog open) and
   `default.tsx`. `[projectKey]/default.tsx` exists as the spec said.
3. **A Markdown link with an unsafe or relative address is an `<a>` with no `href`**, so it is
   not a link for assistive technology either. The unit test reads the `href`; the end-to-end
   test finds it by its text, since an anchor without `href` has no `link` role.
4. **The message region is named "Task messages"**, like the board's, so tests find it among
   other live regions.
5. **The tabs' names** ("Write description", "Preview comment") are screen-reader text; the
   visible words are "Write" and "Preview".
6. **Moving from the column select keeps unsaved edits** in the other fields: it replaces only
   the task's column and version, and a save afterwards sends the new version.
7. **A test helper corrected**: `fullTask` accepts a `description` override.

## Implementation record

- Red: committed first on this branch; the screen, Markdown, pages and board changes failed on
  the missing modules and links.
- Green: 882 Vitest tests and 68 Playwright tests (ten new in `task-detail.spec.ts`) pass, twice
  in a row. Typecheck, lint and format pass; `pnpm openapi:generate` leaves no diff. The
  end-to-end suite runs under the Content Security Policy of WI-041 with its violation check,
  so `react-markdown` and the dialog produce none.
- The intercepting route works as the guide describes: a card opens the dialog at its own URL
  over the live board, Back closes it, a reload shows the page.
- The board of 1 003 tasks still shows its last card in under a second (934 and 829 ms).
- `react-markdown` 10.1.0 was added with `pnpm add -E`; its README and API were read first.
- Locally the database was PostgreSQL 16 (no Docker in the sandbox); CI runs the
  PostgreSQL 18 of `compose.yaml`.
