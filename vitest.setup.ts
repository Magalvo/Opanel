import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// jsdom has no matchMedia; the sidebar uses it to detect narrow screens.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) =>
    Object.assign(new EventTarget(), {
      matches: false,
      media: query,
      onchange: null,
    }) as MediaQueryList;
}

// jsdom lacks the pointer-capture and scrolling APIs that Radix's Select calls when it
// opens (the Admin People page uses it). These do nothing, which is all the tests need.
function polyfill(target: object, name: string, value: unknown): void {
  if (!(name in target)) {
    Object.defineProperty(target, name, { value, configurable: true, writable: true });
  }
}

if (typeof window !== "undefined") {
  const noop = (): void => undefined;
  polyfill(window.HTMLElement.prototype, "hasPointerCapture", () => false);
  polyfill(window.HTMLElement.prototype, "setPointerCapture", noop);
  polyfill(window.HTMLElement.prototype, "releasePointerCapture", noop);
  polyfill(window.HTMLElement.prototype, "scrollIntoView", noop);
  polyfill(
    window,
    "ResizeObserver",
    class {
      observe = noop;
      unobserve = noop;
      disconnect = noop;
    },
  );
}
