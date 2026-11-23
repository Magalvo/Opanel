import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DueDateText, PRIORITY_LABELS, PriorityIcon } from "./task-meta";

// Priority and due date as cards and the task detail show them (WS-110 section 2,
// tests 3 and 4).

describe("PriorityIcon", () => {
  it("is an image named after the priority, with the same title, one icon per level", () => {
    const icons = new Set<string>();
    for (const priority of ["low", "medium", "high", "urgent"] as const) {
      const { unmount } = render(<PriorityIcon priority={priority} />);
      const name = `Priority: ${PRIORITY_LABELS[priority]}`;
      const image = screen.getByRole("img", { name });
      expect(image).toHaveAttribute("title", name);
      icons.add(image.querySelector("svg")?.getAttribute("class") ?? "");
      unmount();
    }

    expect(icons.size).toBe(4);
  });

  it("shows nothing for none", () => {
    const { container } = render(<PriorityIcon priority="none" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("names the five levels", () => {
    expect(PRIORITY_LABELS).toEqual({
      none: "None",
      low: "Low",
      medium: "Medium",
      high: "High",
      urgent: "Urgent",
    });
  });
});

describe("DueDateText", () => {
  it("says when the task is due", () => {
    render(<DueDateText dueDate="2026-12-01" overdue={false} />);

    expect(screen.getByText("Due Dec 1, 2026")).toBeInTheDocument();
  });

  it("says Overdue in words when it is", () => {
    render(<DueDateText dueDate="2026-12-01" overdue />);

    expect(screen.getByText("Overdue, due Dec 1, 2026")).toBeInTheDocument();
  });

  it("shows nothing without a date", () => {
    const { container } = render(<DueDateText dueDate={null} overdue={false} />);

    expect(container).toBeEmptyDOMElement();
  });
});
