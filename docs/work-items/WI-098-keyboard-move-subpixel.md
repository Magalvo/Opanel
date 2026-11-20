# WI-098 — A keyboard move works while the board is still animating

- Status: In progress
- Work-track: none: a defect found by CI (the keyboard test of `tests/e2e/board.spec.ts`
  failed in runs 44773683358 and 44783225994 on 2026-11-20)
- Depends on: none
- Work-spec: [WS-098](../work-specs/WS-098-keyboard-move-subpixel.md)

## Outcome

A person who moves a card with the keyboard gets one move per arrow key, also when they
press keys quickly, while the cards are still sliding into place after the previous move.
Today an arrow key pressed at the wrong moment does nothing, and the screen reader
announces nothing, though the card could still move. The end-to-end test "a Member moves a
card by keyboard only, and the drop is announced" fails on CI for the same reason, and passes
again on the next run.

The cause (WS-098, "Investigation"): a card measured while it is still sliding gets a
position off by a tiny fraction of a pixel (239.99996 instead of 240). The keyboard move
puts the dragged card there, and on the next arrow key `@dnd-kit` takes everything at 240,
including the card's own place, to be "below" it. The key then moves the card back to its
own place.

## Acceptance criteria

- [ ] Whenever the board measures a card or column for drag and drop, the result is a
      whole number of layout units (1/64 px), so a measurement taken while the card is
      sliding has no rounding error.
- [ ] ArrowDown from a place that was measured while sliding goes to the next card in the
      column, not back to the card's own place (unit test, with the measurement values seen
      on CI).
- [ ] Pointer and keyboard moves are otherwise unchanged: every existing `collision`,
      `board` and `board.spec.ts` test passes without changes.
- [ ] The keyboard test passes 50 of 50 with `--retries=0`, and 30 of 30 with the page's
      animations slowed down so that the previous drop is still animating when the next drag
      starts (the condition that reproduced the failure: 3 failures in 24 before the fix).
- [ ] The full quality gate passes.

## Notes

Found while investigating the CI failure of PR #94 (WI-096); the investigation and its
probes are recorded in WS-098. No API or data model change.
