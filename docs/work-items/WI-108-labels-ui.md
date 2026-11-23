# WI-108 — Labels in the UI

- Status: In progress
- Work-track: [WT-07](../work-tracks/WT-07-backlog-priority-due-dates-labels.md) (item F)
- Depends on: [WI-107](WI-107-labels-api.md) (done: the labels API)
- Work-spec: [WS-108](../work-specs/WS-108-labels-ui.md)

## Outcome

People see a task's labels as coloured chips on its card and in its detail, apply and
remove them in the task detail, create a label from there when they may, and Managers
rename, recolour and delete labels in the project's settings. Open boards and task
details follow label changes live.

## Acceptance criteria

- [ ] A card shows its labels as chips, by name, after its other badges; each chip has the
      label's colour in light and dark mode and its name as text, so colour is never the
      only signal.
- [ ] The task detail shows the labels; its edit form has a labels picker that applies and
      removes them, saved with the other fields in one `PATCH` that sends `labelIds` only
      when they changed.
- [ ] Someone with `labels:write` creates a label from the picker by typing a name that no
      label has; it is created at once and selected. Without `labels:write` the picker
      only applies existing labels, and without `tasks:write` there is no picker.
- [ ] The project settings gain a "Labels" section: the project's labels by name, adding
      one, renaming and recolouring one, deleting one after a confirmation that says it is
      removed from every task. `label_name_taken`, `too_many_labels`, `version_conflict`
      and `project_archived` each get a plain message.
- [ ] A `label.changed` event updates the names and colours on an open board without
      reloading it, and refreshes an open task detail's labels and picker.
- [ ] The board, a task detail with labels and the settings page pass the accessibility
      check in light and dark mode, with a chip of each of the ten colours.
- [ ] An end-to-end test: a Member creates a label from the picker and applies it, the
      card shows it; a Manager renames it in the settings, and a second open board shows
      the new name without a reload.

## Notes

WT-07 item F: decision 14, question 3. No API change.
