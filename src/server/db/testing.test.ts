import { afterEach, describe, expect, it, vi } from "vitest";

import { assertTestDatabaseUrl, useWorktreeTestDatabase } from "./testing";

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

describe("useWorktreeTestDatabase", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("puts the worktree's ID in DATABASE_URL, once", () => {
    vi.stubEnv("OPANEL_WORKTREE", "wt7");
    vi.stubEnv("DATABASE_URL", "postgres://opanel:opanel@localhost:5432/opanel_test");
    useWorktreeTestDatabase();
    useWorktreeTestDatabase();
    expect(process.env.DATABASE_URL).toBe(
      "postgres://opanel:opanel@localhost:5432/opanel_wt7_test",
    );
  });
});
