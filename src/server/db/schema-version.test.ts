import { describe, expect, it } from "vitest";

import { compareSchema, schemaMismatchMessage } from "./schema-version";

const known = [
  { tag: "0012_comments_append_only", when: 1_000 },
  { tag: "0013_one_unused_link", when: 2_000 },
  { tag: "0014_runtime_role", when: 3_000 },
];

describe("compareSchema (WS-064 section 2)", () => {
  it("matches when the database's last migration is the app's last", () => {
    expect(compareSchema(known, 3_000)).toEqual({ kind: "match" });
  });

  it("is behind when the database lacks the latest migrations", () => {
    expect(compareSchema(known, 2_000)).toEqual({
      kind: "behind",
      last: "0013_one_unused_link",
      needed: "0014_runtime_role",
    });
  });

  it("is behind with no last migration on an empty database", () => {
    expect(compareSchema(known, null)).toEqual({
      kind: "behind",
      last: null,
      needed: "0014_runtime_role",
    });
  });

  it("is ahead when the database has a migration the app does not know", () => {
    const later = Date.UTC(2026, 10, 20, 10);
    expect(compareSchema(known, later)).toEqual({
      kind: "ahead",
      last: "0014_runtime_role",
      appliedAt: "2026-11-20T10:00:00.000Z",
    });
  });
});

describe("schemaMismatchMessage", () => {
  it("names the database's last migration and the one needed, and says to run migrate", () => {
    expect(
      schemaMismatchMessage({
        kind: "behind",
        last: "0013_one_unused_link",
        needed: "0014_runtime_role",
      }),
    ).toBe(
      "The database schema is behind this version of Opanel: its last migration is " +
        "0013_one_unused_link, this version needs 0014_runtime_role. Run migrate first.",
    );
  });

  it("says when no migration has been applied", () => {
    expect(schemaMismatchMessage({ kind: "behind", last: null, needed: "0014_runtime_role" })).toBe(
      "The database schema is behind this version of Opanel: no migration has been " +
        "applied, this version needs 0014_runtime_role. Run migrate first.",
    );
  });

  it("names the app's last migration and when the unknown one was applied", () => {
    expect(
      schemaMismatchMessage({
        kind: "ahead",
        last: "0014_runtime_role",
        appliedAt: "2026-11-20T10:00:00.000Z",
      }),
    ).toBe(
      "The database has a migration this version of Opanel does not know, applied at " +
        "2026-11-20T10:00:00.000Z; this version's last is 0014_runtime_role. Run the version " +
        "that applied it, or restore the backup taken before the upgrade.",
    );
  });
});
