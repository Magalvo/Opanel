// Shared by playwright.config.ts and the prepare script. Local defaults, not secrets.

export const E2E_PORT = 3100;

export const E2E_BASE_URL = `http://localhost:${String(E2E_PORT)}`;

/** The database of the app under test. Override with E2E_DATABASE_URL (for example in CI). */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://opanel:opanel@localhost:5432/opanel_e2e_test";

export const E2E_DATABASE_SUFFIX = "_e2e_test";

/**
 * The same database as the app under test reaches it: as the runtime test role, a login
 * member of `opanel_app` (WS-063). `prepare.ts` creates the role; E2E_DATABASE_URL stays the
 * owner, for migrations and for seeding.
 */
export const E2E_APP_DATABASE_URL = (() => {
  const url = new URL(E2E_DATABASE_URL);
  url.username = "opanel_app_test";
  url.password = "opanel_app_test";
  return url.toString();
})();

/** Placeholder session secret for the app under test. Not a secret: the database is a throwaway. */
export const E2E_AUTH_SECRET = "e2e-secret-only-for-playwright-0123456789abcdef";

/**
 * Placeholder setup token for the app under test, which runs in production mode and so
 * refuses the first-run setup without one (WS-055). Not a secret: the database is a throwaway.
 */
export const E2E_SETUP_TOKEN = "e2e-setup-token-only-for-playwright-0123456789";
