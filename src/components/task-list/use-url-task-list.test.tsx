import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The list view's filter and order in the URL (WS-130 section 2, test 3).

const replace = vi.fn();
let search = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/tasks",
  useSearchParams: () => new URLSearchParams(search),
}));

const { useUrlTaskList } = await import("./use-url-task-list");

const LABEL = "bbbb0000-0000-4000-8000-000000000001";

beforeEach(() => {
  replace.mockReset();
  search = "";
});

describe("useUrlTaskList (WS-130 test 3)", () => {
  it("reads the filter, the order and what it ignored from the URL", () => {
    search = "projectId=OPA&priority=high&sort=-priority&columnId=backlog";
    const { result } = renderHook(() => useUrlTaskList());

    expect(result.current.filter).toEqual({ projectId: ["OPA"], priority: ["high"] });
    expect(result.current.sort).toBe("-priority");
    expect(result.current.ignored).toEqual(["columnId"]);
  });

  it("names an unreadable sort among the ignored parameters", () => {
    search = "sort=status";
    const { result } = renderHook(() => useUrlTaskList());

    expect(result.current.sort).toBe("-updated");
    expect(result.current.ignored).toEqual(["sort"]);
  });

  it("writes one replace per change, filter and order together", () => {
    search = "sort=key";
    const { result } = renderHook(() => useUrlTaskList());

    act(() => {
      result.current.setFilter({ type: ["bug"] });
    });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenLastCalledWith("/tasks?type=bug&sort=key", { scroll: false });

    act(() => {
      result.current.setSort("-updated");
    });
    expect(replace).toHaveBeenCalledTimes(2);
    expect(replace).toHaveBeenLastCalledWith("/tasks?type=bug", { scroll: false });
    expect(result.current.sort).toBe("-updated");

    act(() => {
      result.current.setFilter({});
    });
    expect(replace).toHaveBeenLastCalledWith("/tasks", { scroll: false });
  });

  it("drops labels and epics when the projects change", () => {
    search = `projectId=OPA&labelId=${LABEL}&epicId=none&type=bug`;
    const { result } = renderHook(() => useUrlTaskList());

    act(() => {
      result.current.setFilter({ ...result.current.filter, projectId: ["OPS"] });
    });

    expect(result.current.filter).toEqual({ projectId: ["OPS"], type: ["bug"] });
    expect(replace).toHaveBeenLastCalledWith("/tasks?projectId=OPS&type=bug", { scroll: false });
  });

  it("keeps labels and epics while the projects stay", () => {
    search = `projectId=OPA&labelId=${LABEL}`;
    const { result } = renderHook(() => useUrlTaskList());

    act(() => {
      result.current.setFilter({ ...result.current.filter, epicId: ["none"] });
    });

    expect(result.current.filter).toEqual({
      projectId: ["OPA"],
      labelId: [LABEL],
      epicId: ["none"],
    });
  });
});
