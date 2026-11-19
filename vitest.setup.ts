import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

import { FakeSource } from "@/hooks/fake-event-source";
import { loadEnvFiles } from "@/server/env-files";

// The committed .env.test, as the integration tests load it: every API response reads
// APP_URL (WS-067), and nothing here connects to the database it names.
loadEnvFiles();

afterEach(() => {
  cleanup();
});

// jsdom has no EventSource; every project page opens one (WS-049). Each test starts with a
// fake whose sources stay closed until the test opens them, or set `FakeSource.autoOpen`.
beforeEach(() => {
  FakeSource.all = [];
  FakeSource.autoOpen = false;
  vi.stubGlobal("EventSource", FakeSource);
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
