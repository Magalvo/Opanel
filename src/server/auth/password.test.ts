import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password";

const password = "correct horse battery staple";

describe("hashPassword", () => {
  it("returns an Argon2id hash with at least the OWASP minimum parameters", async () => {
    const hash = await hashPassword(password);
    const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(hash);

    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(19456);
    expect(Number(match?.[2])).toBeGreaterThanOrEqual(2);
    expect(hash).not.toContain(password);
  });

  it("produces a different hash each time", async () => {
    expect(await hashPassword(password)).not.toBe(await hashPassword(password));
  });
});

describe("verifyPassword", () => {
  it("accepts the right password and rejects a wrong one", async () => {
    const hash = await hashPassword(password);

    expect(await verifyPassword({ hash, password })).toBe(true);
    expect(await verifyPassword({ hash, password: "wrong password!" })).toBe(false);
  });

  it("returns false, without throwing, for an empty password or a malformed hash", async () => {
    const hash = await hashPassword(password);

    expect(await verifyPassword({ hash, password: "" })).toBe(false);
    expect(await verifyPassword({ hash: "", password })).toBe(false);
    expect(await verifyPassword({ hash: "garbage", password })).toBe(false);
    expect(await verifyPassword({ hash: hash.slice(0, 40), password })).toBe(false);
  });
});
