import { describe, expect, it } from "vitest";

import {
  BUG_REPORT_OUTCOMES,
  bugReportCreatedSchema,
  bugReportDeduplicatedSchema,
  FINGERPRINT_MAX_LENGTH,
  ORIGIN_LAYERS,
  originLayerSchema,
  ROUTED_LAYERS,
  routedLayerSchema,
  SEVERITIES,
  severitySchema,
  submitBugReportContract,
  submitBugReportRequestSchema,
  TASK_LINK_TYPES,
} from "./bug-reports";

describe("the vocabularies of bug reports and triage (WS-086)", () => {
  it("are the values of doc 0001 section 5 and doc 0003 section 4", () => {
    expect(SEVERITIES).toEqual(["low", "medium", "high", "critical"]);
    expect(ORIGIN_LAYERS).toEqual(["frontend", "api", "backend", "unknown"]);
    expect(ROUTED_LAYERS).toEqual(["frontend", "api", "backend"]);
    expect(BUG_REPORT_OUTCOMES).toEqual(["created", "deduplicated"]);
    expect(TASK_LINK_TYPES).toEqual(["blocks", "duplicates", "regression_of", "relates_to"]);
    expect(FINGERPRINT_MAX_LENGTH).toBe(128);
  });

  it("refuse anything else", () => {
    expect(severitySchema.safeParse("urgent").success).toBe(false);
    expect(originLayerSchema.safeParse("database").success).toBe(false);
    // `unknown` always goes to the triage team: no rule may name it.
    expect(routedLayerSchema.safeParse("unknown").success).toBe(false);
    expect(routedLayerSchema.safeParse("api").success).toBe(true);
  });
});

