import { describe, expect, it } from "vitest";

import { maintenanceSummary, parseMaintenanceArgs } from "./maintenance";

describe("maintenance command (WS-066 section 3)", () => {
  it("takes no arguments", () => {
    expect(parseMaintenanceArgs([])).toBe(true);
    expect(parseMaintenanceArgs(["--dry-run"])).toBe(false);
  });

  it("says how many rows of each it deleted", () => {
    expect(maintenanceSummary({ sessions: 12, links: 3, rateLimits: 40, verifications: 0 })).toBe(
      "Deleted 12 expired sessions, 3 old links, 40 rate-limit counters, 0 verifications.",
    );
  });
});
