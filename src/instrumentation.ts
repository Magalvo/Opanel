/**
 * Runs once when the Next.js server starts, before it accepts requests.
 * Validates configuration so a bad environment stops the server immediately, then checks
 * that the database's schema is the one this build was made for (WS-064).
 */
export async function register(): Promise<void> {
  // NEXT_RUNTIME is a framework constant that Next.js inlines at build time, so it must be
  // read literally here rather than through the validated env module.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { EnvValidationError, getEnv, productionWarnings } = await import("@/server/env");
    try {
      for (const warning of productionWarnings(getEnv())) {
        console.warn(`Warning: ${warning}`);
      }
    } catch (error) {
      if (error instanceof EnvValidationError) {
        // `next start` only logs an error thrown here and keeps running, so exit explicitly.
        console.error(error.message);
        process.exit(1);
      }
      throw error;
    }

    // Only on the schema this build was made for (WS-064): stops the server otherwise.
    const { getDb } = await import("@/server/db/client");
    const { verifySchema } = await import("@/server/db/schema-version");
    await verifySchema({
      db: getDb(),
      exit: (code) => {
        process.exit(code);
      },
    });
  }
}
