# WI-136 — Links in the UI

- Status: Done (approved by the owner on 2026-11-27, with WS-136; done on 2026-11-27)
- Work-track: [WT-09](../work-tracks/WT-09-subtasks-and-links.md) (item D)
- Depends on: [WI-134](WI-134-links-api.md) (item B, done)
- Work-spec: [WS-136](../work-specs/WS-136-links-ui.md)

## Outcome

People see and change a task's links in the web app. Every task's page has a "Links"
section that groups its links by how this task reads them ("Blocks", "Is blocked by", …).
People who edit tasks can add a link of any type to a task they find by key or words, in
any project they can reach, and can remove a link. The bug section keeps only its reports,
and a page that is open on either task follows a link change with no reload.

## Acceptance criteria

- [x] Every task's page has a "Links" section. Links are grouped under doc 0003's readings
      in a fixed order: "Blocks", "Is blocked by", "Duplicates", "Is duplicated by",
      "Regression of", "Has regression" and "Relates to". Each link shows the other task's
      key and title as one link to that task. Empty groups are left out, and with no links
      the section says "No links yet.". For a Viewer with no links, the section is left out.
- [x] People who edit tasks see "Add link". It opens a dialog with a "Link type" choice of
      the seven readings and a search of tasks in every project the person can reach, by
      key or words. The task itself is never offered. Choosing a task adds the link, and it
      shows in its group.
- [x] Each link has "Remove" for people who edit, named for what it removes ("Remove
      link: blocks API-3"). After a removal the link is gone and the focus moves to "Add
      link".
- [x] The API's refusals are shown in words: `link_exists`, `too_many_links`, a `403` on
      the other task, a `400` on `taskId` (inside the dialog), and `project_archived` (as
      for other changes).
- [x] A link added or removed by this page does not show the "changed elsewhere" message,
      and unsaved edits in the details form are kept and save without a conflict.
- [x] A page open on the other task of the link shows the new link with no reload.
- [x] The bug section no longer lists regression links. They are in "Links", where
      "Regressed by" now reads "Has regression".
- [x] The accessibility checks pass for a page with links of several types and for the
      "Add link" dialog, in light and dark mode. Every new control can be reached by
      keyboard.
- [x] The full quality gate passes.

## Notes

- No API change. Cards, rows and the list view gain nothing (WT-09 decision 12).
