# WS-111 — Board moves without dragging, and drags respect reduced motion

- Status: Done (approved by the owner on 2026-11-23, questions 1 to 5 as recommended)
- Work-item: [WI-111](../work-items/WI-111-board-drag-accessibility.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) section 5 (any task moves
  to any column); [WS-037](WS-037-board-page.md) sections 5 and 6 (drag and drop, the
  status region); [WS-038](WS-038-task-detail.md) section 4 (the drag handle and its
  label); [WS-082](WS-082-board-reload-ordering.md) (moves and reloads);
  [WS-098](WS-098-keyboard-move-subpixel.md) (measuring while cards slide)

## Approach

### 1. A move menu on each card (WCAG 2.5.7)

A writable card (`SortableCard`) gets a menu button between its key and its drag handle:
an icon button (`EllipsisIcon`, `size-7`, 28 px, the handle's size and over WCAG 2.2's
24 px minimum) with `aria-label="Actions for OPA-12"` and `data-card-menu={task.id}`. It
opens a `DropdownMenu` (the shadcn/ui component already in `src/components/ui/`, used by
the account menu):

```
Move to top
Move up
Move down
Move to bottom
──────────────
Move to
  In progress
  Done
```

- "Move to" is a `DropdownMenuLabel` followed by one item per other column, in board order
  (question 2 on why not a submenu). The card's own column is left out.
- Items that would not change the place are `disabled`: "Move to top" and "Move up" on the
  first card, "Move down" and "Move to bottom" on the last. A column's only card has all
  four disabled.
- The button is `disabled` while a move is saved (`moving`, as the drag is today), and is
  not rendered on `StaticCard` (Viewer, archived project).

Why a menu and not visible "Move up" and "Move down" buttons on every card: a menu keeps
cards as compact as today, adds one 28 px target instead of two or more, and also covers
"to another column" and "to the top" in the same place (question 1).

**Interplay with the drag.** The card's pointer and touch listeners are on the whole card.
Radix's trigger opens on `pointerdown` and calls `preventDefault()`, which suppresses the
mouse events `MouseSensor` listens to, so a click on the button is never a drag. The
keyboard sensor starts only when the key event's target is the activator node, the handle
(checked in `@dnd-kit/core` 6.3.1, `core.esm.js` line 1360), so Enter or Space on the menu
button opens the menu and does not pick the card up. Both are covered by tests (8, 13).

### 2. What a menu move does

A pure function in `src/components/board/moves.ts` computes the menu from the board:

```ts
type MenuMove = { label: string; columnId: string; index: number; disabled: boolean };
export function menuMoves(board: Board, columns: readonly Column[], taskId: string): MenuMove[];
```

