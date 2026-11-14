import { describe, expect, it } from "vitest";

import { contracts } from "@/lib/openapi/contracts";

import {
  createEpicRequestSchema,
  epicParamsSchema,
  epicQuerySchema,
  updateEpicRequestSchema,
} from "./epics";

const UUID = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

function paths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return result.error?.issues.map((issue) => issue.path.join(".")) ?? [];
}

describe("epic requests", () => {
  it("create: title 1..200 trimmed, description up to 50 000, calendar dates or null", () => {
    expect(
      createEpicRequestSchema.parse({
        title: "  Sign-in  ",
        startDate: "2026-11-01",
        targetDate: "2026-12-15",
      }),
    ).toEqual({ title: "Sign-in", startDate: "2026-11-01", targetDate: "2026-12-15" });
    expect(createEpicRequestSchema.safeParse({ title: "E", targetDate: null }).success).toBe(true);
    for (const body of [
      { title: "" },
      { title: "x".repeat(201) },
      { title: "E", description: "x".repeat(50_001) },
      { title: "E", startDate: "2026-11-01T00:00:00Z" },
      { title: "E", startDate: "2026-13-01" },
      { title: "E", status: "closed" },
    ]) {
      expect(
        createEpicRequestSchema.safeParse(body).success,
        JSON.stringify(body).slice(0, 50),
      ).toBe(false);
    }
  });

  it("refuses a target date before the start date, on targetDate", () => {
    const result = createEpicRequestSchema.safeParse({
      title: "E",
      startDate: "2026-12-01",
      targetDate: "2026-11-30",
    });

    expect(result.success).toBe(false);
    expect(paths(result)).toEqual(["targetDate"]);
    expect(
      createEpicRequestSchema.safeParse({
        title: "E",
        startDate: "2026-12-01",
        targetDate: "2026-12-01",
      }).success,
    ).toBe(true);
  });

  it("update: needs version and a field; status open or closed; dates may be cleared", () => {
    expect(updateEpicRequestSchema.parse({ status: "closed", version: 2 })).toEqual({
      status: "closed",
      version: 2,
    });
    expect(updateEpicRequestSchema.safeParse({ startDate: null, version: 1 }).success).toBe(true);
    expect(updateEpicRequestSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateEpicRequestSchema.safeParse({ title: "E" }).success).toBe(false);
    expect(updateEpicRequestSchema.safeParse({ status: "done", version: 1 }).success).toBe(false);
    expect(
      paths(
        updateEpicRequestSchema.safeParse({
          startDate: "2026-12-01",
          targetDate: "2026-11-01",
          version: 1,
        }),
      ),
    ).toEqual(["targetDate"]);
  });

  it("query and path", () => {
    expect(epicQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(epicQuerySchema.parse({ status: "all" })).toEqual({ limit: 50, status: "all" });
    expect(epicQuerySchema.safeParse({ status: "done" }).success).toBe(false);
    expect(epicParamsSchema.safeParse({ epicId: UUID }).success).toBe(true);
    expect(epicParamsSchema.safeParse({ epicId: "OPA-1" }).success).toBe(false);
  });
});

describe("epic contracts", () => {
  it("read with tasks:read and write with epics:manage", () => {
    const access = new Map(
      contracts.map((contract) => [
        `${contract.method.toUpperCase()} ${contract.path}`,
        contract.access,
      ]),
    );
    const read = { kind: "permission", permission: "tasks:read" };
    const manage = { kind: "permission", permission: "epics:manage" };

    expect(access.get("GET /api/v1/projects/{projectId}/epics")).toEqual(read);
    expect(access.get("GET /api/v1/epics/{epicId}")).toEqual(read);
    expect(access.get("POST /api/v1/projects/{projectId}/epics")).toEqual(manage);
    expect(access.get("PATCH /api/v1/epics/{epicId}")).toEqual(manage);
  });
});
