// Keeps canonical doc 0004 section 4 in step with the API (WS-083): its tables name every
// error code of `PROBLEM_CODES`, and no other.
import { describe, expect, it } from "vitest";

import { PROBLEM_CODES } from "@/lib/schemas/problem";

import { read } from "./doc-checks";

/** The text of section 4, "Errors", up to section 5. */
function errorsSection(): string {
  const doc = read("docs/canonical/0004-api-conventions.md");
  const start = doc.indexOf("\n## 4.");
  const end = doc.indexOf("\n## 5.");
  if (start === -1 || end === -1) throw new Error("doc 0004 has no sections 4 and 5");
  return doc.slice(start, end);
}

/** The codes in the second column of every table row of section 4. */
function tabledCodes(): string[] {
  return errorsSection()
    .split("\n")
    .map((line) => /^ *\| `\d{3}` +\| `([a-z_]+)` +\|/.exec(line)?.[1])
    .filter((code): code is string => code !== undefined);
}

describe("canonical doc 0004, section 4 (WS-083)", () => {
  it("lists every error code once, in a table with its status", () => {
    const codes = tabledCodes();

    expect([...codes].sort()).toEqual([...PROBLEM_CODES].sort());
    expect(new Set(codes).size).toBe(codes.length);
  });
});