It returns the four in-column moves (top: index 0; up: index − 1; down: index + 1;
bottom: the column's last index) and one move per other column, at that column's length,
which `applyDrop` places at the end. That is where the task detail's column select and a
drop on a column's empty space put a card too.

`board.tsx` passes an `onMove(taskId, columnId, index)` down through `SortableColumn` to
each card. It:

1. computes the result with `applyDrop` and the announcement with the existing
   `positionText`, as `onDragEnd` does;
2. calls the existing `drop(taskId, columnId, index)` of `useBoard`, so a menu move is
   optimistic, holds live events, is saved by `POST /api/v1/tasks/{id}/move` and reloads
   the board on any failure exactly as a drag does (WS-037 section 5, WS-082);
3. says "OPA-12 was moved to In progress, position 2 of 5." in the board's status region
   (`setMessage`), the wording of the keyboard drop. A failure replaces it with the
   message `useBoard` already gives ("Someone else changed OPA-12. The board was
   refreshed.", and the others).

**Focus.** Radix gives the focus back to the trigger when the menu closes. Within one
column the card stays mounted and that is enough. A move to another column mounts the card
anew, so the menu's `onCloseAutoFocus` is prevented and the board focuses
`[data-card-menu="<id>"]` in the next animation frame, as `keepFocus` does for a keyboard
drag today.

### 3. Reduced motion

A new hook, `src/hooks/use-reduced-motion.ts`, follows `use-mobile.ts`:
`useSyncExternalStore` over `matchMedia("(prefers-reduced-motion: reduce)")`, `false` on
the server.

When it is `true`:

- `useSortable({ id, disabled, transition: null })` in `SortableCard`. `@dnd-kit/sortable`
  10.0.0 then sets no CSS transition on cards, so the cards that make room for a dragged
  card jump to their places instead of sliding.
- `<DragOverlay dropAnimation={null}>` in `board.tsx`, so the dragged card does not
  animate (Web Animations API) to where it lands.

When it is `false`, both keep today's defaults. The dragged card still follows the pointer
in both cases: that movement is the user's own and is not an animation.

A CSS rule alone cannot do this: the drop animation is started from JavaScript, and
`@dnd-kit` sets transitions as inline styles.

WS-098's rounding stays useful with reduced motion: it costs nothing and covers any other
mid-layout measurement.

### 4. Out of scope (follow-ups)

From the same review, recorded as follow-ups by an index commit when this item is done:

- The board's horizontal scrollbar is below the longest column, often off screen. Columns
  could scroll on their own inside a board sized to the window.
- Nothing shows that dragging is paused while a move saves (the grab cursor stays).
- At phone width, scroll snapping (`snap-x`) would land on whole columns.
- The column header's category badge often repeats the column name and pushes the count
  onto a second line.
- The loading skeleton's `animate-pulse` also ignores reduced motion. It is outside the
  board's drag and drop, and the same shadcn/ui `Skeleton` is used on every page.

Moving a card to the backlog from the menu is also out of scope: the task detail does it
(WS-101), and `drop` only places cards on the board (question 3).

## Files

| Path                                    | Change                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/hooks/use-reduced-motion.ts`       | create: `useReducedMotion()`                                                         |
| `src/hooks/use-reduced-motion.test.tsx` | create: unit tests of the hook                                                       |
| `src/components/board/moves.ts`         | modify: `menuMoves`                                                                  |
| `src/components/board/moves.test.ts`    | modify: tests of `menuMoves`                                                         |
| `src/components/board/card-menu.tsx`    | create: `CardMenu`, the button and its `DropdownMenu`                                |
| `src/components/board/task-card.tsx`    | modify: `SortableCard` renders `CardMenu`; `transition: null` with reduced motion    |
| `src/components/board/board-column.tsx` | modify: `SortableColumn` passes `columns`, `board` and `onMove` to its cards         |
| `src/components/board/board.tsx`        | modify: `onMove` (move, announce, focus); `dropAnimation={null}` with reduced motion |
| `src/components/board/board.test.tsx`   | modify: the menu and the reduced-motion tests below                                  |
| `tests/e2e/board.spec.ts`               | modify: two tests below                                                              |
| `docs/work-specs/WS-037-board-page.md`  | modify: one line in "Deviations" pointing here                                       |
| WI-111, WS-111                          | modify: statuses, implementation record                                              |

No dependency, no migration, no API change. `docs/README.md` changes only by index commits
on `main` (the follow-ups of section 4).

## Data model changes

None.

## API contract

None. A menu move uses `POST /api/v1/tasks/{id}/move` as a drag does.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                                                                                                        | Covers criterion           |
| --- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 1   | unit  | `moves.test.ts`: `menuMoves` for the first, a middle and the last card of a column, and a column's only card: indices and `disabled` as in section 2                                                        | disabled moves             |
| 2   | unit  | `moves.test.ts`: `menuMoves` offers every other column in board order at its length, never the card's own column; an unknown task gives no moves                                                            | menu items                 |
| 3   | unit  | `use-reduced-motion.test.tsx`: `true` when the media query matches, `false` when not, follows a `change` event                                                                                              | reduced motion             |
| 4   | unit  | `board.test.tsx`: a writable card has "Actions for OPA-12", which lists the four moves and the other columns, not its own                                                                                   | menu items                 |
| 5   | unit  | `board.test.tsx`: no menu button for a Viewer or on an archived project                                                                                                                                     | not for readers            |
| 6   | unit  | `board.test.tsx`: "Move down" places the card at once, sends the move request with `afterTaskId` of the card it passed, and announces the new place                                                         | move and announce          |
| 7   | unit  | `board.test.tsx`: "Move to" Done puts the card last in Done, sends `afterTaskId` of Done's last card, announces it, and focuses the card's menu button there                                                | other column, focus        |
| 8   | unit  | `board.test.tsx`: Enter on the menu button opens the menu and does not pick the card up (no "Picked up" announcement)                                                                                       | no drag from the menu      |
| 9   | unit  | `board.test.tsx`: a `409 version_conflict` from a menu move reloads the board and says "Someone else changed OPA-12. The board was refreshed."                                                              | same failure handling      |
| 10  | unit  | `board.test.tsx`: the menu button is disabled while a move is saved                                                                                                                                         | disabled while saving      |
| 11  | unit  | `board.test.tsx`: with reduced motion, a sortable card's inline style has no `transition` during a keyboard drag; without it, it has one                                                                    | reduced motion             |
| 12  | unit  | every existing `board.test.tsx`, `use-board.test.tsx`, `moves.test.ts`, `collision.test.ts` and `keyboard.test.ts` test passes unchanged                                                                    | unchanged                  |
| 13  | e2e   | `board.spec.ts`: a Member reorders and moves cards with the mouse through the menu only (no drag); the order survives a reload; the moves are announced                                                     | single-pointer alternative |
| 14  | e2e   | `board.spec.ts`: with `page.emulateMedia({ reducedMotion: "reduce" })`, a keyboard move of a card past another runs no animation (`document.getAnimations()` empty after each arrow key and after the drop) | reduced motion             |
| 15  | e2e   | every existing `board.spec.ts` and `live-board.spec.ts` test passes unchanged                                                                                                                               | unchanged                  |
| 16  | gate  | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                                                                                                     | gate                       |

Test 14 runs on Chromium, as the rest of the suite. `getAnimations()` lists CSS
transitions and Web Animations, so an empty list after each key shows that neither the
sliding cards nor the drop animated.

## Risks and open questions

For the owner:

1. **A menu, not always-visible buttons.** The guideline's own example is "Move up and
   Move down buttons beside the drag handle". Two or more extra buttons on every card make
   a board of many cards much busier, and do not cover other columns. One menu button
   covers all moves. **Recommend: the menu (section 1).**
2. **Other columns as plain items under a "Move to" label, not a submenu.** A submenu is
   harder to use by touch and by keyboard, and a board has few columns. A board with many
   columns would make the menu long. **Recommend: plain items.** If boards with more than
   about eight columns are common, a submenu is the alternative.
3. **No "Move to backlog" in the menu.** It is one more item and the task detail already
   does it. Adding it means teaching `drop` to remove a card from the board.
   **Recommend: leave it out of this item.**
4. **Reduced motion removes the drag animations, not shortens them.** WCAG and the
   guideline ask for non-essential motion to be removed when the person asks for it.
   **Recommend: remove (section 3).**
5. **The skeleton's pulse** (section 4) is left for a follow-up, since the shadcn/ui
   `Skeleton` is shared by every page. **Recommend: follow-up.**

Risk: `@dnd-kit` and Radix both listen for pointer events on the same card. Section 1 shows
why they do not conflict today. Tests 8 and 13 check it in jsdom and in a real browser, so
an upgrade of either library that changes this fails a test.

## Deviations from the approved spec

1. **Test 11 is not written.** jsdom has no layout, so `@dnd-kit` gives every card the
   same zero-duration `transform 0ms linear` while dragging, with or without
   `transition: null`. The unit test could not tell the two apart, so it could not fail
   first. The browser test 14 covers reduced motion instead, and it starts with a control
   run that does see the animations without the setting.
2. **A third animation, also turned off.** For keyboard drags `@dnd-kit` glides the drag
   overlay between positions with its own `transform 250ms ease` (`DragOverlay`'s
   `transition`, `core.esm.js` line 3637). Test 14 found it. With reduced motion the board
   passes `transition="none"`, along with `dropAnimation={null}`.
3. **The menu button is `aria-disabled` while a move is saved, not `disabled`.** A
   disabled button cannot take the focus, so the focus could not go back to the moved
   card's menu until the save ended (test 13 failed on it). As the drag handle already
   does, the button keeps the focus and says it is disabled, and its `pointerdown` and
   `keydown` are prevented, so it opens nothing. Test 10 checks `aria-disabled` and that
   neither a click nor Enter opens the menu.
4. **The menu leaves the focus to Radix when it closes without a move.** The spec said
   `onCloseAutoFocus` is prevented. It is, but only after a move is chosen. Closed with
   Escape or by a click outside, Radix gives the focus back to the button as usual.
5. **`SortableColumn` gets `movesOf(taskId)` and `onMove`, not `columns` and `board`.**
   The board computes each card's moves from the board as shown. Same result, and the
   column needs to know less.

## Implementation record

- Red: `moves.test.ts`, `use-reduced-motion.test.tsx` and `board.test.tsx` failed on the
  missing `menuMoves`, the missing hook and the missing menu button; `board.spec.ts`'s two
  new tests failed on the missing menu, and with reduced motion on 1 transition while
  dragging and 2 animations after the drop (commit `44ccdf8`).
- Green: `menuMoves` in `moves.ts`, `useReducedMotion` in `src/hooks/`, `CardMenu` in
  `card-menu.tsx`, wired through `task-card.tsx`, `board-column.tsx` and `board.tsx`
  (commit `d354aee`, with deviations 2 and 3).
- `board.spec.ts` and `live-board.spec.ts`: 17 of 17. The two new tests: 40 of 40 with
  `--repeat-each 20 --workers 2 --retries 0`.
- `typecheck` first failed on `<DragOverlay transition={undefined}>` under
  `exactOptionalPropertyTypes`; the reduced-motion props are now spread in only when they
  apply.
- Gate: `typecheck`, `lint`, `format:check` pass; `test` 2183 of 2183 (213 files);
  `test:e2e` 113 of 113.
- Run on Linux (cloud session) with Node 22 and pnpm 10.28.0, against a local PostgreSQL
  16 on port 5432 (Compose's credentials and databases; Docker was not available).
