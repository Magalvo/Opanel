import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useToday } from "./use-today";

// The viewer's today, shared by every card (WS-110 section 1, test 2). Times are built
// from local parts, so the test gives the same result in every time zone.

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 23, 23, 59));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useToday", () => {
  it("is the local date", () => {
    const { result } = renderHook(() => useToday());

    expect(result.current).toBe("2026-11-23");
  });

  it("turns at local midnight with the page open", () => {
    const { result } = renderHook(() => useToday());

    act(() => {
      vi.advanceTimersByTime(2 * 60 * 1000);
    });

    expect(result.current).toBe("2026-11-24");
  });

  it("reads the date again when the page becomes visible", () => {
    const { result } = renderHook(() => useToday());

    // A sleeping computer: the clock moved, the timer has not fired.
    vi.setSystemTime(new Date(2026, 10, 25, 9, 0));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(result.current).toBe("2026-11-25");
  });

  it("shares one timer between its users, and clears it when the last one leaves", () => {
    const before = vi.getTimerCount();
    const first = renderHook(() => useToday());
    const second = renderHook(() => useToday());

    expect(vi.getTimerCount()).toBe(before + 1);

    first.unmount();
    expect(vi.getTimerCount()).toBe(before + 1);
    second.unmount();
    expect(vi.getTimerCount()).toBe(before);
  });
});
