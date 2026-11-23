import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
