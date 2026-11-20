import { describe, expect, it } from "vitest";

import { BUG_REPORT_OUTCOMES, ORIGIN_LAYERS, SEVERITIES } from "@/lib/schemas/bug-reports";

import {
  confidenceText,
  LAYER_LABELS,
  OUTCOME_LABELS,
  reportedText,
  SEVERITY_LABELS,
} from "./bug-labels";

describe("bug labels (WS-091 section 1)", () => {
  it("names every severity, layer and outcome", () => {
    expect(SEVERITIES.map((severity) => SEVERITY_LABELS[severity])).toEqual([
      "Low",
      "Medium",
      "High",
      "Critical",
    ]);
    expect(ORIGIN_LAYERS.map((layer) => LAYER_LABELS[layer])).toEqual([
      "Frontend",
      "API",
      "Backend",
      "Unknown",
    ]);
    expect(BUG_REPORT_OUTCOMES.map((outcome) => OUTCOME_LABELS[outcome])).toEqual([
      "New bug",
      "Repeat",
    ]);
  });

  it("says how often and when a task was reported", () => {
    const at = "2026-11-20T10:00:00.000Z";
    const time = new Date(at).toLocaleString();

    expect(reportedText(1, at)).toBe(`Reported once, on ${time}`);
    expect(reportedText(3, at)).toBe(`Reported 3 times, last on ${time}`);
    expect(reportedText(3, null)).toBe("Reported 3 times");
  });

  it("gives confidence as a whole percentage, or says it was not given", () => {
    expect(confidenceText(0.8)).toBe("80%");
    expect(confidenceText(1)).toBe("100%");
    expect(confidenceText(0)).toBe("0%");
    expect(confidenceText(0.125)).toBe("13%");
    expect(confidenceText(null)).toBe("Not given");
  });
});
