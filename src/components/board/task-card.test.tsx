import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CardBody } from "./task-card";
import { bugLabel, ref, task, todo, uiLabel } from "./test-data";

// A card's labels (WS-108 test 2).

describe("a card's labels (WS-108)", () => {
  it("shows the labels as chips, by name, after the badges", () => {
    render(<CardBody task={task(1, todo.id, { labels: [ref(bugLabel), ref(uiLabel)] })} />);

    const list = screen.getByRole("list", { name: "Labels" });
    expect(Array.from(list.querySelectorAll("li")).map((item) => item.textContent)).toEqual([
      "Bug",
      "UI",
    ]);
  });

  it("shows no list for a task without labels", () => {
    render(<CardBody task={task(1, todo.id)} />);

    expect(screen.queryByRole("list", { name: "Labels" })).not.toBeInTheDocument();
  });
});

// A card's priority and due date (WS-110 test 5), with the viewer's date fixed.

describe("a card's priority and due date (WS-110)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 23, 12, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the priority as a named icon and the due date as text", () => {
    render(<CardBody task={task(1, todo.id, { priority: "high", dueDate: "2026-12-01" })} />);

    expect(screen.getByRole("img", { name: "Priority: High" })).toBeInTheDocument();
    expect(screen.getByText("Due Dec 1, 2026")).toBeInTheDocument();
  });

  it("shows nothing for priority none and no due date", () => {
    render(<CardBody task={task(1, todo.id)} />);

    expect(screen.queryByRole("img", { name: /^Priority/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Due /)).not.toBeInTheDocument();
  });

  it("says Overdue for a past date outside a done column", () => {
    render(<CardBody task={task(1, todo.id, { dueDate: "2026-11-22" })} />);

    expect(screen.getByText("Overdue, due Nov 22, 2026")).toBeInTheDocument();
  });

  it("does not say Overdue in a done column, nor for a task due today", () => {
    const { unmount } = render(
      <CardBody task={task(1, todo.id, { dueDate: "2026-11-22" })} done />,
    );
    expect(screen.getByText("Due Nov 22, 2026")).toBeInTheDocument();
    unmount();

    render(<CardBody task={task(1, todo.id, { dueDate: "2026-11-23" })} />);
    expect(screen.getByText("Due Nov 23, 2026")).toBeInTheDocument();
  });
});

// A card's sub-task marks (WS-135 test 6). The backlog's rows show the same `CardBody`.

describe("a card's sub-task marks (WS-135)", () => {
  const parentRef = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000009",
    key: "OPA-9",
    title: "Release 2.0",
  };

  it("shows a sub-task's parent key, named as its parent", () => {
    render(<CardBody task={task(1, todo.id, { parent: parentRef })} />);

    const mark = screen.getByText("OPA-9");
    expect(mark.closest("[aria-label]")).toHaveAttribute("aria-label", "Sub-task of OPA-9");
  });

  it("shows a parent's progress, named in words", () => {
    render(<CardBody task={task(9, todo.id, { subtasks: { done: 2, total: 5 } })} />);

    expect(screen.getByLabelText("2 of 5 sub-tasks done")).toHaveTextContent("2/5");
  });

  it("shows neither mark on a task that is neither", () => {
    render(<CardBody task={task(1, todo.id)} />);

    expect(screen.queryByLabelText(/sub-tasks done/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Sub-task of/)).not.toBeInTheDocument();
  });
});
