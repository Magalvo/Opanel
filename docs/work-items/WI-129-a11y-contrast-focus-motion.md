# WI-129 — Destructive contrast, settings dialog focus, still skeletons

- Status: Done (approved by the owner on 2026-11-25, with WS-129 and the recommended answers
  to its open questions; done on 2026-11-25)
- Work-track: none: three accessibility follow-ups of `docs/README.md`, scheduled after the
  independent audit of 2026-11-24
- Depends on: none
- Work-spec: [WS-129](../work-specs/WS-129-a11y-contrast-focus-motion.md)

## Outcome

Three accessibility defects that every page shares are gone:

1. **Destructive actions are readable.** The shared `destructive` style of buttons, menu
   items and badges has at least the 4.5:1 contrast of WCAG AA (1.4.3) in light and dark
   mode, at rest and on hover or focus. Today its red text on a pale red background is
   3.99:1 in light mode (3.31:1 on hover) and 3.83:1 on hover in dark mode. The pages that
   used the `outline` style instead to avoid it ("Disable agent", "Delete team", "Archive
   project") use `destructive` again.
2. **Closing a project settings dialog puts the keyboard back where it was.** The Add and
   Edit column dialogs, the Add and Edit label dialogs, and the confirmations to delete a
   column, delete a label and archive the project return the focus to the button that
   opened them (WCAG 2.4.3 Focus Order). Today they open without a `DialogTrigger`, so on
   close Radix moves the focus to the page body and a keyboard user starts again from the
   top of the page.
3. **Loading skeletons respect reduced motion.** With `prefers-reduced-motion: reduce`, the
   shadcn/ui `Skeleton` that every page shows while loading does not pulse (WCAG 2.3.3).
   Without that preference it pulses as today.

## Acceptance criteria

Destructive contrast:

- [x] In light and in dark mode, a `destructive` button, a focused `destructive` menu item
      and a `destructive` badge have text contrast of at least 4.5:1 against their own
      background, at rest and on hover (button) or focus (menu item).
- [x] axe (WCAG 2.2 AA tags) reports no violation, in both themes, on: the People page
      with a person's menu open on "Deactivate", and its confirmation; a team's page and
      its "Delete team" confirmation; an agent's page and its "Disable agent" confirmation;
      the project settings with the "Delete column" confirmation open, and the details with
      "Archive project". The same checks pass with the pointer over each destructive
      button.
- [x] "Disable agent", "Delete team" and "Archive project" use the `destructive` style; the
      comments that explained the workaround are gone.

Settings dialog focus:

- [x] Closing the Add column or Add label dialog (Escape, the close button, or after a save)
      puts the focus on the "Add column" or "Add label" button.
- [x] Closing the Edit dialog of a column or label, in any of those ways, puts the focus on
      that row's "Edit …" button.
- [x] Cancelling the delete confirmation of a column or label puts the focus on that row's
      "Delete …" button; confirming it puts the focus on the section's "Add column" or
      "Add label" button, since the row goes away.
- [x] Cancelling "Archive project" puts the focus back on it; confirming it puts the focus
      on "Unarchive project" once the project is archived, and "Unarchive project" puts the
      focus on "Archive project" once it is unarchived.

Reduced motion:

- [x] With `prefers-reduced-motion: reduce`, a loading skeleton runs no animation; without
      it, the skeleton pulses as before.

## Notes

- Found by axe in WI-035 (contrast), in a browser while checking WI-037 (focus), and in the
  board UI review of 2026-11-23 (WI-111, the skeleton).
- The same focus gap exists outside the project settings; WS-129 lists those dialogs and
  asks whether they belong here (open question 2).
