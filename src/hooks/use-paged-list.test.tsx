import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Page } from "@/lib/paged-list";

import { usePagedList } from "./use-paged-list";

interface Item {
  id: string;
}

const item = (id: string): Item => ({ id });

/** A read whose answer the test releases. */
function held() {
  let resolve: (page: Page<Item>) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const read = vi.fn(
    () =>
      new Promise<Page<Item>>((res, rej) => {
        resolve = res;
        reject = rej;
      }),
  );
  return {
    read,
    resolve: (page: Page<Item>) => {
      resolve(page);
    },
    reject: (error: unknown) => {
      reject(error);
    },
  };
}

function render(initial?: Page<Item>) {
  return renderHook(() => usePagedList<Item>(initial));
}

describe("usePagedList (WS-080 section 2)", () => {
  it("starts from the initial page, or empty", () => {
    expect(render().result.current.items).toEqual([]);
    const { result } = render({ items: [item("a")], nextCursor: "c1" });
    expect(result.current.items).toEqual([item("a")]);
    expect(result.current.nextCursor).toBe("c1");
  });

  it("calls read once for two loadMore calls in the same tick, and is loadingMore meanwhile", async () => {
    const { result } = render({ items: [item("a")], nextCursor: "c1" });
    const page = held();

    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.loadMore(page.read);
      void result.current.loadMore(page.read);
    });

    expect(page.read).toHaveBeenCalledTimes(1);
    expect(page.read).toHaveBeenCalledWith("c1");
    expect(result.current.loadingMore).toBe(true);

    await act(async () => {
      page.resolve({ items: [item("b")], nextCursor: null });
      await first;
    });

    expect(result.current.items).toEqual([item("a"), item("b")]);
    expect(result.current.nextCursor).toBeNull();
    expect(result.current.loadingMore).toBe(false);
  });

  it("asks for nothing when there is no next page", async () => {
    const { result } = render({ items: [item("a")], nextCursor: null });
    const read = vi.fn();

    await act(async () => {
      await result.current.loadMore(read);
    });

    expect(read).not.toHaveBeenCalled();
  });

  it("shows an item that comes back with a later page once, where the server puts it", async () => {
    const { result } = render({ items: [item("a"), item("b")], nextCursor: "c1" });

    await act(async () => {
      await result.current.loadMore(() =>
        Promise.resolve({ items: [item("b"), item("c")], nextCursor: null }),
      );
    });

    expect(result.current.items).toEqual([item("a"), item("b"), item("c")]);
  });

  it.each(["show", "invalidate"] as const)("drops a page that arrives after %s", async (change) => {
    const { result } = render({ items: [item("a")], nextCursor: "c1" });
    const page = held();

    let loading: Promise<void> = Promise.resolve();
    act(() => {
      loading = result.current.loadMore(page.read);
    });
    act(() => {
      if (change === "show") result.current.show({ items: [item("x")], nextCursor: "c9" });
      else result.current.invalidate();
    });
    await act(async () => {
      page.resolve({ items: [item("stale")], nextCursor: null });
      await loading;
    });

    expect(result.current.items).not.toContainEqual(item("stale"));
    expect(result.current.loadingMore).toBe(false);
    if (change === "show") {
      expect(result.current.items).toEqual([item("x")]);
      expect(result.current.nextCursor).toBe("c9");
    }
  });

  it("swallows the failure of a page that is no longer wanted", async () => {
    const { result } = render({ items: [item("a")], nextCursor: "c1" });
    const page = held();

    let loading: Promise<void> = Promise.resolve();
    act(() => {
      loading = result.current.loadMore(page.read);
    });
    act(() => {
      result.current.invalidate();
    });
    await act(async () => {
      page.reject(new Error("offline"));
      await loading;
    });

    expect(result.current.loadingMore).toBe(false);
  });

  it("rethrows the failure of a page that is still wanted, and keeps the list", async () => {
    const { result } = render({ items: [item("a")], nextCursor: "c1" });

    await act(async () => {
      await expect(
        result.current.loadMore(() => Promise.reject(new Error("offline"))),
      ).rejects.toThrow("offline");
    });

    expect(result.current.items).toEqual([item("a")]);
    expect(result.current.nextCursor).toBe("c1");
    expect(result.current.loadingMore).toBe(false);
  });

  it("is not fully loaded before a first page, and reads a show of the same handler", () => {
    const { result } = render();

    expect(result.current.isFullyLoaded()).toBe(false);

    let seen: boolean[] = [];
    act(() => {
      result.current.show({ items: [], nextCursor: "c1" });
      const first = result.current.isFullyLoaded();
      result.current.show({ items: [], nextCursor: null });
      seen = [first, result.current.isFullyLoaded()];
    });

    expect(seen).toEqual([false, true]);
  });

  it("adds an item unless its id is shown", () => {
    const { result } = render({ items: [item("a")], nextCursor: null });

    act(() => {
      result.current.add(item("b"));
      result.current.add(item("a"));
    });

    expect(result.current.items).toEqual([item("a"), item("b")]);
  });

  it("updates the items with a function of the current ones", () => {
    const { result } = render({ items: [item("a"), item("b")], nextCursor: null });

    act(() => {
      result.current.update((items) => items.filter((one) => one.id !== "a"));
    });

    expect(result.current.items).toEqual([item("b")]);
  });
});
