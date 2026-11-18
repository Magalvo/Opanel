// The operator's way back in when no Admin can act (WS-065, canonical doc 0006 section 7):
// prints a one-time link for a human Admin. Runs on the server, never over HTTP:
//   node dist/recover-admin.mjs --email <admin email>   (in the production image)
//   pnpm admin:recover --email <admin email>            (in development)
// Exit codes: 0 the link was issued, 1 refused or failed, 2 wrong arguments.
import { pathToFileURL } from "node:url";

import { z } from "zod";

const USAGE = "Usage: recover-admin --email <admin email>";

/** The command's arguments, or null when they are not exactly `--email <address>`. */
export function parseRecoverAdminArgs(argv: readonly string[]): { email: string } | null {
  if (argv.length !== 2 || argv[0] !== "--email") return null;
  const email = z.email().safeParse(argv[1]);
  return email.success ? { email: email.data } : null;
}

async function main(): Promise<number> {
  const args = parseRecoverAdminArgs(process.argv.slice(2));
  if (args === null) {
    console.error(USAGE);
    return 2;
  }

  // Imported here, so the arguments are checked before the environment is.
  const { closeDb } = await import("@/server/db/client");
  const { EnvValidationError } = await import("@/server/env");
  const { loadEnvFiles } = await import("@/server/env-files");
  const { describeError } = await import("@/server/http/safe-error");
  const { issueOperatorResetLink, OperatorRefusal } =
    await import("@/server/services/account-management");

  loadEnvFiles();
  try {
    const link = await issueOperatorResetLink(args.email);
    // The link is the command's output: standard output, once (WS-065 question 3).
    process.stdout.write(`Reset link for ${args.email}, valid until ${link.expiresAt}:
`);
    process.stdout.write(`${link.url}
`);
    return 0;
  } catch (error) {
    if (error instanceof OperatorRefusal || error instanceof EnvValidationError) {
      console.error(error.message);
    } else {
      console.error(`The link was not issued: ${describeError(error)}`);
    }
    return 1;
  } finally {
    await closeDb();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
