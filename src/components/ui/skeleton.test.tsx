import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Skeleton } from "./skeleton";

// The skeleton pulses only without reduced motion (WS-129 section 3, test 1).
describe("Skeleton", () => {
  it("pulses only when the person has not asked for reduced motion", () => {
    const { container } = render(<Skeleton className="h-4 w-20" />);
    const skeleton = container.querySelector('[data-slot="skeleton"]');
    const classes = [...(skeleton?.classList ?? [])];

    expect(classes).toContain("motion-safe:animate-pulse");
    expect(classes).not.toContain("animate-pulse");
    expect(classes).toEqual(expect.arrayContaining(["h-4", "w-20"]));
  });
});
