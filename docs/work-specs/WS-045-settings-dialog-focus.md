# WS-045 — Project settings dialogs give the focus back on close

- Status: Proposed
- Work-item: [WI-045](../work-items/WI-045-settings-dialog-focus.md)
- Canonical docs: `AGENTS.md` hard rule 13; [WS-036](WS-036-projects-pages.md) test 11;
  [WS-037](WS-037-board-page.md) "Deviations" ("Add task" gets the focus back explicitly)

## Approach

**Cause.** In the installed `@radix-ui/react-dialog` 1.3.1 (`radix-ui` 1.8.1), modal
`DialogContent` composes `onCloseAutoFocus` with a handler that calls
`event.preventDefault()` and then `context.triggerRef.current?.focus()`. `AlertDialogContent`
wraps the same content. Without a `DialogTrigger`, `triggerRef` is null, so the default
return of focus is cancelled and nothing is focused: the focus falls to `<body>`. All four
dialogs of the settings page are controlled and have no trigger (seen in Chromium on
2026-11-16 for each of them).

**Fix, as on the board (WS-037).** The element that opened a dialog is kept with the dialog's
state, taken from `event.currentTarget` in the opener's click handler. The dialog's content
receives it and gives it the focus itself:

```tsx
<DialogContent
  onCloseAutoFocus={(event) => {
    event.preventDefault();
    returnFocusTo?.focus();
  }}
>
```

Radix runs our handler first, so `preventDefault()` also stops FocusScope's own fallback;
the result is the same whether the dialog closes by Escape, Cancel, the close button or a
submit, and also when the parent unmounts it (FocusScope fires the same event on unmount).

Per dialog:

1. **Add column.** `ColumnsSection`'s `adding` state becomes `HTMLElement | null` (the "Add
   column" button) instead of a boolean. `ColumnDialog` gets a `returnFocusTo:
HTMLElement | null` prop, documented as on `NewTaskDialog`.
2. **Edit column.** `editing` becomes `{ column: Column; opener: HTMLElement } | null`. The
   row is keyed by column id, so after a save the same Edit button (with its new label)
   is still in the page and keeps the focus.
3. **Delete column** (question 1). `deleting` becomes `{ column; opener } | null`, and
   `AlertDialogContent` gets the same `onCloseAutoFocus`. Escape and Cancel return to the
   Delete button. A confirmed delete removes the row, and with it the button that would get
   the focus, once the list is read again; so after a successful delete `ColumnsSection`
   focuses "Add column" (question 2). A failed delete leaves the row and the focus on its
   Delete button.
4. **Archive project** (question 1). `DetailsSection` keeps the "Archive project" button in
   a ref and gives it the focus on close. A confirmed archive replaces that button by
   "Unarchive project" once the request succeeds, so `DetailsSection` then focuses
   "Unarchive project" (question 2). A failed archive leaves "Archive project", which
   already has the focus.

No new shared helper: four call sites of a two-line handler, the same as the board's. A
shared wrapper can come when a third page needs it.

## Files

| Path                                                                                                             | Change                                                                 |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/components/projects/column-dialog.tsx`                                                                      | modify: `returnFocusTo` prop, `onCloseAutoFocus`                       |
| `src/components/projects/columns-section.tsx`                                                                    | modify: openers kept in state; delete dialog focus; focus after delete |
| `src/components/projects/details-section.tsx`                                                                    | modify: archive dialog focus; focus "Unarchive project" after archive  |
| `src/components/projects/project-settings.test.tsx`                                                              | modify: tests 1 to 8                                                   |
| `tests/e2e/projects.spec.ts`                                                                                     | modify: test 9                                                         |
| `docs/work-items/WI-045-…`, `docs/work-specs/WS-045-…`, `docs/README.md`, `docs/work-tracks/WT-03-board-core.md` | modify: statuses; remove the follow-up line                            |

Questions 1 and 2 decide whether the delete and archive rows of this table, and tests 5 to
8, are kept.

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

Unit tests use `userEvent`, close the dialog, wait for it to leave the page, then
`await waitFor(() => expect(button).toHaveFocus())`, because FocusScope gives the focus back
in a timer. Each fails today (the focus is on `<body>`) and passes after the change.

| #   | Level | Test                                                                                                                                                                                                                                                              | Covers criterion |
| --- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit  | "Add column", then Escape: the dialog closes and "Add column" has the focus                                                                                                                                                                                       | Add column       |
| 2   | unit  | "Add column", fill in and submit: once the list is read again, "Add column" has the focus                                                                                                                                                                         | Add column       |
| 3   | unit  | "Edit In progress", then Escape: "Edit In progress" has the focus                                                                                                                                                                                                 | Edit column      |
| 4   | unit  | "Edit In progress", rename to "Doing" and save: "Edit Doing" has the focus                                                                                                                                                                                        | Edit column      |
| 5   | unit  | "Delete In progress", then Escape, and again with Cancel: "Delete In progress" has the focus                                                                                                                                                                      | Delete column    |
| 6   | unit  | "Delete In progress", confirm, the column is gone: "Add column" has the focus                                                                                                                                                                                     | Delete column    |
| 7   | unit  | "Archive project", then Escape, and again with Cancel: "Archive project" has the focus                                                                                                                                                                            | Archive project  |
| 8   | unit  | "Archive project", confirm: "Unarchive project" has the focus                                                                                                                                                                                                     | Archive project  |
| 9   | e2e   | in the existing Manager flow, before adding and before editing a column: open the dialog, press Escape, `expect(...).toBeFocused()` on "Add column" and "Edit Done"; the same for "Delete Done" (Escape) and "Archive project" (Escape) if question 1 is accepted | all, in Chromium |
| 10  | gate  | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                                                                                                                                                           | gate             |

## Risks and open questions

For the owner:

1. **Scope: the two confirmation dialogs.** The follow-up names the column dialogs (Add,
   Edit). The column delete confirmation and the archive confirmation on the same page have
   the same cause and the same symptom (both seen in Chromium). Proposed: fix all four in
   this item, since it is one page, one cause and one fix. The alternative is a later item
   for the two confirmations. **Recommend: all four.**
2. **Where the focus goes when the opener is gone.** After a confirmed delete, the row and
   its Delete button disappear; after a confirmed archive, "Archive project" is replaced by
   "Unarchive project". Proposed: "Add column" and "Unarchive project" respectively, the
   nearest control that does the next likely thing. The alternative is to leave the focus
   where Radix returns it, which becomes `<body>` once the button is removed.
   **Recommend: as proposed.**
3. **WS-036 and the code disagree (hard rule 11).** WS-036 test 11 says "Escape closes
   dialogs and returns focus", but no settings test checks the focus, which is how the gap
   went unnoticed. This item adds those tests; WS-036 is left as it is (it is `Done`), and
   this spec is the record. **Recommend: as proposed.**
4. **Number.** WI-042 to WI-044 are taken on unmerged branches from the audit of
   2026-11-14 (`claude/wi-042-…` to `claude/wi-044-…`), so this item takes 045 to avoid a
   clash when they merge.
