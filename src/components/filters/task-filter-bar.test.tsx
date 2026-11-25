import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bugLabel, json, LABELS, opa, page, PROJECT, uiLabel } from "@/components/board/test-data";
import { installFetch, on } from "@/components/fake-api";

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
        projectKey="OPA"
        people={[ada]}
        status="12 of 140 tasks match."
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
          projectKey="OPA"
          people={[]}
          status="3 of 3 tasks match."
          ignored={["priority"]}
        />
      </ProjectFrame>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Some filters in this link were not understood and are ignored.",
    );
  });
});

describe("TaskFilterBar on the list view (WS-130 test 4)", () => {
  const projects = [
    { value: "OPA", label: "Opanel" },
    { value: "OPS", label: "Operations" },
  ];

  function renderListBar(filter: TaskFilter, projectKey: string | null, onChange = vi.fn()) {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    render(
      <TaskFilterBar
        filter={filter}
        onChange={onChange}
        projectKey={projectKey}
        projects={projects}
        people={[]}
        ignored={[]}
      />,
    );
    return { user, onChange };
  }

  it("asks for one project before it offers labels or epics, without a project frame", async () => {
    const { user } = renderListBar({}, null);

    await user.click(screen.getByRole("button", { name: "Label" }));
    expect(
      screen.getByRole("menuitem", { name: "Choose one project to filter by label" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("menuitemcheckbox")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Epic" }));
    expect(
      screen.getByRole("menuitem", { name: "Choose one project to filter by epic" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("offers the chosen project's labels", async () => {
    const { user, onChange } = renderListBar({ projectId: ["OPA"] }, "OPA");

    await user.click(screen.getByRole("button", { name: "Label" }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Bug" }));

    expect(onChange).toHaveBeenLastCalledWith({ projectId: ["OPA"], labelId: [bugLabel.id] });
  });

  it("puts a Project menu first, writing the project's key", async () => {
    const { user, onChange } = renderListBar({}, null);
    const bar = screen.getByRole("search", { name: "Filter tasks" });

    expect(within(bar).getAllByRole("button")[0]).toHaveAccessibleName("Project");
    await user.click(within(bar).getByRole("button", { name: "Project" }));
    expect(screen.getAllByRole("menuitemcheckbox").map((item) => item.textContent)).toEqual([
      "Opanel",
      "Operations",
    ]);
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Operations" }));

    expect(onChange).toHaveBeenLastCalledWith({ projectId: ["OPS"] });
  });

  it("shows no status line when none is given", () => {
    renderListBar({ type: ["bug"] }, null);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Type: Bug" })).toBeVisible();
  });
});
