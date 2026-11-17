import { describe, expect, it, vi } from "vitest";

import { serverBusy } from "@/server/http/errors";

import type * as HashGate from "./hash-gate";
import { hashPassword, verifyPassword } from "./password";

// The process gate, real unless a test fills it (WS-056).
const gateState = vi.hoisted(() => ({ full: false }));
vi.mock("./hash-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof HashGate>();
  return {
    ...actual,
    hashGate: {
      run: <T>(task: () => Promise<T>): Promise<T> =>
        gateState.full ? Promise.reject(serverBusy()) : actual.hashGate.run(task),
    },
  };
});

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

describe("through the hash gate (WS-056)", () => {
  it("hashing and verifying reject with 429 server_busy while the gate is full", async () => {
    const hash = await hashPassword(password);
    gateState.full = true;
    try {
      await expect(hashPassword(password)).rejects.toMatchObject({
        status: 429,
        code: "server_busy",
      });
      // A busy server must not look like a wrong password.
      await expect(verifyPassword({ hash, password })).rejects.toMatchObject({
        status: 429,
        code: "server_busy",
      });
    } finally {
      gateState.full = false;
    }
    expect(await verifyPassword({ hash, password })).toBe(true);
  });
});
