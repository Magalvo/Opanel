// How the board measures its drop targets for `@dnd-kit` (WS-098). Kept apart from the
// component so that the rounding can be tested with plain rectangles.
import { type ClientRect, getClientRect } from "@dnd-kit/core";

/** Browsers lay pages out in 1/64 px units, so an exact measurement is a multiple of it. */
const UNITS_PER_PX = 64;

function snap(value: number): number {
  return Math.round(value * UNITS_PER_PX) / UNITS_PER_PX;
}

/**
 * `rect` rounded to whole layout units. A card measured while it slides into place comes
 * out a fraction off (239.99996 for 240), and `@dnd-kit`'s keyboard moves compare positions
 * exactly, so an arrow key could then land on the card's own place (WS-098).
 */
export function snapRect(rect: ClientRect): ClientRect {
  const left = snap(rect.left);
  const top = snap(rect.top);
  const width = snap(rect.width);
  const height = snap(rect.height);
  return { left, top, width, height, right: left + width, bottom: top + height };
}

/** A drop target's rect without its transform, as `@dnd-kit` measures it, rounded. */
export function measureDroppable(element: HTMLElement): ClientRect {
  return snapRect(getClientRect(element, { ignoreTransform: true }));
}
