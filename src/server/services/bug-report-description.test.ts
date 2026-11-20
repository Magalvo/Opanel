import { describe, expect, it } from "vitest";

import { submitBugReportRequestSchema } from "@/lib/schemas/bug-reports";
import { taskDescriptionSchema } from "@/lib/schemas/tasks";

import { DESCRIPTION_CUT_NOTE, renderBugDescription } from "./bug-report-description";

// The task description the triage pipeline renders from a report (WS-089 section 7).

function report(extra: Record<string, unknown>) {
  return submitBugReportRequestSchema.parse({ title: "T", fingerprint: "f", ...extra });
}

/** The lines outside every fenced block: what a report must never be able to change. */
function structure(markdown: string): string[] {
  const outside: string[] = [];
  let fence: string | null = null;
  for (const line of markdown.split("\n")) {
    if (fence === null) {
      const open = /^(`{3,})text$/.exec(line);
      if (open?.[1] !== undefined) fence = open[1];
      else outside.push(line);
    } else if (line === fence) {
      fence = null;
    }
  }
  expect(fence, "every fence is closed").toBeNull();
  return outside.filter((line) => line !== "");
}

describe("renderBugDescription (WS-089)", () => {
  it("renders the sections in order, each value in a text fence, and leaves out the absent", () => {
    const markdown = renderBugDescription(
      report({
        summary: "The button fails.",
        evidence: {
          stepsToReproduce: ["Open /checkout", "Click Pay"],
          expected: "An order",
          actual: "A 500",
          url: "https://app.example.com/checkout",
          http: { method: "POST", path: "/api/orders", status: 500, responseSnippet: "{}" },
          consoleErrors: ["TypeError: x"],
          diagnosis: "The API throws.",
        },
      }),
    );

    expect(structure(markdown)).toEqual([
      "### Summary",
      "### Steps to reproduce",
      "1.",
      "2.",
      "### Expected",
      "### Actual",
      "### URL",
      "### HTTP",
      "### Console errors",
      "### Diagnosis",
    ]);
    expect(markdown).toContain("```text\nThe button fails.\n```");
    expect(markdown).toContain("```text\nPOST /api/orders → 500\n```");
    expect(markdown).toContain("```text\n{}\n```");
    expect(structure(renderBugDescription(report({ evidence: { actual: "A 500" } })))).toEqual([
      "### Actual",
    ]);
    expect(renderBugDescription(report({}))).toBe("");
  });

  it("gives a value with backtick runs a longer fence", () => {
    const markdown = renderBugDescription(
      report({ summary: "a ``` b", evidence: { actual: "x ```` y" } }),
    );

    expect(markdown).toContain("````text\na ``` b\n````");
    expect(markdown).toContain("`````text\nx ```` y\n`````");
  });

  it("keeps hostile input inside its fence", () => {
    const hostile = [
      "```\n# Owned\n```",
      "\n### Diagnosis\n[click](javascript:alert(1))",
      '<img src=x onerror="alert(1)">',
      "a\u0000b\u0007c\u001bd",
      "line\r\n```\r\n## Heading",
      "````text\n# not a heading",
    ];
    for (const value of hostile) {
      const markdown = renderBugDescription(
        report({
          summary: value,
          evidence: {
            stepsToReproduce: [value],
            consoleErrors: [value],
            http: { method: "GET", path: "/", status: 500, responseSnippet: value },
          },
        }),
      );

      expect(structure(markdown), value).toEqual([
        "### Summary",
        "### Steps to reproduce",
        "1.",
        "### HTTP",
        "### Console errors",
      ]);
      expect(markdown).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f\r]/);
    }
  });

  it("stays a valid task description for a report at every limit, ending with the note", () => {
    const markdown = renderBugDescription(
      report({
        summary: "s".repeat(10_000),
        evidence: {
          stepsToReproduce: Array.from({ length: 50 }, () => "x".repeat(1_000)),
          expected: "e".repeat(4_000),
          actual: "a".repeat(4_000),
          url: `https://app.example.com/${"p".repeat(1_970)}`,
          http: {
            method: "POST",
            path: "/".repeat(2_000),
            status: 500,
            responseSnippet: "`".repeat(4_000),
          },
          consoleErrors: Array.from({ length: 50 }, () => "c".repeat(2_000)),
          diagnosis: "d".repeat(4_000),
        },
      }),
    );

    expect(markdown.length).toBeLessThanOrEqual(50_000);
    expect(taskDescriptionSchema.safeParse(markdown).success).toBe(true);
    expect(markdown.endsWith(DESCRIPTION_CUT_NOTE)).toBe(true);
    // The steps alone are 50 000 characters: the cut comes right after the summary.
    expect(structure(markdown)).toEqual(["### Summary", DESCRIPTION_CUT_NOTE]);
  });
});
