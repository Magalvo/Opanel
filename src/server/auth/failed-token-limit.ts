// Failed API token attempts per client address (WS-125): a fixed window counted in the app's
// memory, like the per-token limit (WS-072). v1 runs one app process (doc 0006 section 3);
// a restart only ever lets a client through sooner.

import { isIPv4 } from "node:net";

import { clientIpFrom } from "@/server/http/client-ip";

/**
 * `begin` takes a unit before the token is looked up. An allowed attempt whose token then
 * authenticates gives it back with `succeeded`, so only failures stay counted.
 */
export type FailedTokenDecision =
  | { allowed: true; key: string; succeeded: () => void }
  | { allowed: false; key: string; retryAfterSeconds: number; firstRefusal: boolean };

export interface FailedTokenLimiter {
  begin(key: string): FailedTokenDecision;
  /** Drops the windows that have ended. Run every minute by the shared instance. */
  sweep(): void;
  /** How many keys have a window open (for tests). */
  size(): number;
  /** The keys that have a window open (for tests). */
  keys(): string[];
}

/** The key that addresses share once `maxKeys` addresses have a window of their own. */
export const OVERFLOW_KEY = "overflow";
/** The key of every request whose configured address header holds no address. */
export const UNKNOWN_KEY = "unknown";

interface Window {
  start: number;
  count: number;
  refused: boolean;
}

export function createFailedTokenLimiter({
  limit = 30,
  windowMs = 60_000,
  maxKeys = 10_000,
  now = Date.now,
}: {
  limit?: number;
  windowMs?: number;
  maxKeys?: number;
  now?: () => number;
} = {}): FailedTokenLimiter {
  const windows = new Map<string, Window>();

  function openWindow(key: string, time: number): { key: string; window: Window } {
    const current = windows.get(key);
    if (current !== undefined && time < current.start + windowMs) return { key, window: current };
    if (current === undefined && key !== OVERFLOW_KEY && windows.size >= maxKeys) {
      return openWindow(OVERFLOW_KEY, time);
    }
    const window = { start: time, count: 0, refused: false };
    windows.set(key, window);
    return { key, window };
  }

  return {
    begin(requested) {
      const time = now();
      const { key, window } = openWindow(requested, time);
      if (window.count < limit) {
        window.count += 1;
        let given = false;
        return {
          allowed: true,
          key,
          succeeded: () => {
            // Never into a later window, and only once.
            if (given || windows.get(key) !== window) return;
            given = true;
            window.count -= 1;
          },
        };
      }
      const firstRefusal = !window.refused;
      window.refused = true;
      return {
        allowed: false,
        key,
        retryAfterSeconds: Math.max(1, Math.ceil((window.start + windowMs - time) / 1000)),
        firstRefusal,
      };
    },
    sweep() {
      const time = now();
      for (const [key, window] of windows) {
        if (time >= window.start + windowMs) windows.delete(key);
      }
    },
    size: () => windows.size,
    keys: () => [...windows.keys()],
  };
}

/** The eight groups of an IPv6 address, each as four hex digits. */
function ipv6Groups(address: string): string[] {
  let text = address.split("%")[0] ?? "";
  // An embedded IPv4 tail (`::ffff:203.0.113.9`) becomes two groups.
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (tail !== null) {
    const [a, b, c, d] = tail.slice(1).map(Number) as [number, number, number, number];
    const hex = (n: number) => n.toString(16);
    text = `${text.slice(0, tail.index)}${hex((a << 8) | b)}:${hex((c << 8) | d)}`;
  }
  const [head = "", rest] = text.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = rest === undefined || rest === "" ? [] : rest.split(":");
  const middle = rest === undefined ? [] : Array<string>(8 - left.length - right.length).fill("0");
  return [...left, ...middle, ...right].map((group) => group.toLowerCase().padStart(4, "0"));
}

/**
 * The limiter key of a token request (WS-125 section 3), or null when no address header is
 * configured: then nothing the client sends is trusted, and there is no limit. Never any
 * part of the `Authorization` header.
 */
export function failedTokenKey(request: Request, headerName: string | undefined): string | null {
  if (headerName === undefined) return null;
  const address = clientIpFrom(request, headerName);
  if (address === null) return UNKNOWN_KEY;
  if (isIPv4(address)) return `ip:${address}`;

  const groups = ipv6Groups(address);
  if (groups.slice(0, 5).every((group) => group === "0000") && groups[5] === "ffff") {
    const [high = 0, low = 0] = groups.slice(6).map((group) => parseInt(group, 16));
    return `ip:${String(high >> 8)}.${String(high & 255)}.${String(low >> 8)}.${String(low & 255)}`;
  }
  return `ip6:${groups.slice(0, 4).join(":")}::/64`;
}

const globalForLimiter = globalThis as typeof globalThis & {
  opanelFailedTokenLimiter?: FailedTokenLimiter;
};

/** The process's limiter, kept on `globalThis` like the per-token one, swept every minute. */
export function getFailedTokenLimiter(): FailedTokenLimiter {
  if (globalForLimiter.opanelFailedTokenLimiter === undefined) {
    const limiter = createFailedTokenLimiter();
    setInterval(() => {
      limiter.sweep();
    }, 60_000).unref();
    globalForLimiter.opanelFailedTokenLimiter = limiter;
  }
  return globalForLimiter.opanelFailedTokenLimiter;
}
