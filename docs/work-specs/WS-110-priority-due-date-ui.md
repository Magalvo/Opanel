# WS-110 — Priority and due date in the UI

- Status: Proposed
- Work-item: [WI-110](../work-items/WI-110-priority-due-date-ui.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 3 and 4;
  [0004](../canonical/0004-api-conventions.md) section 3 (calendar dates);
  [WT-07](../work-tracks/WT-07-backlog-priority-due-dates-labels.md) decisions 6, 7 and
  14; [WS-102](WS-102-priority-due-date.md) (the API), [WS-108](WS-108-labels-ui.md) and
  [WS-109](WS-109-backlog-page.md) (the card and the task detail this item extends)

## Approach

The web app shows and edits WI-102's `priority` and `dueDate`; no server change. Cards
and task answers already carry both fields (`TaskSummary`, `Task`), so no new request and
nothing new to follow live: a `task.updated` or `task.moved` already replaces the card.

Checked against `main` (`26f95ea`).

### 1. Today, and overdue

WT-07 decision 7: a task is **overdue** when its due date is before today **in the
viewer's browser** and it is not in a `done` column. The server computes nothing.

A new `src/components/task/due-date.ts`, pure and tested in Node:

- `localDate(now: Date): string` — `YYYY-MM-DD` from `now`'s local year, month and day
  (`getFullYear`, `getMonth`, `getDate`), never from `toISOString`, which is UTC and
  would be a day off on either side of midnight away from UTC.
- `isOverdue(dueDate: string | null, done: boolean, today: string | null): boolean` —
  `dueDate !== null && !done && today !== null && dueDate < today`. Calendar dates are
  `YYYY-MM-DD` with a four-digit year (`calendarDateSchema`), so string order is date
  order. Due today is not overdue.
- `formatDueDate(dueDate: string): string` — `Dec 1, 2026`, through
  `Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" })` on
  `Date.UTC(year, month - 1, day)`. A calendar date has no time zone; formatting its UTC
  midnight in UTC shows the same day everywhere (question 1).

A new `src/hooks/use-today.ts`: `useToday(): string | null`, through
`useSyncExternalStore` on one module-level store, so a board of many cards shares **one**
timer:

- The snapshot is `localDate(new Date())`.
- While anyone subscribes, one `setTimeout` fires at the next local midnight (plus one
  second) and notifies; a `visibilitychange` to visible also re-reads the date, because
  a sleeping laptop's timer can fire late (question 4).
- `getServerSnapshot` returns `null`: a server render marks nothing overdue, so the
  server's time zone never leaks into the page and hydration cannot differ. Cards and the
  task detail load their data in the browser today, so in practice they render on the
  client with a date.

### 2. Priority's look

A new `src/components/task/task-meta.tsx`:

- `PRIORITY_LABELS: Record<Priority, string>`: None, Low, Medium, High, Urgent.
- `PriorityIcon({ priority })`: `null` for `none`; otherwise a `span` with `role="img"`,
  `aria-label` and `title` both "Priority: High", holding the `lucide-react` icon with
  `aria-hidden`. One shape per level, so colour is never the only signal:

  | Priority | Icon               | Colour                                |
  | -------- | ------------------ | ------------------------------------- |
  | low      | `SignalLowIcon`    | `text-muted-foreground`               |
  | medium   | `SignalMediumIcon` | `text-muted-foreground`               |
  | high     | `SignalHighIcon`   | `text-foreground`                     |
  | urgent   | `CircleAlertIcon`  | `text-destructive` (as severity does) |

- `DueDateText({ dueDate, overdue })`: `null` without a date; otherwise a `span` with
  `CalendarIcon` (`aria-hidden`) and the text "Due Dec 1, 2026", or, when overdue,
  `CalendarClockIcon` and "Overdue, due Dec 1, 2026" in `text-destructive`. The word is in
  the text, so a screen reader and a colour-blind viewer get it too (WCAG 1.4.1).

### 3. The card and the backlog row

- `CardBody` (`board/task-card.tsx`) gains `done?: boolean` (default `false`) and calls
  `useToday()`. In its row of metadata it shows `PriorityIcon` first, before the type
  badge, and `DueDateText` after the team, before the labels.
- `StaticCard`, `SortableCard` and `OverlayCard` pass `done` through. `board-column.tsx`
  gives each card `done={column.category === "done"}`; the board's drag overlay takes the
  category of the active task's column. A card dragged into a `done` column, or moved
  there live, re-renders in that column and loses the mark with no extra code.
- The Backlog page's rows use `CardBody` with the default `done={false}`: a backlog task
  has no column, so it is never in a `done` one (decision 7). No change in
  `components/backlog/` beyond its test.

### 4. The task detail

`task/details-section.tsx`:

- **Read view.** Two rows after "Epic": "Priority" (the icon and its word, or "None") and
  "Due date" (`DueDateText` with the overdue mark, or "None"). `done` is the category of
  the task's column in `columns`; a backlog task is never done.
- **Draft.** `Draft` gains `priority: Priority` and `dueDate: string` (`""` for none, as
  an `<input type="date">` holds it). `draftOf` fills both; `changesOf` sends `priority`
  when it differs, and `dueDate` when it differs, as the date or `null` when emptied
  (WS-102 section 4: `null` clears it). One save of both is one `PATCH`, one `version`
  and two history entries, as the server already does. The existing draft merge after
  someone else's save (`sameValue`) works for both: they are strings.
- **Form.** After "Epic", two fields in the existing two-column grid:
  - "Priority": a native `select` styled like the others, options None, Low, Medium,
    High, Urgent.
  - "Due date": a native `<input type="date">` (keyboard operable, with the browser's
    picker), and beside it a "Clear" button, shown when there is a date, whose accessible
    name is "Clear due date" (it contains the visible text, WCAG 2.5.3). Clearing focuses
    the date input. A field error from the API (`dueDate`) shows under it, as the title's
    does.
  - The overdue mark is not in the form; the read view and the card show it.

### 5. Tests with a fixed clock

- **Unit (Vitest).** `due-date.test.ts` passes explicit `today` strings and builds
  `Date`s from local parts (`new Date(2026, 10, 23, 23, 59)`), so it gives the same
  result in every time zone. `use-today.test.tsx` uses `vi.useFakeTimers()` and
  `vi.setSystemTime(new Date(2026, 10, 23, 23, 59))`, advances two minutes and sees the
  date turn. Component tests that show "Overdue" fix the date the same way.
- **End to end (Playwright).** `page.clock.setFixedTime(...)` fixes `Date` and leaves
  timers alone, so the live stream and its reconnects work. A dedicated test runs two
  browser contexts at the same instant with `timezoneId: "Pacific/Kiritimati"` (UTC+14)
  and `"UTC"`: at `2030-06-15T11:00:00Z` the first is already on June 16, so a task due
  June 15 is overdue there and not in the second. This proves "today in the viewer's
  browser" against the real app. The installed Playwright docs are read before writing it
  (hard rule 13).
- **History.** There is no API to read a task's history until WT-08's timeline. The
  end-to-end test reads `task_events` through a new `taskHistory(taskId)` helper in
  `tests/e2e/seed.ts`, which already opens its own connection to the end-to-end database
  (question 5).

## Files

| Path                                                                   | Change                                                      |
| ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| `src/components/task/due-date.ts`, `due-date.test.ts`                  | create: `localDate`, `isOverdue`, `formatDueDate`           |
| `src/hooks/use-today.ts`, `use-today.test.tsx`                         | create                                                      |
| `src/components/task/task-meta.tsx`, `task-meta.test.tsx`              | create: `PRIORITY_LABELS`, `PriorityIcon`, `DueDateText`    |
| `src/components/board/task-card.tsx`, `task-card.test.tsx`             | modify: priority, due date, `done`                          |
| `src/components/board/board-column.tsx`, `board.tsx`, `board.test.tsx` | modify: `done` from the column's category, the drag overlay |
| `src/components/backlog/backlog.test.tsx`                              | modify: a row shows both, overdue                           |
| `src/components/task/details-section.tsx`, `task-detail.test.tsx`      | modify: rows, draft, fields                                 |
| `tests/e2e/seed.ts`                                                    | modify: `taskHistory`                                       |
| `tests/e2e/priority-due-date.spec.ts`                                  | create                                                      |
| `tests/e2e/accessibility.spec.ts`                                      | modify: every priority and an overdue task                  |
| `docs/work-items/WI-110-priority-due-date-ui.md`, this file            | status                                                      |

## Data model changes

None.

## API contract

None; the web app uses WI-102's fields and `PATCH /api/v1/tasks/{taskId}`.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                                                                                                                                                                                                                                                                          | Covers criterion |
| --- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit  | `localDate`: local parts, `23:59` and `00:00` of a day give that day; `isOverdue`: yesterday true, today false, tomorrow false, `null` date false, `done` false, `null` today false; `formatDueDate`: `2026-12-01` is "Dec 1, 2026", `2028-02-29` is "Feb 29, 2028"                                                                                                           | 3                |
| 2   | unit  | `useToday`: today's local date; at local midnight the date turns with the timers advanced; a `visibilitychange` re-reads it; two components share one timer; unmounting both clears it                                                                                                                                                                                        | 4                |
| 3   | unit  | `PriorityIcon`: an image named "Priority: ‹level›" with that `title` for each of the four levels, a different icon for each; nothing for `none`                                                                                                                                                                                                                               | 1                |
| 4   | unit  | `DueDateText`: "Due Dec 1, 2026"; overdue "Overdue, due Dec 1, 2026"; nothing without a date                                                                                                                                                                                                                                                                                  | 2, 3             |
| 5   | unit  | the card: priority icon and due date shown; nothing for `none` and no date; with the clock fixed, a past date is "Overdue" outside a `done` column and is not with `done`; due today is not                                                                                                                                                                                   | 1, 2, 3          |
| 6   | unit  | the board: a past-due card in a `todo` column says "Overdue"; the same task in the `done` column does not; after a live `task.moved` into `done` the mark goes                                                                                                                                                                                                                | 3                |
| 7   | unit  | the Backlog page: a row shows the priority icon and "Overdue" for a past date                                                                                                                                                                                                                                                                                                 | 1, 2, 3          |
| 8   | unit  | the task detail, read view: "Priority" with its word or "None"; "Due date" with the date, "Overdue" for a past date outside `done`, not in a `done` column, "None" without a date                                                                                                                                                                                             | 5                |
| 9   | unit  | the task detail, form: choosing High sends `{ priority: "high", version }` only; setting a date sends `dueDate: "2026-12-01"` only; "Clear due date" empties it, focuses the input, and the save sends `dueDate: null`; saving only the title sends neither; a `dueDate` field error shows at the field; another person's save keeps an unsaved priority                      | 6                |
| 10  | e2e   | accessibility, light and dark: a board and the Backlog page with tasks of each priority and an overdue task, and the task detail of the overdue task, as a Member                                                                                                                                                                                                             | 7                |
| 11  | e2e   | a Member, with the clock fixed, sets priority High and saves, sets a past due date and saves, sees "Overdue" in the detail and on the card, clears the date and saves, sets priority None and saves; `taskHistory` holds four `field_changed` entries with the right old and new values and the Member as actor; the card in a `done` column shows the date without "Overdue" | 6, 8             |
| 12  | e2e   | the viewer's time zone: at `2030-06-15T11:00:00Z`, a task due `2030-06-15` is overdue on a page in `Pacific/Kiritimati` and not on a page in `UTC`                                                                                                                                                                                                                            | 3, 8             |
| 13  | gate  | `pnpm check`, `pnpm test`, `pnpm test:e2e`                                                                                                                                                                                                                                                                                                                                    | all              |

## Risks and open questions

1. **How a due date is written.** `Dec 1, 2026` in English, the same for everyone
   (section 1), or the viewer's locale (`1 dez. 2026` in Portuguese), as the app already
   does for timestamps with `toLocaleString()`. The whole interface is in English, and a
   fixed format makes the tests exact on any machine. **Recommend: fixed English, with
   the year.** Alternative: the viewer's locale, with tests that build the expected text
   with the same `Intl` call.
2. **Priority and due date in the "Add task" dialog.** WT-07 decision 14 names the card
   and the task detail; the API already accepts both on create. Adding them to the dialog
   touches the board's and the backlog's "Add task" and their tests. **Recommend: not in
   this item; a person sets them in the task detail after creating. A follow-up if the
   team asks.** Alternative: two more fields in the dialog now.
3. **Priority on the card as an icon alone.** Decision 14 says an icon with an accessible
   name; sighted mouse users get the word from `title`, keyboard users and touch users do
   not see a tooltip. The detail shows the word. **Recommend: the icon alone, as the
   decision says, with distinct shapes per level.** Alternative: the icon and a short word
   ("High") on the card, which makes cards wider.
4. **Midnight with the page open.** A board left open overnight would keep yesterday's
   marks until a reload. **Recommend: the shared `useToday` store of section 1, one
   timer and a re-read on `visibilitychange`.** Alternative: compute today at render
   only, and accept stale marks until something re-renders.
5. **History in the end-to-end test.** No endpoint reads a task's history before WT-08.
   **Recommend: read `task_events` from the test through `tests/e2e/seed.ts`, which
   already writes the database directly.** Alternative: assert history only in the
   integration tests WI-102 already has, and leave the end-to-end test to the UI.

Risks:

- **`CardBody` is shared** by the board, the Backlog page and the drag overlays. A wrong
  `done` makes a done card look overdue. Tests 5 to 7 cover each place; the overlay takes
  its column's category from the active task.
- **Native date inputs differ** between browsers in look and in how they are cleared.
  The "Clear" button gives one way that works everywhere; end-to-end tests run in
  Chromium (`fill` on the input).
- **`useSyncExternalStore` and fake timers.** The store reads `Date` on every snapshot;
  under fake timers the snapshot must be cached per date so React does not loop. Test 2
  catches it.

## Implementation record
