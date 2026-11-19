// The production server's console writes an error only as describeError does (WS-069,
// AGENTS.md hard rule 7). Next.js prints an error thrown while rendering a page with its
// message and causes, and the message of a failed query holds its parameters, a session
// token among them. Text is not filtered: only Error values are replaced.

import type { Env } from "@/server/env";
import { describeError } from "@/server/http/safe-error";

const METHODS = ["error", "warn", "log", "info", "debug"] as const;

type ConsoleMethod = (...args: unknown[]) => void;
type ConsoleLike = Record<(typeof METHODS)[number], ConsoleMethod>;

const INSTALLED = Symbol.for("opanel.safeConsole");

/** The arguments with every Error replaced by its describeError; the rest as they are. */
export function safeConsoleArgs(args: readonly unknown[]): unknown[] {
  return args.map((arg) => (arg instanceof Error ? describeError(arg) : arg));
}

/**
 * In production, wraps the console's writing methods so they receive `safeConsoleArgs`.
 * Development and tests keep full errors. Returns whether it wrapped them now: never twice.
 */
export function installSafeConsole({
  nodeEnv,
  target = console,
}: {
  nodeEnv: Env["NODE_ENV"];
  target?: ConsoleLike;
}): boolean {
  if (nodeEnv !== "production") return false;
  const marked = target as ConsoleLike & { [INSTALLED]?: true };
  if (marked[INSTALLED]) return false;
  for (const method of METHODS) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]) => {
      original(...safeConsoleArgs(args));
    };
  }
  marked[INSTALLED] = true;
  return true;
}
