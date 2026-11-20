import { describe, expect, it } from "vitest";

import {
  BUG_REPORT_OUTCOMES,
  FINGERPRINT_MAX_LENGTH,
  ORIGIN_LAYERS,
  originLayerSchema,
  ROUTED_LAYERS,
  routedLayerSchema,
  SEVERITIES,
  severitySchema,
  TASK_LINK_TYPES,
} from "./bug-reports";

describe("the vocabularies of bug reports and triage (WS-086)", () => {
  it("are the values of doc 0001 section 5 and doc 0003 section 4", () => {
    expect(SEVERITIES).toEqual(["low", "medium", "high", "critical"]);
    expect(ORIGIN_LAYERS).toEqual(["frontend", "api", "backend", "unknown"]);
    expect(ROUTED_LAYERS).toEqual(["frontend", "api", "backend"]);
    expect(BUG_REPORT_OUTCOMES).toEqual(["created", "deduplicated"]);
    expect(TASK_LINK_TYPES).toEqual(["regression_of"]);
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
