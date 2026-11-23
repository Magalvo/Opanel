# WS-108 — Labels in the UI

- Status: Approved (approved by the owner on 2026-11-23, questions 1 to 4 as proposed)
- Work-item: [WI-108](../work-items/WI-108-labels-ui.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 3 and 4;
  [0002](../canonical/0002-realtime-sync.md) section 4;
  [WT-07](../work-tracks/WT-07-backlog-priority-due-dates-labels.md) decisions 12 and 14,
  question 3; [WS-107](WS-107-labels-api.md) (the API)

## Approach

The web app consumes the labels API of WI-107; no server change. Items D (the Backlog
page) and E (priority and due date in the UI) also edit the card and the task detail;
whichever merges second takes in `main` (`AGENTS.md` section 8).

### 1. The chip

A new `src/components/labels/label-chip.tsx`: a small rounded chip with the label's name as
text, its colour from a fixed map of the ten palette colours to Tailwind classes:

| Mode  | Background     | Text           | Border         |
| ----- | -------------- | -------------- | -------------- |
| light | `{colour}-100` | `{colour}-800` | `{colour}-200` |
| dark  | `{colour}-950` | `{colour}-200` | `{colour}-800` |

(`gray` uses Tailwind's `gray`; the classes are written out in full so Tailwind finds them.)
The name is always shown, so colour is never the only signal (WCAG 1.4.1). A long name is
truncated with an ellipsis and its full name in `title`. The accessibility check (test 10)
confirms the contrast of all ten in both modes.

### 2. The card

`CardBody` (`board/task-card.tsx`) adds a row of chips after its badges when the task has
labels, as a list with an `sr-only` "Labels:" before it. Cards hold the `TaskSummary` the
API already answers, which has `labels`; no extra request.

### 3. The task detail

- **Read view.** A "Labels" row in the details list: the chips, or "None".
- **Edit form.** A "Labels" field in `details-section.tsx`'s form, below the epic, when
  the person has `tasks:write` (the form already exists only then). It is a new
  `src/components/labels/label-picker.tsx`: the selected labels as chips, each with a
  remove button ("Remove label Bug"), and a button that opens a list of the project's
  labels with a checkbox each (the existing `DropdownMenu` with `DropdownMenuCheckboxItem`,
  which is keyboard operable), filtered by a text box at its top. The draft gains
  `labelIds`; `changesOf` sends `labelIds` only when the set differs, so a save of other
  fields needs no `labels:write` (question 1).
- **Creating from the picker.** When the person has `labels:write` and the filter text
  matches no label's name (ignoring case), the list offers "Create label ‹text›". It
  `POST`s at once with colour `gray`, adds the label to the list and selects it; the task
  changes only when the form is saved. A `label_name_taken` (someone else made it
  meanwhile) reloads the list and selects that label instead.
- **Permissions.** `taskAccess` (`task-access.ts`, shared by the task page and its dialog
  route) gains `canWriteLabels = can(actor, "labels:write")` beside `canWriteTasks`. Members, Managers and Admins have both; Viewers neither; agents
  never use the web app.
- **Live.** On `label.changed`, the task detail reloads the project's labels (for the
  picker) and the task (for the chips), as it does today for `column.changed` and
  `epic.changed`. A label taken off the task by a deletion also arrives as `task.updated`.

### 4. The board, live

On `label.changed` the board does not reload every task (question 2). It asks
`GET /projects/{projectId}/labels` once and rewrites the labels of the cards it holds:
new names and colours, a deleted label dropped. Order within a card is by name, as the
API's. Tasks whose labels changed (a deletion) also get `task.updated` and refresh through
the existing version rule. While a drag or a move is in progress the event waits in the
queue like any other (WS-048).

### 5. The project settings

A new `src/components/projects/labels-section.tsx`, between "Columns" and "Triage":

- A table of the project's labels by name: the chip, the colour's name, Edit and Delete.
- "Add label": a dialog with a name and a colour (a radio group of the ten colours, each
  shown as a chip with its name).
- Edit: the same dialog, sending only what changed with the label's `version`.
- Delete: an alert dialog, "Delete label ‹name›? It is removed from every task that has
  it. This cannot be undone."
- Messages: `label_name_taken` "Another label has this name.", `too_many_labels`
  "This project already has 200 labels.", `version_conflict` "Someone else changed this
  label. The list was refreshed.", `project_archived` "The project is archived."
- Live: it reloads on `label.changed`, as the columns section does on `column.changed`.
- Read-only when the project is archived, like the other sections.

The settings page is for Managers and Admins (`projects:manage`), who all hold
`labels:manage`; so everyone who sees the section may change it (question 3).

### 6. Client calls

`src/components/labels/api.ts`: `listLabels`, `createLabel`, `updateLabel`,
`deleteLabel`, each through `call` with the shared schemas.

## Files

| Path                                                                       | Change                                    |
| -------------------------------------------------------------------------- | ----------------------------------------- |
| `src/components/labels/api.ts`                                             | create                                    |
| `src/components/labels/label-chip.tsx`, `label-chip.test.tsx`              | create                                    |
| `src/components/labels/label-picker.tsx`, `label-picker.test.tsx`          | create                                    |
| `src/components/board/task-card.tsx`, `board.test.tsx`                     | modify: chips                             |
| `src/components/board/use-board.ts`, `use-board.test.tsx`                  | modify: `label.changed` patches the cards |
| `src/components/task/details-section.tsx`, `task-detail.tsx`, their test   | modify: row, picker, live                 |
| `src/app/(app)/projects/[projectKey]/task-access.ts`, its test             | modify: `canWriteLabels`                  |
| `src/components/projects/labels-section.tsx`, `project-settings.tsx`, test | create, modify                            |
| `tests/e2e/labels.spec.ts`                                                 | create                                    |
| `tests/e2e/accessibility.spec.ts`                                          | modify: chips of the ten colours          |
| `docs/work-items/WI-108-labels-ui.md`, this file                           | status                                    |

## Data model changes

None.

## API contract

None; the web app uses WI-107's endpoints.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                                                                                                                  | Covers criterion |
| --- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit  | `LabelChip`: every colour of `LABEL_COLOURS` has light and dark classes; the name is the chip's text; a long name keeps its full name in `title`                                                                      | 1                |
| 2   | unit  | a card with labels shows a "Labels:" list of chips by name; a card without shows none                                                                                                                                 | 1                |
| 3   | unit  | the task detail's read view lists the labels or "None"                                                                                                                                                                | 2                |
| 4   | unit  | the picker: checking and unchecking labels and saving sends `labelIds` once; saving only a title sends no `labelIds`; a remove button takes one off                                                                   | 2                |
| 5   | unit  | the picker with `labels:write`: a new name offers "Create label", which `POST`s, then selects it; a `label_name_taken` reloads and selects the existing one; without `labels:write` no offer; a Viewer sees no picker | 3                |
| 6   | unit  | the labels section: lists by name; adds; edits sending only what changed with `version`; deletes after the confirmation; the four messages; read-only on an archived project                                          | 4                |
| 7   | unit  | the board on `label.changed`: one `GET` of the labels, cards renamed and recoloured, a deleted label dropped, no reload of the tasks; held during a drag                                                              | 5                |
| 8   | unit  | the task detail on `label.changed` reloads the labels and the task                                                                                                                                                    | 5                |
| 9   | unit  | the settings section reloads on `label.changed`                                                                                                                                                                       | 5                |
| 10  | e2e   | accessibility, light and dark: a board and a task detail with a task carrying a label of each colour, and the settings page with ten labels                                                                           | 6                |
| 11  | e2e   | a Member creates a label from the picker and applies it; the card shows the chip; a Manager renames it in the settings; a second open board shows the new name with no reload                                         | 7                |
| 12  | gate  | `pnpm check`, `pnpm test`, `pnpm test:e2e`                                                                                                                                                                            | all              |

## Risks and open questions

1. **Labels in the edit form, or applied at once.** The task detail edits its fields in
   one form saved together; applying labels at once would make labels the only field
   that saves on its own and could clash with an open form's `version`. **Recommend: in the
   form, saved with the rest.** Creating a label is the exception: it is a project-wide
   change and happens at once. Alternative: apply each label at once, as a tag field
   often does.
2. **The board on `label.changed`.** Reloading the board, as `column.changed` does, is the
   simplest, but the board loads every task and the event comes with every label created
   anywhere in the project. **Recommend: one `GET` of the labels and a rewrite of the
   cards (section 4).** Alternative: reload the board.
3. **Who sees the "Labels" section.** WT-07 decision 14 says everyone reads it, but the
   settings page is for Managers and Admins only (WS-036), and opening it to everyone is a
   larger change. Members see every label in the picker. **Recommend: keep the page as it
   is; the section is for Managers and Admins.** Alternative: a read-only settings page
   for Members and Viewers, its own work-item.
4. **Chip colours.** **Recommend the Tailwind shades of section 1**; the accessibility
   check decides, and a failing shade is changed there, not argued.

Risks:

- **Items D and E edit the same card and task detail.** Each starts from `main`; the one
  that merges second takes in the other.
- **A board with many labels per card** grows taller. Chips wrap within the card's width;
  20 labels is the most a task can carry.
