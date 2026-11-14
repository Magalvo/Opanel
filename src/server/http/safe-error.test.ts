import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";

import { describeError } from "./safe-error";

const MARKER = "marker-7f3a9c";

describe("describeError", () => {
  it("names the class of a plain error and leaves its message out", () => {
    expect(describeError(new Error(`secret ${MARKER}`))).toBe("Error");
    expect(describeError(new TypeError(`secret ${MARKER}`))).toBe("TypeError");
  });

  it("leaves the query and the parameters of a failed query out", () => {
    const error = new DrizzleQueryError(
      `insert into credentials (password_hash) values ($1)`,
      [MARKER],
      new Error(`Key (email)=(${MARKER}) already exists`),
    );

    const described = describeError(error);

    expect(described).toBe("DrizzleQueryError");
    expect(error.message).toContain(MARKER);
    expect(described).not.toContain(MARKER);
    expect(described).not.toContain("insert");
  });

  it("reports the database code and constraint found down the cause chain", () => {
    const driverError = Object.assign(new Error(`duplicate key ${MARKER}`), {
      code: "23505",
      constraint_name: "accounts_email_unique",
      detail: `Key (email)=(${MARKER}) already exists.`,
    });
    const wrapped = new DrizzleQueryError(
      "select 1",
      [],
      new Error("middle", { cause: driverError }),
    );

    expect(describeError(wrapped)).toBe(
      "DrizzleQueryError code=23505 constraint=accounts_email_unique",
    );
  });

  it("reports a system error code", () => {
    const error = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), {
      code: "ECONNREFUSED",
    });

    expect(describeError(error)).toBe("Error code=ECONNREFUSED");
  });

  it("drops a code or a constraint that is not on the allow-list", () => {
    const error = Object.assign(new Error("x"), {
      code: "<script>alert(1)</script>",
      constraint_name: "has spaces and 'quotes'",
    });

    expect(describeError(error)).toBe("Error");
    expect(describeError(Object.assign(new Error("x"), { code: "hello world" }))).toBe("Error");
  });

  it("replaces an unsafe class name with Error", () => {
    for (const name of ["has spaces", "line\nbreak", "a".repeat(65), "1starts-with-digit", ""]) {
      const error = new Error("x");
      error.name = name;
      expect(describeError(error)).toBe("Error");
    }
  });

  it("ends on a cyclic cause chain and ignores anything beyond five levels", () => {
    const cyclic = new Error("a");
    cyclic.cause = cyclic;
    expect(describeError(cyclic)).toBe("Error");

    let deep: Error = Object.assign(new Error("deep"), { code: "23505" });
    for (let level = 0; level < 6; level += 1) {
      deep = new Error("wrapper", { cause: deep });
    }
    expect(describeError(deep)).toBe("Error");
  });

  it("describes a value that is not an error as unknown", () => {
    for (const value of ["a string " + MARKER, null, undefined, 42, { code: "23505" }]) {
      expect(describeError(value)).toBe("unknown error");
    }
  });
});
