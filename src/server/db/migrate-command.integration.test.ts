import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, it, vi } from "vitest";

import { getDb } from "./client";
import { migrateCommand } from "./migrate-command";
import * as schema from "./schema";

describe("migrateCommand (WS-062 section 3)", () => {
  it("applies the migrations, says so and answers 0, again and again", async () => {
    const log = vi.fn<(message: string) => void>();

    expect(await migrateCommand({ db: getDb(), log, logError: vi.fn() })).toBe(0);
    expect(await migrateCommand({ db: getDb(), log, logError: vi.fn() })).toBe(0);

    expect(log).toHaveBeenCalledWith("Migrations are up to date.");
  });

  it("answers 1 when the database cannot be reached, and logs no secret or address", async () => {
    const url = "postgres://opanel:a-secret-password@127.0.0.1:1/unreachable";
    const client = postgres(url, { connect_timeout: 2, onnotice: () => undefined });
    const db = drizzle({ client, schema });
    const logError = vi.fn<(message: string) => void>();

    try {
      expect(await migrateCommand({ db, log: vi.fn(), logError })).toBe(1);
    } finally {
      await client.end();
    }

    expect(logError).toHaveBeenCalledOnce();
    const [message] = logError.mock.calls[0] ?? [""];
    expect(message).toMatch(/^Migrations failed: /);
    expect(message).not.toContain("a-secret-password");
    expect(message).not.toContain("127.0.0.1");
    expect(message).not.toContain("unreachable");
  });
});
