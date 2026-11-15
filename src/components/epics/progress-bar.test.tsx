import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProgressBar } from "./progress-bar";

describe("ProgressBar", () => {
  it("is a progress bar with the done and the total, a name that says so, and the numbers as text", () => {
    render(<ProgressBar title="Auth" doneTasks={2} totalTasks={5} />);

    const bar = screen.getByRole("progressbar", {
      name: "Progress of Auth: 2 of 5 tasks done",
    });
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "5");
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByText("2 / 5")).toBeInTheDocument();
  });

  it("fills the bar in proportion, and fully when everything is done", () => {
    const { rerender } = render(<ProgressBar title="Auth" doneTasks={1} totalTasks={4} />);
    expect(screen.getByTestId("progress-fill")).toHaveStyle({ width: "25%" });

    rerender(<ProgressBar title="Auth" doneTasks={4} totalTasks={4} />);

    expect(screen.getByTestId("progress-fill")).toHaveStyle({ width: "100%" });
  });

  it("says there are no tasks, with no bar, for an epic that has none", () => {
    render(<ProgressBar title="Auth" doneTasks={0} totalTasks={0} />);

    expect(screen.getByText("No tasks")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
