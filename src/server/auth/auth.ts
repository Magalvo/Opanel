import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/schemas/auth";
import { getDb } from "@/server/db/client";
import { accounts, credentials, sessions, verification } from "@/server/db/schema";
import { type Env, getEnv } from "@/server/env";

import { hashPassword, verifyPassword } from "./password";

const DAY_SECONDS = 24 * 60 * 60;

/** The configuration this code needs from the environment. */
type AuthEnv = Pick<Env, "BETTER_AUTH_SECRET" | "APP_URL">;

/** Builds a Better Auth instance. Application code uses `getAuth()`; tests pass their own env. */
export function createAuth(env: AuthEnv) {
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
    // Opanel contains no calls to outside services (AGENTS.md section 1).
    telemetry: { enabled: false },
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: { accounts, credentials, sessions, verification },
    }),
    advanced: {
      database: { generateId: "uuid" },
      cookiePrefix: "opanel",
      // `Secure` whenever the app is served over https (canonical doc 0001 section 4).
      useSecureCookies: new URL(env.APP_URL).protocol === "https:",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    },
    // Better Auth's `user`, `session` and `account` models are Opanel's `accounts`,
    // `sessions` and `credentials` (WT-02 decision 2). `fields` maps Better Auth's field
    // names to the property names of the Drizzle tables.
    user: {
      modelName: "accounts",
      additionalFields: {
        kind: { type: "string", required: false, defaultValue: "human", input: false },
        role: { type: "string", required: true, input: false },
      },
    },
    session: {
      modelName: "sessions",
      fields: { userId: "accountId" },
      expiresIn: 7 * DAY_SECONDS,
      updateAge: DAY_SECONDS,
    },
    account: {
      modelName: "credentials",
      fields: { userId: "accountId", accountId: "providerAccountId", password: "passwordHash" },
    },
    emailAndPassword: {
      enabled: true,
      // Accounts come from the first-run setup or an invitation, never from open sign-up.
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      password: { hash: hashPassword, verify: verifyPassword },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

const store = globalThis as typeof globalThis & { __opanelAuth?: Auth };

/**
 * Better Auth, used server-side only: its own HTTP handler is not mounted (WT-02 decision
 * 1). Created on first call, so importing this module reads no environment.
 */
export function getAuth(): Auth {
  store.__opanelAuth ??= createAuth(getEnv());
  return store.__opanelAuth;
}
