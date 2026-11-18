// Deletes what has expired (WS-066, canonical doc 0006 section 8). The operator schedules it,
// daily for example:
//   node dist/maintenance.mjs   (in the production image)
//   pnpm maintenance            (in development)
// Exit codes: 0 done, 1 failed, 2 wrong arguments.
import { pathToFileURL } from "node:url";

import type { MaintenanceResult } from "@/server/services/maintenance";

/** The command takes no arguments. */
export function parseMaintenanceArgs(argv: readonly string[]): boolean {
  return argv.length === 0;
}

/** The one line the command prints. */
export function maintenanceSummary(deleted: MaintenanceResult): string {
  return (
    `Deleted ${String(deleted.sessions)} expired sessions, ${String(deleted.links)} old links, ` +
    `${String(deleted.rateLimits)} rate-limit counters, ` +
    `${String(deleted.verifications)} verifications.`
  );
}

async function main(): Promise<number> {
  if (!parseMaintenanceArgs(process.argv.slice(2))) {
    console.error("Usage: maintenance");
    return 2;
  }

  // Imported here, so the arguments are checked before the environment is.
  const { closeDb } = await import("@/server/db/client");
  const { EnvValidationError } = await import("@/server/env");
  const { loadEnvFiles } = await import("@/server/env-files");
  const { describeError } = await import("@/server/http/safe-error");
  const { runMaintenance } = await import("@/server/services/maintenance");

  loadEnvFiles();
  try {
    process.stdout.write(`${maintenanceSummary(await runMaintenance())}\n`);
    return 0;
  } catch (error) {
    console.error(
      error instanceof EnvValidationError
        ? error.message
        : `Maintenance failed: ${describeError(error)}`,
    );
    return 1;
  } finally {
    await closeDb();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
