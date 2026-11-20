# WI-091 — Bugs in the UI

- Status: Approved (by the owner on 2026-11-20, questions 1 to 7 as recommended)
- Work-track: [WT-06](../work-tracks/WT-06-bug-reports-and-triage.md) (item F)
- Depends on: WI-088 (done), WI-090 (done)
- Work-spec: [WS-091](../work-specs/WS-091-bugs-in-the-ui.md)

## Outcome

People see bugs where they work. A bug's card on the board shows its severity and, when
it was reported more than once, how often. A bug's detail shows its severity (editable by
people with `tasks:write`), how often and when it was last reported, its regression links
to other tasks, and the reports behind it, each with the agent that sent it.

## Acceptance criteria

- [ ] A card of a task with a severity shows it as a small badge, named for screen
      readers; a card whose `occurrences` is above 1 shows the count. Other cards are
      unchanged.
- [ ] The task detail of a bug shows its severity. With `tasks:write` on a project that is
      not archived, the form has a "Severity" select (none, low, medium, high, critical)
      while the type is `bug`; a save sends only a changed `severity`, `null` to clear it,
      through `PATCH /api/v1/tasks/{taskId}`.
- [ ] A task with `occurrences` above 0 shows "Reported N times, last …" (or "Reported
      once, …").
- [ ] A task's `links` are shown as links to the other tasks, by key and title, with
      "Regression of" for an outgoing link and "Regressed by" for an incoming one.
- [ ] A task with `occurrences` above 0 has a "Reports" section listing
      `GET /api/v1/tasks/{taskId}/bug-reports`, newest first, 10 at a time with "Load
      more". Each report shows the agent with the "Agent" badge, time, outcome, layer,
      confidence, severity and run id, and its title, summary and evidence as plain text.
- [ ] When the task changes elsewhere (`task.updated`), a new count, `lastReportedAt` and
      report appear without a reload; the card's count follows on open boards.
- [ ] Viewers and archived projects see all of it read-only. The pages pass the axe check
      in light and dark mode and have no horizontal page scroll at phone width.
- [ ] The UI uses only `/api/v1`. The full quality gate passes, with an end-to-end test
      that files reports with an agent's token and sees them on the board and in the
      detail.

## Notes

WT-06 decision 15, item F. No API, schema or migration change: everything read here exists
since WS-088 and WS-090. The "Triage" settings section is item G (WI-092).
