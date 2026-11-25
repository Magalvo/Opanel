# WI-128 — The live end-to-end tests wait for what they measure

- Status: Done (approved by the owner on 2026-11-25, with WS-128 and the recommended
  answers to its open questions; done on 2026-11-25)
- Work-track: none: the two follow-ups "`planning-flow.spec.ts` fails now and then" (found
  in WI-119) and "`live-board.spec.ts:144` fails now and then" (found in WI-123), recorded
  on `main` and marked "To be answered by WI-128" in `ce1ac26`
- Depends on: none (builds on the board's live logic of WI-123 and the stream of WI-124)
- Work-spec: [WS-128](../work-specs/WS-128-live-e2e-readiness.md)

## Outcome

`planning-flow.spec.ts` and `live-board.spec.ts`'s delete test stop failing now and then,
because each starts its check only once the page is in the state the check is about, and
no timeout is raised and no retry added.

The investigation (WS-128 section 1) found no missed event and no app defect:

- **`planning-flow.spec.ts:101`.** The test clicks "Move to board" before the backlog has
  shown the change just saved in the second tab. The backlog sends the version it holds
  (1), the server holds 2, and the move answers `409 version_conflict`, as designed
  (WS-109): the backlog reloads, keeps the task and says "Someone else changed …". Seen in
  all 6 failures of 15 runs under load.
- **`live-board.spec.ts:153`.** The test starts its 2 s wait for the other board when it
  clicks "Delete", not when the delete is saved. Under load the `DELETE` itself took 1.4 s
  to more than 2 s. Once the test waits for its answer, the other board drops the card
  0.1 to 0.9 s later in 15 of 15 runs.

## Acceptance criteria

- [x] `planning-flow.spec.ts` clicks "Move to board" only once the open backlog shows the
      change saved in the task detail (the row's "Priority: High"), and that move answers
      `200`.
- [x] `live-board.spec.ts`, "a deleted task disappears from the other board…", starts its
      2 s check on the other board once the `DELETE` has answered `204`, as the move test
      starts its own once `/move` has answered.
- [x] Each fix is shown red first by a deterministic reproduction: with the matching
      request delayed by `page.route` (not committed), the test as it is fails at the line
      of the follow-up, and the changed test passes with the same delay.
- [x] No timeout is raised and no retry is added; the application code does not change.
- [x] Under load (`--repeat-each=15` of `live-board.spec.ts`, `planning-flow.spec.ts` and
      `backlog.spec.ts`, at the configured 4 workers), neither of the two checks fails; the
      counts are recorded in WS-128.
- [x] The quality gate passes.

## Notes

- The evidence, the deterministic reproductions and the owner's questions are in WS-128.
- Out of scope: the restore step of the same delete test under heavier load than the
  configured 4 workers (WS-128 question 1), the board's slow first load after a reload (its
  own follow-up), and accessibility.
