// Real failures of the installed ORM and driver (WS-042): a hand-built error with harmless
// text would not show what they really put in their messages.
import { describe, expect, it } from "vitest";

import { getDb } from "@/server/db/client";
import { accounts, credentials } from "@/server/db/schema";

import { describeError } from "./safe-error";

const MARKER = "markerhunter2marker";
const NO_ACCOUNT = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

async function failureOf(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("expected an Error");
  }
  throw new Error("expected the query to fail");
}

describe("describeError on real database failures", () => {
  it("names a duplicate email by code and constraint, without the email or the SQL", async () => {
    const email = `${MARKER}@example.com`;
    const insert = () =>
      getDb().insert(accounts).values({ kind: "human", name: "Ada", email, role: "member" });
    await insert();

    const error = await failureOf(insert);
    const text = describeError(error);

    // The audit's finding, on the installed versions: the message holds the query and the email.
    expect(error.message).toContain("insert into");
    expect(error.message).toContain(MARKER);
    expect(text).toMatch(/^DrizzleQueryError code=23505 constraint=[a-z0-9_]+$/);
    expect(text).not.toContain(MARKER);
    expect(text).not.toContain("example.com");
    expect(text).not.toContain("insert");
  });

  it("does not log a password hash from a failed insert", async () => {
    const hash = ["", "argon2id", "v=19", "m=19456,t=2,p=1", MARKER].join("$");
    const error = await failureOf(() =>
      getDb().insert(credentials).values({
        accountId: NO_ACCOUNT,
        providerId: "credential",
        providerAccountId: NO_ACCOUNT,
        passwordHash: hash,
      }),
    );
    const text = describeError(error);

    expect(error.message).toContain(MARKER);
    expect(text).toMatch(/^DrizzleQueryError code=23503 constraint=[a-z0-9_]+$/);
    expect(text).not.toContain(MARKER);
    expect(text).not.toContain("argon2");
  });
});