describe("the bug report request (WS-089)", () => {
  const minimal = { title: "Checkout returns 500", fingerprint: "api:/orders:500" };
  const path = (body: unknown) =>
    submitBugReportRequestSchema.safeParse(body).error?.issues.map((i) => i.path.join("."));

  it("needs a title and a fingerprint, and defaults the layer and the severity", () => {
    expect(submitBugReportRequestSchema.parse({ ...minimal, title: "  Checkout  " })).toEqual({
      title: "Checkout",
      fingerprint: "api:/orders:500",
      originLayer: "unknown",
      severity: "medium",
    });
    expect(path({ fingerprint: "f" })).toEqual(["title"]);
    expect(path({ title: "T" })).toEqual(["fingerprint"]);
  });

  it("accepts every field at its limit", () => {
    const body = {
      ...minimal,
      title: "t".repeat(200),
      fingerprint: "~".repeat(128),
      originLayer: "api",
      confidence: 1,
      severity: "critical",
      summary: "s".repeat(10_000),
      runId: "r".repeat(128),
      evidence: {
        stepsToReproduce: Array.from({ length: 50 }, () => "x".repeat(1_000)),
        expected: "e".repeat(4_000),
        actual: "a".repeat(4_000),
        url: `https://app.example.com/${"p".repeat(1_970)}`,
        http: {
          method: "POST",
          path: "/".repeat(2_000),
          status: 599,
          responseSnippet: "r".repeat(4_000),
        },
        consoleErrors: Array.from({ length: 50 }, () => "c".repeat(2_000)),
        diagnosis: "d".repeat(4_000),
      },
    };
    expect(submitBugReportRequestSchema.safeParse(body).success).toBe(true);
    expect(submitBugReportRequestSchema.safeParse({ ...minimal, confidence: 0 }).success).toBe(
      true,
    );
    expect(
      submitBugReportRequestSchema.safeParse({
        ...minimal,
        evidence: { http: { method: "GET", path: "/", status: 100 } },
      }).success,
    ).toBe(true);
  });

  it("refuses each field one past its limit, naming it", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ title: "" }, "title"],
      [{ title: "t".repeat(201) }, "title"],
      [{ fingerprint: "" }, "fingerprint"],
      [{ fingerprint: "f".repeat(129) }, "fingerprint"],
      [{ fingerprint: "café" }, "fingerprint"],
      [{ fingerprint: "a\nb" }, "fingerprint"],
      [{ originLayer: "database" }, "originLayer"],
      [{ severity: "urgent" }, "severity"],
      [{ confidence: 1.01 }, "confidence"],
      [{ confidence: -0.1 }, "confidence"],
      [{ summary: "s".repeat(10_001) }, "summary"],
      [{ runId: "" }, "runId"],
      [{ runId: "r".repeat(129) }, "runId"],
      [
        { evidence: { stepsToReproduce: Array.from({ length: 51 }, () => "x") } },
        "evidence.stepsToReproduce",
      ],
      [{ evidence: { stepsToReproduce: ["x".repeat(1_001)] } }, "evidence.stepsToReproduce.0"],
      [{ evidence: { stepsToReproduce: [""] } }, "evidence.stepsToReproduce.0"],
      [{ evidence: { expected: "e".repeat(4_001) } }, "evidence.expected"],
      [{ evidence: { actual: "a".repeat(4_001) } }, "evidence.actual"],
      [{ evidence: { diagnosis: "d".repeat(4_001) } }, "evidence.diagnosis"],
      [{ evidence: { url: "ftp://example.com/" } }, "evidence.url"],
      [{ evidence: { url: `https://example.com/${"p".repeat(2_000)}` } }, "evidence.url"],
      [{ evidence: { http: { method: "GET", path: "/", status: 600 } } }, "evidence.http.status"],
      [{ evidence: { http: { method: "GET", path: "/", status: 99 } } }, "evidence.http.status"],
      [{ evidence: { http: { method: "G ET", path: "/", status: 200 } } }, "evidence.http.method"],
      [{ evidence: { http: { method: "GET", path: "", status: 200 } } }, "evidence.http.path"],
      [
        {
          evidence: {
            http: { method: "GET", path: "/", status: 200, responseSnippet: "r".repeat(4_001) },
          },
        },
        "evidence.http.responseSnippet",
      ],
      [
        { evidence: { consoleErrors: Array.from({ length: 51 }, () => "c") } },
        "evidence.consoleErrors",
      ],
      [{ evidence: { consoleErrors: ["c".repeat(2_001)] } }, "evidence.consoleErrors.0"],
    ];
    for (const [change, field] of cases) {
      expect(path({ ...minimal, ...change }), field).toEqual([field]);
    }
  });

  it("refuses an unknown key at every level", () => {
    expect(path({ ...minimal, taskId: "x" })).toEqual([""]);
    expect(path({ ...minimal, evidence: { screenshot: "x" } })).toEqual(["evidence"]);
    expect(
      path({
        ...minimal,
        evidence: { http: { method: "GET", path: "/", status: 200, body: "x" } },
      }),
    ).toEqual(["evidence.http"]);
  });
});

describe("the bug report contract (WS-089)", () => {
  it("is POST /api/v1/projects/{projectId}/bug-reports, needing reports:write, with both answers", () => {
    expect(submitBugReportContract).toMatchObject({
      method: "post",
      path: "/api/v1/projects/{projectId}/bug-reports",
      access: { kind: "permission", permission: "reports:write" },
    });
    expect(submitBugReportContract.responses[201].schema).toBe(bugReportCreatedSchema);
    expect(submitBugReportContract.responses[200].schema).toBe(bugReportDeduplicatedSchema);
    expect(
      bugReportCreatedSchema.safeParse({
        outcome: "created",
        taskId: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
        taskKey: "OPA-1",
        assignedTeamId: null,
      }).success,
    ).toBe(true);
    expect(
      bugReportDeduplicatedSchema.safeParse({
        outcome: "deduplicated",
        taskId: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
        taskKey: "OPA-1",
        occurrences: 2,
      }).success,
    ).toBe(true);
  });
});
