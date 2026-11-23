import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LABEL_COLOURS } from "@/lib/schemas/labels";

import { LABEL_COLOUR_CLASSES, LabelChip, LabelChips } from "./label-chip";

// The label chip (WS-108 test 1).

const ID = "bbbb0000-0000-4000-8000-000000000001";

describe("LabelChip (WS-108)", () => {
  it("has light and dark classes for every colour of the palette", () => {
    expect(Object.keys(LABEL_COLOUR_CLASSES).sort()).toEqual([...LABEL_COLOURS].sort());
    for (const colour of LABEL_COLOURS) {
      const classes = LABEL_COLOUR_CLASSES[colour].split(" ");
      expect(classes, colour).toContain(`bg-${colour}-100`);
      expect(classes, colour).toContain(`text-${colour}-800`);
      expect(classes, colour).toContain(`dark:bg-${colour}-950`);
      expect(classes, colour).toContain(`dark:text-${colour}-200`);
    }
  });

  it("shows the name as text, and keeps a long name whole in its title", () => {
    const name = "A label whose name is forty letters long";
    render(<LabelChip label={{ id: ID, name, colour: "teal" }} />);

    const chip = screen.getByText(name);
    expect(chip).toHaveAttribute("title", name);
    expect(chip.className).toContain("bg-teal-100");
  });

  it("lists several chips under an accessible name, and nothing for none", () => {
    const { container, rerender } = render(
      <LabelChips
        labels={[
          { id: ID, name: "Bug", colour: "red" },
          { id: `${ID.slice(0, -1)}2`, name: "UI", colour: "blue" },
        ]}
      />,
    );

    const list = screen.getByRole("list", { name: "Labels" });
    expect(list.textContent).toBe("BugUI");
    rerender(<LabelChips labels={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
