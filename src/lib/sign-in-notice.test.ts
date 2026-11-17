import { describe, expect, it } from "vitest";

import { signInNotice } from "./sign-in-notice";

describe("signInNotice (WS-057)", () => {
  it("maps the two known notices to their messages", () => {
    expect(signInNotice("password-set")).toBe("Your password is set. Sign in with it.");
    expect(signInNotice("admin-created")).toBe(
      "The administrator was created. Sign in with your password.",
    );
  });

  it.each([["anything else"], [""], [["password-set"]], [undefined], ["<b>hi</b>"]])(
    "maps %j to no message",
    (value) => {
      expect(signInNotice(value)).toBeNull();
    },
  );
});
