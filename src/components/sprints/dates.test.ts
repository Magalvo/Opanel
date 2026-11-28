import { describe, expect, it } from "vitest";

import { daysLeftText, newSprintDefaults, sprintDatesText } from "./dates";
import { sprint } from "./test-data";

describe("a sprint's dates in words (WS-144 sections 4 and 7)", () => {
  it("writes both dates", () => {
    expect(sprintDatesText("2026-12-01", "2026-12-14")).toBe("Dec 1, 2026 – Dec 14, 2026");
  });

  it("counts the days left, and the days since it ended", () => {
    expect(daysLeftText("2026-12-14", "2026-12-05")).toBe("9 days left");
    expect(daysLeftText("2026-12-06", "2026-12-05")).toBe("1 day left");
    expect(daysLeftText("2026-12-05", "2026-12-05")).toBe("Ends today");
    expect(daysLeftText("2026-12-04", "2026-12-05")).toBe("Ended 1 day ago");
    expect(daysLeftText("2026-11-30", "2026-12-05")).toBe("Ended 5 days ago");
  });
});

describe("a new sprint's defaults (WS-144 section 6, question 3)", () => {
  it("is Sprint N, from the day after the latest sprint ends, for 14 days", () => {
    const sprints = [
      sprint(1, "completed", "2026-11-03", "2026-11-16"),
      sprint(2, "planned", "2026-12-29", "2027-01-11"),
      sprint(3, "active", "2026-12-01", "2026-12-14"),
    ];

    expect(newSprintDefaults(sprints, "2026-12-05")).toEqual({
      name: "Sprint 4",
      startDate: "2027-01-12",
      endDate: "2027-01-26",
    });
  });

  it("starts today when the project has no sprint", () => {
    expect(newSprintDefaults([], "2026-12-05")).toEqual({
      name: "Sprint 1",
      startDate: "2026-12-05",
      endDate: "2026-12-19",
    });
  });

  it("starts today when every sprint ended before", () => {
    expect(
      newSprintDefaults([sprint(1, "completed", "2026-11-01", "2026-11-14")], "2026-12-05"),
    ).toEqual({ name: "Sprint 2", startDate: "2026-12-05", endDate: "2026-12-19" });
  });
});
