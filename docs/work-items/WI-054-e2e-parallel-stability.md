# WI-054 — A keyboard move lands where it was announced, and the suite is stable in parallel

- Status: Proposed
- Work-track: none: the follow-up of WI-052 (audit of 2026-11-17, finding A09)
- Depends on: WI-052 (its branch is stacked on `claude/wi-052-e2e-isolation`, for the
  docs index and `playwright.config.ts`)
- Work-spec: [WS-054](../work-specs/WS-054-e2e-parallel-stability.md)

## Outcome

WS-052 ("Deviations") recorded end-to-end tests that fail when the suite runs in
parallel on a 12-core Windows machine, and one Vitest test that times out under load. The
investigation in WS-054 found two different causes:

1. **A real bug on the board.** When a card is carried by keyboard into a column that
   holds exactly one card, the board first announces "position 2 of 2" and, about 40 ms
   later and with no key pressed, "position 1 of 2". The drop goes to the second place.
   The end-to-end test presses Space within those 40 ms, so it passes when the machine is
   idle and fails when it is busy. A person pressing Space always gets position 1, after
   hearing a place that was not kept.
2. **Load on the machine.** The other failures are 30 s test timeouts and 5 s `expect`
   timeouts while pages wait for their JavaScript, which the single `next start` process
   serves slowly when six browsers load it at once on a busy host. CI (2 workers) has not
   failed or retried any of them in 40 runs.

After this item the place announced during a keyboard drag is the place the card is
dropped in, the keyboard test checks that the announcement does not change by itself,
and the suite and the quality gate pass locally without depending on how busy the
machine is.

## Acceptance criteria

- [ ] During a keyboard drag, the board's drop target does not change unless a key is
      pressed: no announcement of a new place follows a move by itself.
- [ ] A card carried by keyboard into a column that has cards lands at the top of that
      column (position 1), as announced; one more arrow key down moves it below the
      first card.
- [ ] Pointer drags (mouse and touch) behave as before (the existing board tests pass
      unchanged).
- [ ] The keyboard end-to-end test fails on today's board (the announcement changes by
      itself) and passes after the fix, also in 20 repeats with 6 workers.
- [ ] The projects-pages accessibility check is split so that no single test does a whole
      tour of pages; every page and dialog it checks today is still checked.
- [ ] Local end-to-end runs use at most 4 workers; CI keeps its default.
- [ ] `routes.test.ts` loads the route modules once, with a time limit for that loading,
      not for each assertion.
- [ ] Three full end-to-end runs with `--retries=0` pass on the same 12-core machine, and
      the quality gate passes.

## Notes

The investigation, measurements and the trace that shows the cause are in WS-054,
"Investigation". The static-asset slowness of `next start` under parallel load is noted
there and not changed by this item.
