import { describe, expect, it } from "vitest";

import { updateTriageRequestSchema } from "./triage";

const TEAM = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

describe("updateTriageRequestSchema (WS-087)", () => {
  it("needs the version, and takes any of the triage team and the three rules", () => {
    expect(updateTriageRequestSchema.safeParse({}).success).toBe(false);
    expect(updateTriageRequestSchema.parse({ version: 3 })).toEqual({ version: 3 });
    expect(
      updateTriageRequestSchema.parse({
        triageTeamId: null,
        rules: { api: TEAM, backend: null },
        version: 3,
      }),
    ).toEqual({ triageTeamId: null, rules: { api: TEAM, backend: null }, version: 3 });
  });

  it("refuses a rule for unknown, an unknown field and a team that is not a uuid", () => {
    for (const body of [
      { rules: { unknown: TEAM }, version: 1 },
      { assignee: TEAM, version: 1 },
      { triageTeamId: "Backend", version: 1 },
      { rules: { api: "Backend" }, version: 1 },
      { version: 0 },
    ]) {
      expect(updateTriageRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});
