import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useReducedMotion } from "./use-reduced-motion";

// The person's "reduce motion" setting (WS-111 section 3, test 3).

const QUERY = "(prefers-reduced-motion: reduce)";

/** A media query list whose `matches` the test changes, and which says so. */
function fakeQuery(initial: boolean) {
  const list = Object.assign(new EventTarget(), {
    matches: initial,
    media: QUERY,
    onchange: null,
  }) as MediaQueryList & { matches: boolean };
  vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    expect(query).toBe(QUERY);
    return list;
  });
  return {
    set(matches: boolean) {
      list.matches = matches;
      list.dispatchEvent(new Event("change"));
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useReducedMotion", () => {
  it("is true when the person asks for reduced motion", () => {
    fakeQuery(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("is false when they do not", () => {
    fakeQuery(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it("follows a change of the setting with the page open", () => {
    const query = fakeQuery(false);
    const { result } = renderHook(() => useReducedMotion());

    act(() => {
      query.set(true);
    });
    expect(result.current).toBe(true);

    act(() => {
      query.set(false);
    });
    expect(result.current).toBe(false);
  });
});
