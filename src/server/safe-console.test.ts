import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it, vi } from "vitest";

import { installSafeConsole, safeConsoleArgs } from "./safe-console";

const MARKER = "MARKER-session-token-MARKER";
const METHODS = ["error", "warn", "log", "info", "debug"] as const;

function fakeConsole() {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    log: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
}

describe("safeConsoleArgs (WS-069)", () => {
  it("writes an Error as its describeError, never its message, query or parameters", () => {
    const cause = Object.assign(new Error(MARKER), { code: "42501" });
    const error = new DrizzleQueryError(`select 1 where token = $1`, [MARKER], cause);

    const args = safeConsoleArgs(["⨯", error]);

    expect(args).toEqual(["⨯", "DrizzleQueryError code=42501"]);
    expect(JSON.stringify(args)).not.toContain(MARKER);
  });

  it("keeps text, numbers and other values as they are", () => {
    const value = { a: 1 };

    expect(safeConsoleArgs(["text %s", 3, value, null, undefined])).toEqual([
      "text %s",
      3,
      value,
      null,
      undefined,
    ]);
  });
});

describe("installSafeConsole (WS-069)", () => {
  it("in production, gives each method safe arguments", () => {
    const target = fakeConsole();
    const originals = { ...target };

    expect(installSafeConsole({ nodeEnv: "production", target })).toBe(true);

    for (const method of METHODS) {
      target[method]("a", new Error(MARKER));
      expect(originals[method]).toHaveBeenCalledWith("a", "Error");
    }
  });

  it("does not wrap a second time", () => {
    const target = fakeConsole();
    installSafeConsole({ nodeEnv: "production", target });
    const once = target.error;

    expect(installSafeConsole({ nodeEnv: "production", target })).toBe(false);
    expect(target.error).toBe(once);
  });

  it.each(["development", "test"] as const)("leaves the console alone in %s", (nodeEnv) => {
    const target = fakeConsole();
    const original = target.error;

    expect(installSafeConsole({ nodeEnv, target })).toBe(false);
    expect(target.error).toBe(original);
  });
});
