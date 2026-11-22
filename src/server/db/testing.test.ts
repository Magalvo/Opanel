import { describe, expect, it } from "vitest";

import { assertTestDatabaseUrl, workerDatabaseUrl } from "./testing";

describe("workerDatabaseUrl (WS-097)", () => {
  const base = "postgres://opanel:opanel@localhost:5432/opanel_test";

  it("puts the worker's number before the suffix", () => {
    expect(workerDatabaseUrl(base, "2")).toBe(
      "postgres://opanel:opanel@localhost:5432/opanel_w2_test",
    );
    expect(
      workerDatabaseUrl("postgres://opanel:opanel@localhost:5432/opanel_3f9a07c2_test", "12"),
    ).toBe("postgres://opanel:opanel@localhost:5432/opanel_3f9a07c2_w12_test");
  });

  it("keeps the name guard: the result ends in _test, and a non-test URL is refused", () => {
    expect(() => {
      assertTestDatabaseUrl(workerDatabaseUrl(base, "1"));
    }).not.toThrow();
    expect(() => workerDatabaseUrl("postgres://opanel:opanel@localhost:5432/opanel", "1")).toThrow(
      /must end in "_test"/,
    );
  });

  it.each([["0"], ["x"], ["-1"], ["1.5"], [""], [undefined]])(
    "refuses the pool ID %s",
    (poolId) => {
      expect(() => workerDatabaseUrl(base, poolId)).toThrow(/VITEST_POOL_ID/);
    },
  );
});

describe("assertTestDatabaseUrl", () => {
  it("accepts a database whose name ends in _test", () => {
    expect(() => {
      assertTestDatabaseUrl("postgres://opanel:opanel@localhost:5432/opanel_test");
    }).not.toThrow();
  });

  it("ignores query parameters when reading the database name", () => {
    expect(() => {
      assertTestDatabaseUrl("postgres://opanel:opanel@localhost:5432/opanel_test?sslmode=disable");
    }).not.toThrow();
  });

  it.each([
    ["the development database", "postgres://opanel:opanel@localhost:5432/opanel"],
    ["a name that only contains _test", "postgres://opanel:opanel@localhost:5432/opanel_test_copy"],
    ["a URL without a database name", "postgres://opanel:opanel@localhost:5432"],
    ["something that is not a URL", "opanel_test"],
  ])("rejects %s", (_label, url) => {
    expect(() => {
      assertTestDatabaseUrl(url);
    }).toThrow(/must end in "_test"/);
  });

  it("does not echo the URL in the error", () => {
    const url = "postgres://admin:sup3r-s3cret@db.internal:5432/production";

    let message = "";
    try {
      assertTestDatabaseUrl(url);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toBe("");
    expect(message).not.toContain("sup3r-s3cret");
    expect(message).not.toContain("db.internal");
  });
});
