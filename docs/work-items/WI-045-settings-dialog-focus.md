# WI-045 — Project settings dialogs give the focus back on close

- Status: Proposed
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (follow-up of WI-036, found in a
  browser while checking WI-037)
- Depends on: WI-036, WI-037
- Work-spec: [WS-045](../work-specs/WS-045-settings-dialog-focus.md)

## Outcome

On `/projects/KEY/settings`, closing a dialog leaves the keyboard focus on the button that
opened it, instead of on the page body. Today every dialog of the page is controlled and
has no `DialogTrigger`, so Radix has nothing to give the focus back to. Seen in Chromium on
2026-11-16: after Escape, `document.activeElement` is `<body>` for "Add column", "Edit
column", "Delete column" and "Archive project".

## Acceptance criteria

- [ ] "Add column": closing the dialog with Escape, or by adding a column, puts the focus
      back on the "Add column" button.
- [ ] "Edit column": closing the dialog with Escape, or by saving, puts the focus back on
      that column's Edit button.
- [ ] "Delete column" (scope question 1 of WS-045): Escape or Cancel puts the focus back on
      that column's Delete button; after a column is deleted, the focus goes to "Add column".
- [ ] "Archive project" (scope question 1 of WS-045): Escape or Cancel puts the focus back
      on "Archive project"; after the project is archived, the focus goes to "Unarchive
      project".
- [ ] Each criterion is covered by a unit test; the Escape cases of the column dialogs are
      also covered end to end in a real browser.
- [ ] The full quality gate passes.

## Notes

The fix follows the board's "Add task" dialog (WS-037, "Deviations"): the opener is kept
with the dialog's state and `DialogContent` gives it the focus in `onCloseAutoFocus`.
