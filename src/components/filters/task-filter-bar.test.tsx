import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installFetch, on } from "@/components/fake-api";
import { bugLabel, json, LABELS, page, PROJECT, opa, uiLabel } from "@/components/board/test-data";

import type { TaskFilter } from "./task-filter";

// The filter bar (WS-120 section 3, tests 3 and 4).

const { ProjectFrame } = await import("@/components/projects/project-frame");
const { TaskFilterBar } = await import("./task-filter-bar");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/projects/OPA",
}));

const ada = { id: "66666666-6666-4666-8666-666666666666", name: "Ada Lovelace", active: true };

function renderBar(filter: TaskFilter, onChange = vi.fn()) {
  on(PROJECT, json(opa));
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  render(
    <ProjectFrame projectKey="OPA" canManageProjects={false}>
      <TaskFilterBar
        filter={filter}
        onChange={onChange}
        people={[ada]}
        shown={12}
        total={140}
        ignored={[]}
      />
    </ProjectFrame>,
  );
  return { user, onChange };
}

beforeEach(() => {
  installFetch();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  on(LABELS, page([bugLabel, uiLabel]));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TaskFilterBar (WS-120 test 3)", () => {
  it("writes q once, 300 ms after typing stops", async () => {
    const { user, onChange } = renderBar({});
    const bar = await screen.findByRole("search", { name: "Filter tasks" });

    await user.type(within(bar).getByLabelText("Search tasks"), "login");
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ q: ["login"] });
  });

  it("writes a menu's value, and removes it again", async () => {
    const { user, onChange } = renderBar({ type: ["bug"] });

    await user.click(await screen.findByRole("button", { name: "Type" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Story" }));

    expect(onChange).toHaveBeenLastCalledWith({ type: ["bug", "story"] });
  });

  it("offers the project's labels in the Label menu", async () => {
    const { user, onChange } = renderBar({});

    await user.click(await screen.findByRole("button", { name: "Label" }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "UI" }));

    expect(onChange).toHaveBeenLastCalledWith({ labelId: [uiLabel.id] });
  });

  it("offers me, unassigned and the people on the page as assignees", async () => {
    const { user } = renderBar({});

    await user.click(await screen.findByRole("button", { name: "Assignee" }));

    expect(screen.getAllByRole("menuitemcheckbox").map((item) => item.textContent)).toEqual([
      "Me",
      "Unassigned",
      "Ada Lovelace",
    ]);
  });

  it("writes Overdue as yesterday and not done, in the viewer's day", async () => {
    vi.setSystemTime(new Date(2026, 10, 24, 12));
    const { user, onChange } = renderBar({});

    await user.click(await screen.findByRole("button", { name: "Due" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Overdue" }));

    expect(onChange).toHaveBeenLastCalledWith({ done: ["false"], dueTo: ["2026-11-23"] });
  });
});

describe("TaskFilterBar: chips and count (WS-120 test 4)", () => {
  it("removes a chip, clears every filter, and counts", async () => {
    const { user, onChange } = renderBar({ type: ["bug"], priority: ["high"] });

    expect(await screen.findByRole("status")).toHaveTextContent("12 of 140 tasks match.");
    await user.click(screen.getByRole("button", { name: "Remove Type: Bug" }));
    expect(onChange).toHaveBeenLastCalledWith({ priority: ["high"] });

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it("shows no count and no Clear filters without a filter", async () => {
    renderBar({});

    await screen.findByRole("search", { name: "Filter tasks" });
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    expect(screen.queryByText(/tasks match/)).not.toBeInTheDocument();
  });

  it("says once that some filters of the link were ignored", async () => {
    on(PROJECT, json(opa));
    render(
      <ProjectFrame projectKey="OPA" canManageProjects={false}>
        <TaskFilterBar
          filter={{}}
          onChange={vi.fn()}
          people={[]}
          shown={3}
          total={3}
          ignored={["priority"]}
        />
      </ProjectFrame>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Some filters in this link were not understood and are ignored.",
    );
  });
});
