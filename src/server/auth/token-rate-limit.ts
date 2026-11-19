// Requests per API token (WT-05 decision 8, WS-072 section 6): a fixed window counted in the
// app's memory. v1 runs one app process (doc 0006 section 3), so the count is the whole
// install's; it is lost on restart, which only ever lets an agent through sooner.

export type RateDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export interface TokenRateLimiter {
  hit(tokenId: string): RateDecision;
  /** Drops the windows that have ended. Run every window by the shared instance. */
  sweep(): void;
  /** How many tokens have a window open (for tests). */
  size(): number;
}

export function createTokenRateLimiter({
  limit = 600,
  windowMs = 60_000,
  now = Date.now,
}: { limit?: number; windowMs?: number; now?: () => number } = {}): TokenRateLimiter {
  const windows = new Map<string, { start: number; count: number }>();

  return {
    hit(tokenId) {
      const time = now();
      const current = windows.get(tokenId);
      if (current === undefined || time >= current.start + windowMs) {
        windows.set(tokenId, { start: time, count: 1 });
        return { allowed: true };
      }
      if (current.count < limit) {
        current.count += 1;
        return { allowed: true };
      }
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.start + windowMs - time) / 1000)),
      };
    },
    sweep() {
      const time = now();
      for (const [tokenId, window] of windows) {
        if (time >= window.start + windowMs) windows.delete(tokenId);
      }
    },
    size: () => windows.size,
  };
}

const globalForLimiter = globalThis as typeof globalThis & {
  opanelTokenRateLimiter?: TokenRateLimiter;
};

/** The process's limiter, kept on `globalThis` like the event hub, swept every minute. */
export function getTokenRateLimiter(): TokenRateLimiter {
  if (globalForLimiter.opanelTokenRateLimiter === undefined) {
    const limiter = createTokenRateLimiter();
    setInterval(() => {
      limiter.sweep();
    }, 60_000).unref();
    globalForLimiter.opanelTokenRateLimiter = limiter;
  }
  return globalForLimiter.opanelTokenRateLimiter;
}
