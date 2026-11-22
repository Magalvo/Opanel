import { describe, expect, it } from "vitest";

import { calendarDateSchema } from "./dates";

describe("calendarDateSchema (WS-102)", () => {
  it("accepts real calendar dates from the year 0001", () => {
    for (const date of ["2028-02-29", "0001-01-01", "9999-12-31", "2026-12-01"]) {
      expect(calendarDateSchema.parse(date), date).toBe(date);
    }
  });

  it("refuses impossible dates, the year 0000 and other formats", () => {
    for (const date of [
      "2026-02-30",
      "2027-02-29",
      "0000-01-01",
      "2026-1-01",
      "2026-12-31T00:00",
    ]) {
      expect(calendarDateSchema.safeParse(date).success, date).toBe(false);
    }
    expect(calendarDateSchema.safeParse("0000-01-01").error?.issues[0]?.message).toBe(
      "Not a calendar date.",
    );
  });
});
