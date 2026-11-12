import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Loads `.env` files for code that runs outside Next.js (scripts, drizzle-kit, tests).
 * Next.js loads them by itself. Variables already set in the environment always win.
 *
 * - NODE_ENV=test: `.env.test` only, so tests never pick up development settings.
 * - otherwise: `.env.local`, then `.env`.
 */
export function loadEnvFiles(directory: string = process.cwd()): void {
  const names = process.env.NODE_ENV === "test" ? [".env.test"] : [".env.local", ".env"];
  for (const name of names) {
    const file = path.join(directory, name);
    if (existsSync(file)) {
      process.loadEnvFile(file);
    }
  }
}
