import { describe, expect, it } from "vitest";

import { hasPostgresCode, isReferenceViolation } from "./errors";

function postgresError(code: string): Error {
  return Object.assign(new Error("db"), { code });
}

describe("PostgreSQL error codes", () => {
  it("finds a code on the error or on an error it wraps", () => {
    const wrapped = new Error("Failed query", { cause: postgresError("23505") });

    expect(hasPostgresCode(postgresError("23505"), "23505")).toBe(true);
    expect(hasPostgresCode(wrapped, "23505")).toBe(true);
    expect(hasPostgresCode(wrapped, "23503")).toBe(false);
    expect(hasPostgresCode("23505", "23505")).toBe(false);
  });

  it("treats a restrict violation as a reference violation (PostgreSQL 18 reports 23001, earlier versions 23503)", () => {
    for (const code of ["23503", "23001"]) {
      expect(
        isReferenceViolation(new Error("Failed query", { cause: postgresError(code) })),
        code,
      ).toBe(true);
    }
    expect(isReferenceViolation(postgresError("23505"))).toBe(false);
  });
});
