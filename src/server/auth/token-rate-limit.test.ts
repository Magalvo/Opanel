import { describe, expect, it } from "vitest";

import { createTokenRateLimiter } from "./token-rate-limit";

function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("createTokenRateLimiter (WS-072)", () => {
  it("allows the limit within a window and refuses the next, until the window ends", () => {
    const time = clock();
    const limiter = createTokenRateLimiter({ limit: 600, windowMs: 60_000, now: time.now });

    for (let i = 0; i < 600; i += 1) expect(limiter.hit("t").allowed).toBe(true);
    time.advance(15_000);
    expect(limiter.hit("t")).toEqual({ allowed: false, retryAfterSeconds: 45 });

    time.advance(45_000);
    expect(limiter.hit("t").allowed).toBe(true);
  });

  it("counts each token on its own", () => {
    const limiter = createTokenRateLimiter({ limit: 1, windowMs: 60_000, now: clock().now });
    expect(limiter.hit("a").allowed).toBe(true);
    expect(limiter.hit("b").allowed).toBe(true);
    expect(limiter.hit("a").allowed).toBe(false);
  });

  it("forgets ended windows when swept", () => {
    const time = clock();
    const limiter = createTokenRateLimiter({ limit: 5, windowMs: 1000, now: time.now });
    limiter.hit("a");
    limiter.hit("b");
    expect(limiter.size()).toBe(2);
    time.advance(1000);
    limiter.sweep();
    expect(limiter.size()).toBe(0);
  });

  it("defaults to 600 a minute (WT-05 decision 8)", () => {
    const time = clock();
    const limiter = createTokenRateLimiter({ now: time.now });
    for (let i = 0; i < 600; i += 1) limiter.hit("t");
    expect(limiter.hit("t")).toEqual({ allowed: false, retryAfterSeconds: 60 });
  });
});
