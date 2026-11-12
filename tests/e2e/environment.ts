// Shared by playwright.config.ts and the prepare script. Local defaults, not secrets.

export const E2E_PORT = 3100;

export const E2E_BASE_URL = `http://localhost:${String(E2E_PORT)}`;

/** The database of the app under test. Override with E2E_DATABASE_URL (for example in CI). */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://opanel:opanel@localhost:5432/opanel_e2e_test";

export const E2E_DATABASE_SUFFIX = "_e2e_test";
