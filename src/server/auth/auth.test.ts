import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it, vi } from "vitest";

import { createAuth } from "./auth";

const MARKER = "MARKER-session-token-MARKER";
const ENV = { BETTER_AUTH_SECRET: "x".repeat(32), APP_URL: "http://localhost:3000" };

describe("createAuth: Better Auth's errors in the log (WS-069)", () => {
  it("logs one describeError line, without the message, query or parameters", () => {
    const logError = vi.fn();
    const auth = createAuth(ENV, { logError });
    const cause = Object.assign(new Error(MARKER), { code: "42501" });
    const error = new DrizzleQueryError(`select 1 where token = $1 -- ${MARKER}`, [MARKER], cause);

    auth.options.onAPIError.onError(error);

    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith("Better Auth: DrizzleQueryError code=42501");
  });
});
