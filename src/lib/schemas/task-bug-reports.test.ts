import { describe, expect, it } from "vitest";

import { contracts } from "@/lib/openapi/contracts";

import {
  bugReportListQuerySchema,
  bugReportPageSchema,
  bugReportSchema,
  listBugReportsContract,
} from "./task-bug-reports";

// Reading the reports behind a task (WS-090).

const UUID = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

const minimal = {
  id: UUID,
  taskId: UUID,
  agent: { id: UUID, name: "QA Bot", kind: "agent" },
  outcome: "created",
  originLayer: "unknown",
  confidence: null,
  severity: "medium",
  fingerprint: "fp",
  runId: null,
  title: "Crash",
  summary: null,
  evidence: null,
  createdAt: "2026-11-20T08:30:00.123Z",
};

describe("the bug reports of a task (WS-090)", () => {
  it("pages 10 by default and 25 at most", () => {
    expect(bugReportListQuerySchema.parse({})).toEqual({ limit: 10 });
    expect(bugReportListQuerySchema.parse({ limit: "25" })).toEqual({ limit: 25 });
    for (const limit of ["0", "26", "x"]) {
      expect(bugReportListQuerySchema.safeParse({ limit }).success, limit).toBe(false);
    }
    expect(bugReportListQuerySchema.safeParse({ sort: "createdAt" }).success).toBe(false);
  });

  it("reads a minimal and a full report", () => {
    expect(bugReportSchema.parse(minimal)).toEqual(minimal);
    const full = {
      ...minimal,
      outcome: "deduplicated",
      originLayer: "api",
      confidence: 0.8,
      severity: "high",
      runId: "run-1",
      summary: "The button fails.",
      evidence: {
        stepsToReproduce: ["Open"],
        http: { method: "POST", path: "/api/orders", status: 500 },
      },
    };
    expect(bugReportSchema.parse(full)).toEqual(full);
    expect(bugReportPageSchema.parse({ items: [full], nextCursor: null }).items).toHaveLength(1);
    expect(bugReportSchema.safeParse({ ...minimal, payload: {} }).success).toBe(false);
  });

  it("is GET /api/v1/tasks/{taskId}/bug-reports with tasks:read, registered", () => {
    expect(listBugReportsContract).toMatchObject({
      method: "get",
      path: "/api/v1/tasks/{taskId}/bug-reports",
      access: { kind: "permission", permission: "tasks:read" },
    });
    expect(contracts).toContain(listBugReportsContract);
  });
});
