import { describe, expect, it } from "vitest";

import { parseRecoverAdminArgs } from "./recover-admin";

describe("parseRecoverAdminArgs (WS-065 section 3)", () => {
  it("reads --email", () => {
    expect(parseRecoverAdminArgs(["--email", "admin@example.com"])).toEqual({
      email: "admin@example.com",
    });
  });

  it.each([
    [[]],
    [["--email"]],
    [["--email", ""]],
    [["--email", "not-an-email"]],
    [["admin@example.com"]],
    [["--email", "admin@example.com", "--force"]],
    [["--mail", "admin@example.com"]],
  ])("asks for the usage for %j", (argv) => {
    expect(parseRecoverAdminArgs(argv)).toBeNull();
  });
});
