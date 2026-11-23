import { describe, expect, it } from "vitest";

import { formatDueDate, isOverdue, localDate } from "./due-date";

// Today and overdue (WS-110 section 1, test 1). Dates are built from local parts, so the
// results are the same in every time zone.

describe("localDate", () => {
  it("is the local calendar date, at either end of the day", () => {
    expect(localDate(new Date(2026, 10, 23, 0, 0))).toBe("2026-11-23");
    expect(localDate(new Date(2026, 10, 23, 23, 59, 59))).toBe("2026-11-23");
    expect(localDate(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
  });

  it("writes years before 1000 with four digits", () => {
    const early = new Date(2026, 0, 1);
    early.setFullYear(987);
    expect(localDate(early)).toBe("0987-01-01");
  });
});

describe("isOverdue", () => {
  const today = "2026-11-23";

  it("is true for a date before today outside a done column", () => {
    expect(isOverdue("2026-11-22", false, today)).toBe(true);
    expect(isOverdue("2025-12-31", false, today)).toBe(true);
  });

  it("is false for today and later", () => {
    expect(isOverdue("2026-11-23", false, today)).toBe(false);
    expect(isOverdue("2026-11-24", false, today)).toBe(false);
  });

  it("is false without a date, in a done column, or before today is known", () => {
    expect(isOverdue(null, false, today)).toBe(false);
    expect(isOverdue("2026-11-22", true, today)).toBe(false);
    expect(isOverdue("2026-11-22", false, null)).toBe(false);
  });
});

describe("formatDueDate", () => {
  it("writes the calendar date in English with the year, whatever the time zone", () => {
    expect(formatDueDate("2026-12-01")).toBe("Dec 1, 2026");
    expect(formatDueDate("2028-02-29")).toBe("Feb 29, 2028");
    expect(formatDueDate("2027-01-01")).toBe("Jan 1, 2027");
  });
});
