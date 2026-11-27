import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { TaskListItem, TaskSort } from "@/lib/schemas/tasks";

import { TaskListTable } from "./task-list-table";
import { doing, done, item, ops, todo } from "./test-data";

// The table of the list view (WS-130 section 4, tests 5 and 6).

const NOW = new Date("2026-11-25T12:00:00.000Z");
const TODAY = "2026-11-25";

const team = { id: "77777777-7777-4777-8777-777777777777", name: "Frontend" };
const ada = { id: "66666666-6666-4666-8666-666666666666", name: "Ada Lovelace", active: true };

function renderTable(items: TaskListItem[], sort: TaskSort = "-updated", onSort = vi.fn()) {
  render(<TaskListTable items={items} sort={sort} onSort={onSort} today={TODAY} now={NOW} />);
  return { onSort, user: userEvent.setup() };
}

/** The table's rows below the header. */
function bodyRows(): HTMLElement[] {
  return screen.getAllByRole("row").slice(1);
}

/** The first row below the header. */
function firstRow(): HTMLElement {
  const [row] = bodyRows();
  if (row === undefined) throw new Error("no row");
  return row;
}

function cells(row: HTMLElement): string[] {
  return within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent);
}

describe("TaskListTable: the rows (WS-130 test 5)", () => {
  it("shows each column of a row, the key linking to the task's page", () => {
    renderTable([
      item(7, doing, {
        type: "bug",
        title: "Login fails",
        priority: "high",
        assignee: ada,
        dueDate: "2026-12-01",
        updatedAt: "2026-11-25T09:00:00.000Z",
      }),
    ]);

    const table = screen.getByRole("table", { name: "Tasks" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual([
      "Key",
      "Title",
      "Type",
      "Status",
      "Priority",
      "Assignee",
      "Due",
      "Points",
      "Updated",
    ]);
    const row = firstRow();
    expect(cells(row)).toEqual([
      "OPA-7",
      "Login fails",
      "Bug",
      "In progress",
      "High",
      "Ada Lovelace",
      "Due Dec 1, 2026",
      "",
      "3 hours ago",
    ]);
    expect(within(row).getByRole("link", { name: "OPA-7" })).toHaveAttribute(
      "href",
      "/projects/OPA/tasks/OPA-7",
    );
    expect(within(row).getByText("3 hours ago")).toHaveAttribute(
      "datetime",
      "2026-11-25T09:00:00.000Z",
    );
  });

  it("says Backlog for a task with no column, and links another project's task", () => {
    renderTable([item(3, null, {}, ops)]);

    const row = firstRow();
    expect(cells(row)[3]).toBe("Backlog");
    expect(within(row).getByRole("link", { name: "OPS-3" })).toHaveAttribute(
      "href",
      "/projects/OPS/tasks/OPS-3",
    );
  });

  it("names the person, else the team, else Unassigned, and an inactive person", () => {
    renderTable([
      item(1, todo, { assignee: ada, assigneeTeam: team }),
      item(2, todo, { assigneeTeam: team }),
      item(3, todo),
      item(4, todo, { assignee: { ...ada, active: false } }),
    ]);

    const rows = bodyRows();
    expect(rows.map((row) => cells(row)[5])).toEqual([
      "Ada Lovelace",
      "Frontend",
      "Unassigned",
      "Ada Lovelace (inactive)",
    ]);
  });

  it("says overdue in text, but never for a done task, and in the backlog too", () => {
    renderTable([
      item(1, todo, { dueDate: "2026-11-24" }),
      item(2, done, { dueDate: "2026-11-24" }),
      item(3, null, { dueDate: "2026-11-24" }),
      item(4, todo, { dueDate: "2026-11-25" }),
      item(5, todo),
    ]);

    const rows = bodyRows();
    expect(rows.map((row) => cells(row)[6])).toEqual([
      "Overdue, due Nov 24, 2026",
      "Due Nov 24, 2026",
      "Overdue, due Nov 24, 2026",
      "Due Nov 25, 2026",
      "",
    ]);
  });
});

describe("TaskListTable: sorting (WS-130 test 6)", () => {
  it("marks only the sorted header, with its direction", () => {
    renderTable([item(1, todo)], "-priority");

    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((header) => header.getAttribute("aria-sort"))).toEqual([
      null,
      null,
      null,
      null,
      "descending",
      null,
      null,
      null,
      null,
    ]);
  });

  it("has a sort button only on the six sortable headers", () => {
    renderTable([item(1, todo)]);

    expect(
      screen.getAllByRole("button", { name: /^Sort by / }).map((button) => button.textContent),
    ).toEqual(["Key", "Title", "Priority", "Due", "Points", "Updated"]);
  });

  it("sorts an unsorted header ascending, and reverses the sorted one", async () => {
    const { user, onSort } = renderTable([item(1, todo)], "title");

    await user.click(screen.getByRole("button", { name: "Sort by Key" }));
    expect(onSort).toHaveBeenLastCalledWith("key");

    await user.click(screen.getByRole("button", { name: "Sort by Title" }));
    expect(onSort).toHaveBeenLastCalledWith("-title");

    await user.click(screen.getByRole("button", { name: "Sort by Due" }));
    expect(onSort).toHaveBeenLastCalledWith("dueDate");
  });

  it("starts Updated descending, newest first", async () => {
    const { user, onSort } = renderTable([item(1, todo)], "key");

    await user.click(screen.getByRole("button", { name: "Sort by Updated" }));
    expect(onSort).toHaveBeenLastCalledWith("-updated");
  });

  it("reverses the default order from the Updated header", async () => {
    const { user, onSort } = renderTable([item(1, todo)], "-updated");

    expect(screen.getAllByRole("columnheader")[8]).toHaveAttribute("aria-sort", "descending");
    await user.click(screen.getByRole("button", { name: "Sort by Updated" }));
    expect(onSort).toHaveBeenLastCalledWith("updated");
  });

  it("marks no header when the order is by creation, from a link", () => {
    renderTable([item(1, todo)], "created");

    expect(
      screen.getAllByRole("columnheader").filter((header) => header.hasAttribute("aria-sort")),
    ).toEqual([]);
  });
});

describe("TaskListTable: story points (WS-139 test 12)", () => {
  it("shows a task's points in the Points column, empty without", () => {
    renderTable([
      item(1, todo, { storyPoints: 3 }),
      item(2, todo, { storyPoints: 0.5 }),
      item(3, todo),
    ]);

    expect(bodyRows().map((row) => cells(row)[7])).toEqual(["3", "0.5", ""]);
  });

  it("sorts by storyPoints from the Points header, ascending first, then reversed", async () => {
    const { user, onSort } = renderTable([item(1, todo)], "key");

    await user.click(screen.getByRole("button", { name: "Sort by Points" }));
    expect(onSort).toHaveBeenLastCalledWith("storyPoints");
  });

  it("marks the Points header when the order is by points, and reverses it", async () => {
    const { user, onSort } = renderTable([item(1, todo)], "storyPoints");

    expect(screen.getAllByRole("columnheader")[7]).toHaveAttribute("aria-sort", "ascending");
    await user.click(screen.getByRole("button", { name: "Sort by Points" }));
    expect(onSort).toHaveBeenLastCalledWith("-storyPoints");
  });
});
