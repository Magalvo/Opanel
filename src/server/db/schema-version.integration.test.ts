import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, it, vi } from "vitest";

import { getDb } from "./client";
import * as schema from "./schema";
import { appliedSchemaVersion, KNOWN_MIGRATIONS, verifySchema } from "./schema-version";

const latest = KNOWN_MIGRATIONS.at(-1)?.when ?? 0;

class Rollback extends Error {}

describe("appliedSchemaVersion (WS-064 section 2)", () => {
  it("is the latest migration the test database has applied", async () => {
    expect(await appliedSchemaVersion(getDb())).toBe(latest);
  });

  it("is null when the migrations' table does not exist", async () => {
    let applied: number | null | undefined;
    await expect(
      getDb().transaction(async (tx) => {
        await tx.execute(sql`alter table drizzle.__drizzle_migrations rename to moved_away`);
        applied = await appliedSchemaVersion(tx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);

    expect(applied).toBeNull();
  });
});

describe("verifySchema (WS-064 section 3)", () => {
  it("does nothing when the schema matches", async () => {
    const exit = vi.fn<(code: number) => void>();
    const log = vi.fn<(message: string) => void>();

    await verifySchema({ db: getDb(), exit, log });

    expect(exit).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("logs the mismatch once and exits 1", async () => {
    const exit = vi.fn<(code: number) => void>();
    const log = vi.fn<(message: string) => void>();
    await expect(
      getDb().transaction(async (tx) => {
        await tx.execute(
          sql`insert into drizzle.__drizzle_migrations (hash, created_at) values ('future', ${latest + 1})`,
        );
        await verifySchema({ db: tx, exit, log });
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);

    expect(exit).toHaveBeenCalledWith(1);
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toContain("does not know");
  });

  it("retries a database it cannot read, then exits 1 without the URL", async () => {
    const client = postgres("postgres://opanel:a-secret-password@127.0.0.1:1/unreachable", {
      connect_timeout: 1,
      onnotice: () => undefined,
    });
    const exit = vi.fn<(code: number) => void>();
    const log = vi.fn<(message: string) => void>();
    try {
      await verifySchema({
        db: drizzle({ client, schema }),
        exit,
        log,
        retryEveryMs: 50,
        giveUpAfterMs: 300,
      });
    } finally {
      await client.end();
    }

    expect(exit).toHaveBeenCalledWith(1);
    const lines = log.mock.calls.map(([line]) => line).join("\n");
    expect(lines).toContain("Cannot read the database's schema version");
    expect(lines).not.toContain("a-secret-password");
    expect(lines).not.toContain("127.0.0.1");
  }, 15_000);
});
