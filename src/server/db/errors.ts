/** PostgreSQL error codes the services react to. */
export const UNIQUE_VIOLATION = "23505";
export const FOREIGN_KEY_VIOLATION = "23503";

/** True if `error`, or an error it wraps, is a PostgreSQL error with this code. */
export function hasPostgresCode(error: unknown, code: string): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if ("code" in current && current.code === code) return true;
  }
  return false;
}
