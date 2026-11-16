import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, it, vi } from "vitest";

import { getDb } from "@/server/db/client";

import { checkHealth } from "./health";

describe("checkHealth against PostgreSQL", () => {
  it("reports ok for the real test database", async () => {
    await expect(checkHealth(getDb())).resolves.toEqual({ status: "ok", database: "up" });
  });

  it("reports degraded for a database that cannot be reached", async () => {
    // Port 1 on localhost: nothing listens there, so the connection is refused.
    const client = postgres("postgres://opanel:opanel@127.0.0.1:1/opanel_test", {
      connect_timeout: 1,
    });
    const logError = vi.fn();

    try {
      const result = await checkHealth(drizzle({ client }), { logError });

      expect(result).toEqual({ status: "degraded", database: "down" });
      expect(logError).toHaveBeenCalledOnce();
    } finally {
      await client.end({ timeout: 1 });
    }
  });

  it("logs a failed check without the query or the error's message (WS-042)", async () => {
    const marker = "MARKER-hunter2-MARKER";
    const logError = vi.fn<(message: string) => void>();
    const failing = {
      execute: () =>
        Promise.reject(
          Object.assign(new Error(`Failed query: select 1 -- ${marker}`), { code: "57P01" }),
        ),
    };

    const result = await checkHealth(failing, { logError });

    expect(result).toEqual({ status: "degraded", database: "down" });
    expect(logError).toHaveBeenCalledWith(
      "Health check failed: database unreachable (Error code=57P01)",
    );
  });

  it("names a refused connection without the host, the user or the query", async () => {
    const client = postgres("postgres://opanel:opanel@127.0.0.1:1/opanel_test", {
      connect_timeout: 1,
    });
    const logError = vi.fn<(message: string) => void>();

    try {
      await checkHealth(drizzle({ client }), { logError });

      const line = logError.mock.calls[0]?.[0] ?? "";
      expect(line).toMatch(
        /^Health check failed: database unreachable \([A-Za-z]+( code=[A-Z0-9_]+)?\)$/,
      );
      expect(line).not.toContain("127.0.0.1");
      expect(line).not.toContain("opanel");
      expect(line).not.toContain("select");
    } finally {
      await client.end({ timeout: 1 });
    }
  });
});
