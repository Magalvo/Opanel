# WS-129 — Destructive contrast, settings dialog focus, still skeletons

- Status: Done (approved by the owner on 2026-11-25, with the recommended answers to its open
  questions; done on 2026-11-25)
- Work-item: [WI-129](../work-items/WI-129-a11y-contrast-focus-motion.md)
- Canonical docs: none changes. Earlier specs this follows: WS-035 and WS-077 deviation 2
  (the contrast workaround), WS-037 "Deviations" (the board's "Add task" dialog returns the
  focus to its opener), WS-111 section 3 and decision 4 (reduced motion removes motion, not
  shortens it)

## Approach

Installed versions read for this spec (`AGENTS.md` rule 13): Tailwind CSS 4.3.5 (its
`motion-safe` variant is `@media (prefers-reduced-motion: no-preference)`, and
`--animate-pulse` is defined in `tailwindcss/theme.css`), `radix-ui` 1.8.1 with
`@radix-ui/react-dialog` 1.3.1 (`DialogContent`'s `onCloseAutoFocus` handler runs before
Radix's own; Radix's own calls `preventDefault()` and focuses the trigger, so with no
trigger the focus lands on the body), and `tw-animate-css` 1.4.0.

### 1. Destructive contrast

Measured with the theme's tokens (oklch converted to sRGB, the tint composited over the
dialog's `--popover`, WCAG relative luminance):

| Style, state                        | Light now | Dark now | Light after | Dark after |
| ----------------------------------- | --------- | -------- | ----------- | ---------- |
| Button at rest (`/10`, dark `/20`)  | 3.99      | 4.63     | 7.01        | 6.97       |
| Button on hover (`/20`, dark `/30`) | 3.31      | 3.83     | 5.82        | 5.77       |

On the page background (`--background`) instead of a dialog, every "after" value is
higher. The focused menu item uses the same tints as the button at rest, the badge the
same as the button at rest.

The backgrounds stay as they are; only the text gets darker in light mode and lighter in
dark mode. A new theme token in `src/app/globals.css`:

- `--destructive-strong`: light `oklch(0.444 0.177 26.899)` (Tailwind's red-800), dark
  `oklch(0.808 0.114 19.571)` (red-300), exposed to Tailwind as
  `--color-destructive-strong` in `@theme inline`.

The `destructive` style of `Button`, of `DropdownMenuItem` (its text and its icon) and of
`Badge` uses `text-destructive-strong` instead of `text-destructive`. `--destructive`
itself is unchanged, so error messages, invalid-field borders and the focus rings keep
their colour; red error text on the page background is already 4.76:1 in light mode.

Then the three workarounds go back to `destructive` and lose their comments: "Disable
agent" (`agent-detail.tsx`; "Re-enable agent" stays `outline`, it is not destructive),
"Delete team" (`team-page.tsx`) and "Archive project" (`details-section.tsx`;
"Unarchive project" stays `outline`). The task card's severity badge (WS-091, deviation 1)
is left as it is: see open question 3.

### 2. Settings dialog focus

The pattern of WS-037: whoever opens a dialog keeps the element that opened it, and the
dialog's content returns the focus there in `onCloseAutoFocus` (calling
`event.preventDefault()` first, so Radix does not move it to the body). A `DialogTrigger`
is not used: each row's Edit and Delete buttons open one shared dialog for that row, and
`ColumnDialog` and `LabelDialog` are mounted only while open, which is what keeps their
form state fresh for each row.

- `ColumnDialog` and `LabelDialog` take a new prop `returnFocusTo: () => HTMLElement | null`
  and call it from `onCloseAutoFocus`. A function rather than an element, because the
  element to focus may only be known at close (below).
- `ColumnsSection` and `LabelsSection` keep the opener with what is open, as `board.tsx`
  does: `adding: HTMLButtonElement | null`, `editing: { column, opener } | null`,
  `deleting: { column, opener } | null` (and the same with `label`). The buttons pass
  `event.currentTarget`. A ref holds the section's "Add column" or "Add label" button.
