import { sql } from "drizzle-orm";

import type { HealthResponse } from "@/lib/schemas/health";

/** The one database capability the health check needs. */
export interface HealthProbeTarget {
  execute(query: ReturnType<typeof sql>): PromiseLike<unknown>;
}

export interface CheckHealthOptions {
  /** How long to wait for the database before reporting it as down. */
  timeoutMs?: number;
  /** Receives a short description of a failed check. Never part of the response. */
  logError?: (message: string) => void;
}

const DEFAULT_TIMEOUT_MS = 2000;

class HealthCheckTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`no answer within ${String(timeoutMs)} ms`);
    this.name = "HealthCheckTimeoutError";
  }
}

/**
 * Reports whether the database answers a trivial query in time.
 * Never throws: every failure becomes a "degraded" result.
 */
export async function checkHealth(
  db: HealthProbeTarget,
  { timeoutMs = DEFAULT_TIMEOUT_MS, logError = console.error }: CheckHealthOptions = {},
): Promise<HealthResponse> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new HealthCheckTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    await Promise.race([db.execute(sql`select 1`), timeout]);
    return { status: "ok", database: "up" };
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
    logError(`Health check failed: database unreachable (${reason})`);
    return { status: "degraded", database: "down" };
  } finally {
    clearTimeout(timer);
  }
}
