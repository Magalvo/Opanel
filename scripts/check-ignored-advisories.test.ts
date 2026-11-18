import { describe, expect, it } from "vitest";

import { fixedAdvisories, ignoredGhsas } from "./check-ignored-advisories";

describe("ignoredGhsas (WS-061)", () => {
  it("returns the ids listed under auditConfig.ignoreGhsas, skipping comments", () => {
    const yaml = [
      "overrides:",
      '  "a>b": "1.0.0"',
      "",
      "auditConfig:",
      "  ignoreGhsas:",
      "    # a comment that mentions GHSA-xxxx-xxxx-xxxx",
      "    - GHSA-fc5q-39xc-vjpf",
      "",
      "    # another reason",
      "    - GHSA-aaaa-bbbb-cccc",
      "",
      "packageManagerStrictVersion: true",
      "",
    ].join("\n");

    expect(ignoredGhsas(yaml)).toEqual(["GHSA-fc5q-39xc-vjpf", "GHSA-aaaa-bbbb-cccc"]);
  });

  it("reads CRLF files too", () => {
    expect(ignoredGhsas("auditConfig:\r\n  ignoreGhsas:\r\n    - GHSA-fc5q-39xc-vjpf\r\n")).toEqual(
      ["GHSA-fc5q-39xc-vjpf"],
    );
  });

  it("returns nothing when there is no list, or an empty one", () => {
    expect(ignoredGhsas('overrides:\n  "a>b": "1.0.0"\n')).toEqual([]);
    expect(ignoredGhsas("auditConfig:\n  ignoreGhsas: []\n")).toEqual([]);
  });

  it("ignores GHSA ids that are not in the list", () => {
    const yaml = "# GHSA-1111-2222-3333 decided elsewhere\noverrides:\n  # GHSA-4444-5555-6666\n";
    expect(ignoredGhsas(yaml)).toEqual([]);
  });
});

describe("fixedAdvisories (WS-061)", () => {
  it("passes advisories whose every vulnerability has no patched version", () => {
    expect(
      fixedAdvisories([
        {
          ghsa_id: "GHSA-fc5q-39xc-vjpf",
          vulnerabilities: [{ first_patched_version: null }],
        },
      ]),
    ).toEqual([]);
  });

  it("names every advisory with a patched version for any of its vulnerabilities", () => {
    expect(
      fixedAdvisories([
        {
          ghsa_id: "GHSA-aaaa-bbbb-cccc",
          vulnerabilities: [{ first_patched_version: null }, { first_patched_version: "4.0.8" }],
        },
        { ghsa_id: "GHSA-dddd-eeee-ffff", vulnerabilities: [{ first_patched_version: null }] },
      ]),
    ).toEqual(["GHSA-aaaa-bbbb-cccc"]);
  });
});