- Where the focus goes on close:
  - Add dialog: the Add button.
  - Edit dialog: the row's Edit button (rows are keyed by id, so it is the same element
    after the list is read again). If it is no longer in the document (the column or label
    was deleted meanwhile by someone else), the Add button.
  - Delete confirmation (`AlertDialogContent`'s `onCloseAutoFocus`): on Cancel or Escape,
    the row's Delete button; on Delete, the Add button, because the row goes away. If the
    delete is refused (a column that is not empty), the row stays and the focus is still on
    the Add button; the status region says why, as today.
- `DetailsSection`: the archive confirmation returns the focus to "Archive project" on
  Cancel. Confirming it, and clicking "Unarchive project", replace the button with the
  other one, which would drop the focus to the body. After a successful archive or
  unarchive, the section focuses the button that replaced the one used (a ref on each and
  an effect on the archived state, only when the change came from this page, not from a
  live update of someone else). If it fails, the focus stays where it is.

The New project dialog, the Triage and Deleted tasks sections already have a trigger or no
dialog, and are unchanged. The same gap outside the project settings is open question 2.

### 3. Reduced motion for skeletons

`Skeleton` uses `motion-safe:animate-pulse` instead of `animate-pulse`. With reduced motion
it is a still grey block; without, it pulses as today.

This follows WS-111's decision 4 (the motion is removed, not shortened), but not its hook:
`useReducedMotion` exists because dnd-kit animates through inline styles that only
JavaScript can turn off. The skeleton's animation is CSS, so a media query turns it off
without JavaScript, from the first paint, and `Skeleton` stays usable without
`"use client"`.

## Files

| Path                                                | Change                                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/app/globals.css`                               | modify: `--destructive-strong` in both themes, `--color-destructive-strong`   |
| `src/components/ui/button.tsx`                      | modify: `destructive` text uses `text-destructive-strong`                     |
| `src/components/ui/dropdown-menu.tsx`               | modify: `destructive` item text and icon use `text-destructive-strong`        |
| `src/components/ui/badge.tsx`                       | modify: `destructive` text uses `text-destructive-strong`                     |
| `src/components/ui/skeleton.tsx`                    | modify: `motion-safe:animate-pulse`                                           |
| `src/components/ui/skeleton.test.tsx`               | create: test 1                                                                |
| `src/components/agents/agent-detail.tsx`            | modify: "Disable agent" is `destructive`                                      |
| `src/components/teams/team-page.tsx`                | modify: "Delete team" is `destructive`                                        |
| `src/components/projects/details-section.tsx`       | modify: "Archive project" is `destructive`; focus after archive and unarchive |
| `src/components/projects/column-dialog.tsx`         | modify: `returnFocusTo`, `onCloseAutoFocus`                                   |
| `src/components/projects/columns-section.tsx`       | modify: keep the openers; focus on close of each dialog                       |
| `src/components/projects/labels-section.tsx`        | modify: the same for labels, and `LabelDialog` takes `returnFocusTo`          |
| `src/components/projects/project-settings.test.tsx` | modify: tests 2 to 6                                                          |
| `tests/e2e/accessibility.spec.ts`                   | modify: tests 7 and 8                                                         |
| `tests/e2e/projects.spec.ts`                        | modify: test 9                                                                |

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                                                                                                                                                                                                                                                                                                                          | Covers criterion                  |
| --- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | unit  | `skeleton.test.tsx`: the skeleton's classes include `motion-safe:animate-pulse` and no bare `animate-pulse`; a `className` passed in is kept                                                                                                                                                                                                                                                                                  | reduced motion                    |
| 2   | unit  | `project-settings.test.tsx`, columns: Add column closed by Escape, and after a save, leaves the focus on "Add column"; Edit closed by Escape, and after a save, leaves it on that row's "Edit …" button                                                                                                                                                                                                                       | Add and Edit focus                |
| 3   | unit  | columns: cancelling "Delete …" leaves the focus on that row's Delete button; confirming it leaves it on "Add column"                                                                                                                                                                                                                                                                                                          | delete focus                      |
| 4   | unit  | labels: tests 2 and 3 for "Add label", "Edit …" and "Delete …"                                                                                                                                                                                                                                                                                                                                                                | Add, Edit and delete focus        |
| 5   | unit  | columns: an Edit dialog whose column was deleted by someone else meanwhile (a `column.changed` reload without it) leaves the focus on "Add column" when closed                                                                                                                                                                                                                                                                | Edit focus, fallback              |
| 6   | unit  | details: cancelling "Archive project" leaves the focus on it; confirming it focuses "Unarchive project"; "Unarchive project" focuses "Archive project"; a failed archive leaves the focus where it was                                                                                                                                                                                                                        | archive focus                     |
| 7   | e2e   | `accessibility.spec.ts`, in light and dark mode: axe finds no violation on the People page with a person's menu open on "Deactivate" (focused) and in its confirmation; a team's page and its "Delete team" confirmation; an agent's page and its "Disable agent" confirmation; the project settings with "Delete column" open and the details with "Archive project"; each destructive button is checked again while hovered | destructive contrast, workarounds |
| 8   | e2e   | `accessibility.spec.ts`: with the teams list held back by `page.route`, a skeleton is shown; with `reducedMotion: "reduce"` its computed `animation-name` is `none` and `document.getAnimations()` has none for it; with `"no-preference"` its `animation-name` is `pulse`                                                                                                                                                    | reduced motion                    |
| 9   | e2e   | `projects.spec.ts`: with the keyboard only, open Add column, press Escape, and the focused element is "Add column"; open a row's Edit, save, and the focus is on that row's Edit button; open Delete on a new empty column, confirm, and the focus is on "Add column"                                                                                                                                                         | settings focus in a browser       |

Test 7 runs red first on `main`'s styles: with the old classes the People and dialog
checks report `color-contrast` in light mode. The contrast table above is the arithmetic
behind the colour choice; axe is its test.

## Risks and open questions

1. **A new token, or a darker `--destructive`?** Recommended: the new token
   `--destructive-strong`, used only by the three destructive styles. Darkening
   `--destructive` itself in light mode, and lightening it in dark mode, would also pass,
   but would change every error message, invalid-field border and focus ring for no
   accessibility gain, since those already pass.
2. **The same focus gap outside the project settings.** Dialogs opened without a trigger
   and with no `onCloseAutoFocus`: the People page's confirmations and its link dialog
   (`people-page.tsx`, `link-dialog.tsx`, opened from a row's menu item), a team's "Delete
   team" confirmation (`team-page.tsx`), and an agent's "Disable agent" confirmation
   (`agent-detail.tsx`). The task dialog (`task-dialog.tsx`) is route-driven and different.
   Recommended: a separate follow-up and work-item, not this one. The follow-up asked for
   the settings dialogs; the People ones open from a menu that has closed by then, so where
   the focus goes needs its own decision (the row's menu button), and keeping this item to
   the settings keeps its diff to the pages it names.
3. **The task card's severity badge** (WS-091, deviation 1) uses an `outline` badge with
   red text instead of the `destructive` badge, for contrast. After this change the
   `destructive` badge would pass too. Recommended: leave the card as it is: it passes
   (4.76:1), it is a visual choice for cards as much as a workaround, and changing the
   card's look is outside these follow-ups. Only its comment changes, to say the
   `destructive` badge now passes too but the outline is kept for the card's look.
4. **One item or three?** The three share no code. Recommended: keep them one item as
   asked: each is small (the skeleton is one class), they share one accessibility test
   run, and the review is one pass over shared UI. If the owner prefers, the focus part
   (the largest) can become its own item and the other two stay here.
5. **Dialog open and close animations ignore reduced motion too.** `tw-animate-css` 1.4.0
   has no `prefers-reduced-motion` rule, so every dialog's fade and zoom (100 ms) runs
   with reduced motion. Found while writing this spec; not one of the three follow-ups.
   Recommended: record it as a follow-up, not fix it here.
6. **The hover check.** axe only sees the state the page is in, so test 7 hovers each
   destructive button with Playwright before running axe again. A focused menu item is
   checked the same way. Pressed (`:active`) is not checked; its colours are the hover
   ones.

## Deviations from the approved spec

1. **The People menu is checked by axe on the menu alone** (test 7). While a Radix menu is
   open, the page behind it is `aria-hidden` and keeps focusable elements, which axe reports
   as `aria-hidden-focus` in both themes, whatever the colours. The colour check of the
   focused "Deactivate" item is unchanged; the rest of each step checks the whole page.
2. **The opener is kept in one ref per section, not in state with what is open.** One
   dialog is open at a time, and Radix asks for the focus target while the dialog unmounts,
   when a ref is simplest to read. A confirmed delete sets the ref to the Add button.
3. **The archive confirmation returns the focus to whichever of the two buttons is
   mounted**, so that an archive answered before the dialog finished closing still lands on
   "Unarchive project". Cancelling lands on "Archive project", as the spec says.

## Implementation record

- Red (2026-11-25): the eight unit tests of the focus (tests 2 to 6) failed with the focus
  on the body, and test 1 on the bare `animate-pulse`. In the browser, test 7 failed in light
  mode on `color-contrast` (with `aria-hidden-focus`, deviation 1), and in dark mode on
  `aria-hidden-focus`; test 8 found `pulse` running with reduced motion; test 9 found the
  focus not back on "Add column" after Escape.
- Green: sections 1 to 3 as specified, with deviations 1 to 3. The task card's comment
  says the `destructive` badge now passes too (question 3).
- Gate on the branch:
  - `pnpm check` passed (typecheck, lint, format:check);
  - `pnpm test` 2422 of 2422 (230 files);
  - `pnpm test:e2e` 127 of 128 with `--retries=0`. The failure was
    `mcp/e2e/write-tools.spec.ts` (WS-104), outside this item: the task history came back
    as `field_changed`, `created` instead of `created`, `field_changed`. Alone with
    `--repeat-each=10` it passed 10 of 10. Recorded as a follow-up.
  - Windows, Node 24, pnpm 10.28.0, Compose PostgreSQL on port 5433.
- Follow-ups recorded on `main`: the same focus gap outside the project settings (question
  2), the dialog animations under reduced motion (question 5), and the ordering of the MCP
  write-tools history check.
