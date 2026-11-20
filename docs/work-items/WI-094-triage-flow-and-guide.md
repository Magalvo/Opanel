# WI-094 — The triage flow end to end, filing bug reports in the guide, and WT-06's amendments

- Status: In progress (approved by the owner on 2026-11-20)
- Work-track: [WT-06](../work-tracks/WT-06-bug-reports-and-triage.md) (item H, the last)
- Depends on: WI-089, WI-090, WI-091, WI-092 (all done)
- Work-spec: [WS-094](../work-specs/WS-094-triage-flow-and-guide.md)

## Outcome

WT-06 is closed. An end-to-end test proves the whole triage flow through the running app:
an agent with a token files a report, the bug appears live on every open board at the top
of the first column, assigned to the team of its layer, a repeat counts on it, and the task
detail shows what triage did. Agent authors learn how to file reports from
`docs/agents.md`, and canonical docs 0001 and 0003 say what WT-06 actually built.

## Acceptance criteria

- [ ] `tests/e2e/triage-flow.spec.ts`: an Admin sets up a team, a project with its triage
      settings, and an agent with a token through the API; two people have the board open.
      The agent's report answers `201 created` with the layer's team, and on both boards,
      without a reload, a `bug` card appears first in the first column with the team's
      name and its severity.
- [ ] In the same test, a second report with the same fingerprint answers
      `200 deduplicated` with `occurrences` 2, creates no card, and both boards show
      "2 reports" without a reload.
- [ ] In the same test, a report with layer `unknown` goes to the project's triage team,
      and a report into a project outside the agent's restriction answers `403`.
- [ ] In the same test, the task detail shows the severity, "Reported 2 times", both
      reports with the agent, the evidence in the description and the system comments;
      after the bug is moved to a `done` column, a third report creates a new bug whose
      detail shows "Regression of" the first.
- [ ] `docs/agents.md` has a "Filing bug reports" section: the endpoint and body, the two
      outcomes, the layer table, fingerprint guidance, and reading reports through
      `GET /api/v1/tasks/{taskId}/bug-reports`. The `reports:write` row no longer says
      "not yet", and "What comes next" no longer lists WT-06.
- [ ] The guide's doc check (`scripts/agents-guide.test.ts`) checks the new section: its
      place among the sections, exactly the origin layers, both outcomes, and an example
      body that the request schema accepts.
- [ ] Doc 0001 sections 5, 6 and 7 and doc 0003 section 7 carry WT-06's amendments,
      matching the code; WT-06 decision 4 says `PATCH`.
- [ ] Every WT-06 exit criterion is checked off with where it is tested, WT-06 is Done,
      and `docs/README.md` has the Follow-up for WT-10 (`placeNewBug`).
- [ ] The full quality gate passes.

## Notes

WT-06 decisions 3, 6, 7, 9, 10, 13 and 16, and its exit criteria. No application code: the
E2E test runs against what items A to G built. WS-091's `bugs.spec.ts` already covers the
card and detail of a bug filed by a seeded agent; this item's test is the flow across
setup, routing, live boards and dedupe.

Numbered WI-094: WI-093 went to the PostHog add-on (WT-13), merged first; the owner chose
WI-094 on 2026-11-20. The branch keeps its name, `claude/wi-093-triage-flow-and-guide-ace4f4`.
