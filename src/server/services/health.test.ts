import { describe, expect, it, vi } from "vitest";

import { checkHealth } from "./health";

describe("checkHealth", () => {
  it("reports degraded when the query outlasts the timeout, without hanging", async () => {
    const logError = vi.fn();
    const neverAnswers = { execute: () => new Promise<never>(() => undefined) };

    const startedAt = Date.now();
    const result = await checkHealth(neverAnswers, { timeoutMs: 50, logError });

    expect(result).toEqual({ status: "degraded", database: "down" });
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(logError).toHaveBeenCalledOnce();
  });

  it("reports degraded when the query rejects, and does not throw", async () => {
    const logError = vi.fn();
    const failing = { execute: () => Promise.reject(new Error("connection refused")) };

    await expect(checkHealth(failing, { logError })).resolves.toEqual({
      status: "degraded",
      database: "down",
    });
  });

  it("reports ok when the query answers", async () => {
    const answering = { execute: () => Promise.resolve([{ one: 1 }]) };

    await expect(checkHealth(answering)).resolves.toEqual({ status: "ok", database: "up" });
  });
});
