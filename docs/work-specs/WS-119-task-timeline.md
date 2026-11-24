# WS-119 — The timeline on the task page

- Status: In progress (approved by the owner on 2026-11-24, questions 1 and 2 as recommended)
- Work-item: [WI-119](../work-items/WI-119-task-timeline.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) section 9 ("the task page
  shows events and comments on one timeline"); [0002](../canonical/0002-realtime-sync.md)
  section 4 (the events it follows); [WT-08](../work-tracks/WT-08-search-filters-list-timeline.md)
  decisions 10 to 12; [WS-117](WS-117-task-activity.md) (the activity endpoint and its
  values); the follow-up on `main` from WS-074 section 6 (actors through `AccountName`)

## Approach

### 1. Starting point, checked against `main` (`21e45fa`)

- `task-detail.tsx` loads the task, its columns, comments, teams, epics, labels and bug
  reports in one `Promise.all`, and renders `CommentsSection` (`comments-section.tsx`) last:
  a region named "Comments" with the comments, "Load more", "Could not load more
  comments." and the form ("New comment", "Add comment").
- `CommentsSection` keeps its list with `usePagedList` (items need an `id`), and follows
  `comment.created` through `useProjectEventListener`: it reads the list again when every
  page is shown, and on a reconnect reads again as many as it showed (WS-049).
- Six end-to-end specs and `task-detail.test.tsx` find the section by the region name
  "Comments".
- Labels for values already exist: `TYPE_LABELS` (`board/task-card.tsx`),
  `PRIORITY_LABELS` (`task/task-meta.tsx`), `SEVERITY_LABELS` (`task/bug-labels.ts`) and
  `formatDueDate` (`task/due-date.ts`).

### 2. The section

`ActivitySection` (`src/components/task/activity-section.tsx`) replaces
`CommentsSection`, with the same props and the same comment form. It is a region named
**"Activity"** (question 1), with:

- a header with the heading and a "Comments only" switch (`role="switch"`, shadcn/ui
  `Switch`), off by default and not remembered between visits;
- the list: comment items as today's comment cards; change items as one line each, in a
  smaller muted style, without a card;
- "Load more" and "Could not load more activity." as today;
- the form, unchanged.

The list holds `{ id: "comment:<id>" | "event:<id>", item }` so `usePagedList` can key it.
"Comments only" filters what is shown, not what is read: "Load more" still reads activity
pages (question 2). When it hides everything shown, the list says "No comments yet."

### 3. The sentences

A pure module, `src/components/task/activity-text.tsx`, turns one event into its sentence,
always "‹actor› ‹what›", with values in quotes or by their labels:

| Event                          | Sentence                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| `created`                      | created the task in ‹column›, or in the backlog                                        |
| `title`                        | changed the title from “‹old›” to “‹new›”                                              |
| `description`                  | changed the description, with "Show changes"                                           |
| `type`, `priority`, `severity` | changed the ‹field› from ‹old label› to ‹new label›; set or cleared for `null`         |
| `dueDate`                      | set the due date to ‹date›, changed it from ‹old› to ‹new›, or cleared it              |
| `assigneeAccountId`            | assigned it to ‹person›, changed the assignee from ‹old› to ‹new›, or unassigned ‹old› |
| `assigneeTeamId`, `epicId`     | as for the assignee, with the team or the epic                                         |
| `labels`                       | added the label ‹a›; removed the labels ‹b› and ‹c›                                    |
| `moved`                        | moved it from ‹column› to ‹column›, “the backlog” for `null`                           |
| `deleted`, `restored`          | deleted the task, restored the task                                                    |
| `reported_again`               | reported it again (‹n› reports in all)                                                 |
| a field it does not know       | changed the ‹field›                                                                    |

- The actor is `AccountName` (the agent badge comes with it); with no actor, "Opanel".
- A `NamedRef` with `name: null` reads "a deleted team", "a deleted column" or "a deleted
  epic"; a person always has a name.
- "Show changes" is a button that toggles a block with "Before" and "After", each the
  text as plain, wrapped text, not Markdown, so a half-written change renders as written.
- Values are read with the WS-117 shapes and checked with small Zod schemas; a value that
  does not match falls back to "changed the ‹field›", so an unknown shape never breaks the
  page.

### 4. Time

Each line ends with a `<time dateTime=…>` showing a relative time ("3 minutes ago", "2
days ago", with `Intl.RelativeTimeFormat` in English) and the exact local time in its
`title`. Times over 30 days old show the date. The relative text is computed when the list
renders; it does not tick.

### 5. Live

`ActivitySection` keeps `CommentsSection`'s rule, on more events: on `task.updated`,
`task.moved`, `task.deleted`, `task.restored` or `comment.created` for this task, when every
page is shown it reads the activity again from the start; otherwise the new items come with
"Load more". On a reconnect it reads again as many as it showed. One's own comment is added
at once, as today; one's own field changes arrive through their own `task.updated`.

### 6. The page

`task-detail.tsx` loads `listActivity(taskKey)` instead of `listComments(taskKey)` and
renders `ActivitySection`. `api.ts` gains `listActivity(key, cursor?)` with a page of 50
and drops the page's `listComments`, which nothing else on the page uses.

## Files

| Path                                         | Change                                                  |
| -------------------------------------------- | ------------------------------------------------------- |
| `src/components/task/activity-text.tsx`      | create: section 3                                       |
| `src/components/task/activity-text.test.tsx` | create: one test per row of section 3                   |
| `src/components/task/activity-section.tsx`   | create: sections 2, 4, 5                                |
| `src/components/task/comments-section.tsx`   | delete                                                  |
| `src/components/task/api.ts`                 | modify: `listActivity`                                  |
| `src/components/task/task-detail.tsx`        | modify: section 6                                       |
| `src/components/task/task-detail.test.tsx`   | modify: the comments tests read the activity            |
| `src/components/ui/switch.tsx`               | create: shadcn/ui `Switch`, on the installed `radix-ui` |
| `tests/e2e/*.spec.ts` (six specs)            | modify: the region "Comments" becomes "Activity"        |
| `tests/e2e/timeline.spec.ts`                 | create: tests 9 and 10                                  |
| `tests/e2e/accessibility.spec.ts`            | modify: a task page with changes, both themes           |

## Data model changes

None.

## API contract

None: the page reads `GET /api/v1/tasks/{taskId}/activity` (WI-117).

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                  | Covers criterion |
| --- | ----- | --------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit  | `activity-text`: each row of section 3, the agent badge, "Opanel" with no actor, deleted names, an unknown shape      | 2, 3             |
| 2   | unit  | "Show changes" shows and hides the old and new description as plain text                                              | 3                |
| 3   | unit  | the relative time and its `<time>` element with the exact time                                                        | 4                |
| 4   | unit  | the task page shows comments and changes in order in the "Activity" region, and "Load more" reads the next page       | 1                |
| 5   | unit  | "Comments only" hides changes and shows them again; it is a switch named "Comments only"                              | 5                |
| 6   | unit  | adding a comment shows it at once and keeps the form as today                                                         | 1                |
| 7   | unit  | a `task.updated` for this task reads the activity again when every page is shown, and not when more pages remain      | 6                |
| 8   | unit  | a reconnect reads again as many items as were shown                                                                   | 6                |
| 9   | e2e   | two people on one task: one changes the priority and moves the task, the other's timeline shows both lines, no reload | 2, 6             |
| 10  | e2e   | an agent's change shows its badge in the timeline                                                                     | 2                |
| 11  | e2e   | the accessibility check of a task page with changes and "Show changes" open, light and dark                           | 7                |

## Risks and open questions

Questions for the owner, each with a recommendation:

1. **The section's name.** It holds more than comments now. **Recommend: "Activity"**,
   with the six end-to-end specs that find the region "Comments" updated to it; the
   alternative keeps "Comments" as the name of a region that also lists changes.
2. **"Comments only" filters what is shown, not what is read.** A task with many changes
   and few comments may need "Load more" a few times before its next comment shows.
   Reading the comments endpoint instead while the switch is on would be exact but would
   keep two lists in step. **Recommend: filter what is shown, and keep one list.**

Risks:

- **Six end-to-end specs change their selector.** The change is the region name only;
  what they check stays the same.
- **Sentences for every field** grow with each field a later track adds (WT-09 sub-tasks
  and links, WT-10 sprints and points). The fallback "changed the ‹field›" keeps an unknown
  field readable until its sentence is added.
