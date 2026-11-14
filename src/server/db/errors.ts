/** PostgreSQL error codes the services react to. */
export const UNIQUE_VIOLATION = "23505";
export const FOREIGN_KEY_VIOLATION = "23503";
/** What PostgreSQL 18 reports for a row still referenced through `on delete restrict`. */
export const RESTRICT_VIOLATION = "23001";

/** True if `error`, or an error it wraps, is a PostgreSQL error with this code. */
export function hasPostgresCode(error: unknown, code: string): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if ("code" in current && current.code === code) return true;
  }
  return false;
}

/**
 * True if a delete failed because another row still refers to the deleted one. PostgreSQL
 * reports a `restrict` foreign key as `23001` from version 18 and as `23503` before, so both
 * count (CI runs 18, local sandboxes may run 16).
 */
export function isReferenceViolation(error: unknown): boolean {
  return (
    hasPostgresCode(error, FOREIGN_KEY_VIOLATION) || hasPostgresCode(error, RESTRICT_VIOLATION)
  );
}
