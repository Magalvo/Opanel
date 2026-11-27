import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EpicProgress } from "./epic-progress";

// An epic's points beside its tasks (WS-139 test 14).

const tasksOnly = { doneTasks: 2, totalTasks: 5 };

describe("EpicProgress: story points (WS-139)", () => {
  it("shows done of total points, named in words, and how many are not estimated", () => {
    render(
      <EpicProgress progress={{ ...tasksOnly, donePoints: 5, totalPoints: 13, unestimated: 2 }} />,
    );

    expect(screen.getByRole("progressbar", { name: "2 of 5 tasks done" })).toBeInTheDocument();
    expect(screen.getByLabelText("5 of 13 story points done")).toHaveTextContent("5 / 13 points");
    expect(screen.getByText("2 not estimated")).toBeInTheDocument();
  });

  it("shows halves, and no count when every task is estimated", () => {
    render(
      <EpicProgress
        progress={{ ...tasksOnly, donePoints: 2.5, totalPoints: 10.5, unestimated: 0 }}
      />,
    );

    expect(screen.getByLabelText("2.5 of 10.5 story points done")).toHaveTextContent(
      "2.5 / 10.5 points",
    );
    expect(screen.queryByText(/not estimated/)).not.toBeInTheDocument();
  });

  it("shows no points text for an epic whose tasks have no points", () => {
    const { container } = render(
      <EpicProgress progress={{ ...tasksOnly, donePoints: 0, totalPoints: 0, unestimated: 5 }} />,
    );

    expect(container).not.toHaveTextContent(/points|estimated/);
    expect(screen.getByText("2 / 5")).toBeInTheDocument();
  });

  it("still says No tasks for an epic without tasks", () => {
    const { container } = render(
      <EpicProgress
        progress={{ doneTasks: 0, totalTasks: 0, donePoints: 0, totalPoints: 0, unestimated: 0 }}
      />,
    );

    expect(container).toHaveTextContent("No tasks");
    expect(container).not.toHaveTextContent(/points/);
  });
});
