import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";

import { describeError } from "./safe-error";

const MARKER = "MARKER-hunter2-MARKER";

/** An error with extra own fields, as a driver builds one. */
function withFields(fields: Record<string, unknown>, base = new Error(MARKER)): Error {
  return Object.assign(base, fields);
}

describe("describeError (WS-042)", () => {
  it("never repeats the message", () => {
    expect(describeError(new Error(MARKER))).toBe("Error");
    expect(describeError(new TypeError(MARKER))).toBe("TypeError");
  });

  it("names a DrizzleQueryError without its query or parameters", () => {
    const error = new DrizzleQueryError(`insert into x values ($1) -- ${MARKER}`, [MARKER]);

    expect(describeError(error)).toBe("DrizzleQueryError");
  });

  it("adds an allowed code and constraint from the cause chain, two levels down", () => {
    const driver = withFields({
      code: "23505",
      constraint_name: "accounts_email_unique",
      detail: `Key (email)=(${MARKER}) already exists.`,
    });
    const middle = new Error(MARKER, { cause: driver });
    const top = new DrizzleQueryError(MARKER, [MARKER], middle);

    expect(describeError(top)).toBe(
      "DrizzleQueryError code=23505 constraint=accounts_email_unique",
    );
  });

  it("takes a Node system code", () => {
    expect(describeError(withFields({ code: "ECONNREFUSED" }))).toBe("Error code=ECONNREFUSED");
  });

  it.each([
    ["hello world", "x y"],
    ["<b>", "has spaces in it"],
    ["23505 ", "Capital_letters"],
    [MARKER, MARKER],
  ])("leaves out a code %j and a constraint %j that are not identifiers", (code, constraint) => {
    expect(describeError(withFields({ code, constraint_name: constraint }))).toBe("Error");
  });

  it("falls back to Error for a class name that is not a plain identifier", () => {
    for (const name of ["Not An Identifier", "Bad\nName", "A".repeat(65), MARKER]) {
      const error = new Error("x");
      error.name = name;
      expect(describeError(error), JSON.stringify(name)).toBe("Error");
    }
  });

  it("ends on a cyclic cause chain", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    Object.assign(a, { cause: b });

    expect(describeError(a)).toBe("Error");
  });

  it("says unknown error for anything that is not an Error", () => {
    for (const value of [MARKER, null, undefined, 42, { message: MARKER }]) {
      expect(describeError(value)).toBe("unknown error");
    }
  });
});
