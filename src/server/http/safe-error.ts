// What a log line may say about an unexpected error (WS-042, AGENTS.md hard rule 7). The
// message of a failed query holds the query and its parameters in the installed ORM, so
// nothing is taken from free text: only a class name, an error code and a constraint name,
// each checked against a pattern, from the error and its causes.

import { DrizzleQueryError } from "drizzle-orm/errors";

const CLASS_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
/** A PostgreSQL SQLSTATE such as `23505`, or a Node system code such as `ECONNREFUSED`. */
const CODE = /^(?:[0-9A-Z]{5}|E[A-Z0-9_]{2,20})$/;
/** A schema identifier, such as `accounts_email_unique`: not data. */
const CONSTRAINT = /^[a-z0-9_]{1,63}$/;
const MAX_CAUSES = 5;

function classNameOf(error: Error): string {
  // The installed DrizzleQueryError keeps the generic name "Error", and the production build
  // minifies constructor names, so it is recognised by its class (WS-069).
  if (error instanceof DrizzleQueryError) return "DrizzleQueryError";
  return CLASS_NAME.test(error.name) ? error.name : "Error";
}

/** The error and its causes, at most MAX_CAUSES deep, each once. */
function chainOf(error: Error): object[] {
  const chain: object[] = [];
  let current: unknown = error;
  while (
    typeof current === "object" &&
    current !== null &&
    !chain.includes(current) &&
    chain.length <= MAX_CAUSES
  ) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

function firstMatching(chain: object[], field: string, pattern: RegExp): string | null {
  for (const link of chain) {
    const value: unknown = (link as Record<string, unknown>)[field];
    if (typeof value === "string" && pattern.test(value)) return value;
  }
  return null;
}

/**
 * A description of an error that is safe to log: `DrizzleQueryError code=23505
 * constraint=accounts_email_unique`. Never the message, stack, detail, query or parameters.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const chain = chainOf(error);
  const parts = [classNameOf(error)];
  const code = firstMatching(chain, "code", CODE);
  if (code !== null) parts.push(`code=${code}`);
  const constraint = firstMatching(chain, "constraint_name", CONSTRAINT);
  if (constraint !== null) parts.push(`constraint=${constraint}`);
  return parts.join(" ");
}
