import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDb } from "@/server/db/client";
import { accounts, credentials } from "@/server/db/schema";

import { describeError } from "./safe-error";

const MARKER = "marker-7f3a9c";

/** The error a failing statement really throws: the ORM's, with the driver's as its cause. */
async function failureOf(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error("The statement was expected to fail.");
}

describe("describeError with real database errors", () => {
  it("reports a unique violation by code and constraint, with no email and no SQL", async () => {
    const db = getDb();
    const email = `${MARKER}@example.com`;
    await db.insert(accounts).values({ kind: "human", name: "First", email, role: "member" });

    const error = await failureOf(() =>
      db.insert(accounts).values({ kind: "human", name: "Second", email, role: "member" }),
    );
    // The premise of the audit: the ORM puts the parameters in the message.
    expect(error instanceof Error ? error.message : "").toContain(email);

    const described = describeError(error);

    expect(described).toMatch(/^DrizzleQueryError code=23505 constraint=[a-z0-9_]+$/);
    expect(described).not.toContain(MARKER);
    expect(described).not.toContain("insert");
  });

  it("does not repeat a password hash passed as a parameter", async () => {
    const db = getDb();
    const hash = `$argon2id$v=19$m=19456,t=2,p=1$${MARKER}`;

    const error = await failureOf(() =>
      db.insert(credentials).values({
        accountId: crypto.randomUUID(),
        providerId: "credential",
        providerAccountId: crypto.randomUUID(),
        passwordHash: hash,
      }),
    );
    expect(error instanceof Error ? error.message : "").toContain(MARKER);

    const described = describeError(error);

    expect(described).toMatch(/^DrizzleQueryError code=23503 constraint=[a-z0-9_]+$/);
    expect(described).not.toContain(MARKER);
    expect(described).not.toContain("argon2");
    expect(await db.select().from(credentials).where(eq(credentials.passwordHash, hash))).toEqual(
      [],
    );
  });
});
