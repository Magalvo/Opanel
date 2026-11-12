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
});
