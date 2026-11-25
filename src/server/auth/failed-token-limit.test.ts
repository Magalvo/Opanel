import { describe, expect, it } from "vitest";

import { createFailedTokenLimiter, failedTokenKey } from "./failed-token-limit";

function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/v1/projects", { headers });
}

describe("createFailedTokenLimiter (WS-125)", () => {
  it("refuses once a window holds the limit, with firstRefusal once, until the window ends", () => {
    const time = clock();
    const limiter = createFailedTokenLimiter({ limit: 3, windowMs: 60_000, now: time.now });

    for (let i = 0; i < 3; i += 1) expect(limiter.begin("ip:a").allowed).toBe(true);
    time.advance(15_000);
    expect(limiter.begin("ip:a")).toEqual({
      allowed: false,
      key: "ip:a",
      retryAfterSeconds: 45,
      firstRefusal: true,
    });
    expect(limiter.begin("ip:a")).toMatchObject({ allowed: false, firstRefusal: false });

    time.advance(45_000);
    expect(limiter.begin("ip:a").allowed).toBe(true);
  });

  it("counts each key on its own", () => {
    const limiter = createFailedTokenLimiter({ limit: 1, now: clock().now });
    expect(limiter.begin("ip:a").allowed).toBe(true);
    expect(limiter.begin("ip:b").allowed).toBe(true);
    expect(limiter.begin("ip:a").allowed).toBe(false);
  });

  it("gives the unit back on success, so only failures stay counted", () => {
    const limiter = createFailedTokenLimiter({ limit: 3, now: clock().now });

    for (let i = 0; i < 50; i += 1) {
      const decision = limiter.begin("ip:a");
      if (!decision.allowed) throw new Error("refused a success");
      decision.succeeded();
    }

    limiter.begin("ip:a");
    const success = limiter.begin("ip:a");
    if (success.allowed) success.succeeded();
    limiter.begin("ip:a");
    limiter.begin("ip:a");
    expect(limiter.begin("ip:a").allowed).toBe(false);
  });

  it("holds the units of attempts still being checked: a burst cannot pass the limit", () => {
    const limiter = createFailedTokenLimiter({ limit: 3, now: clock().now });
    const burst = Array.from({ length: 10 }, () => limiter.begin("ip:a").allowed);
    expect(burst.filter(Boolean)).toHaveLength(3);
  });

  it("gives back nothing into a later window", () => {
    const time = clock();
    const limiter = createFailedTokenLimiter({ limit: 1, windowMs: 1000, now: time.now });
    const old = limiter.begin("ip:a");
    time.advance(1000);
    expect(limiter.begin("ip:a").allowed).toBe(true);
    if (old.allowed) old.succeeded();
    expect(limiter.begin("ip:a").allowed).toBe(false);
  });

  it("bounds its memory: past maxKeys, new addresses share the overflow key", () => {
    const time = clock();
    const limiter = createFailedTokenLimiter({
      limit: 1,
      windowMs: 1000,
      maxKeys: 2,
      now: time.now,
    });
    limiter.begin("ip:a");
    limiter.begin("ip:b");
    expect(limiter.begin("ip:c").allowed).toBe(true);
    expect(limiter.begin("ip:d")).toMatchObject({ allowed: false, key: "overflow" });
    expect(limiter.size()).toBe(3);

    time.advance(1000);
    limiter.sweep();
    expect(limiter.size()).toBe(0);
    expect(limiter.begin("ip:d")).toMatchObject({ allowed: true });
    expect(limiter.keys()).toEqual(["ip:d"]);
  });
});

describe("failedTokenKey (WS-125)", () => {
  it("has no key when no header is configured, whatever the client sends", () => {
    expect(failedTokenKey(request({ "X-Forwarded-For": "203.0.113.9" }), undefined)).toBeNull();
  });

  it("keys an IPv4 address, from the last entry of the configured header only", () => {
    const header = "x-forwarded-for";
    expect(failedTokenKey(request({ "X-Forwarded-For": "203.0.113.9" }), header)).toBe(
      "ip:203.0.113.9",
    );
    expect(
      failedTokenKey(request({ "X-Forwarded-For": "198.51.100.1, 203.0.113.9" }), header),
    ).toBe("ip:203.0.113.9");
    expect(
      failedTokenKey(
        request({ "X-Forwarded-For": "203.0.113.9", "X-Real-IP": "198.51.100.1" }),
        header,
      ),
    ).toBe("ip:203.0.113.9");
  });

  it("keys an IPv4-mapped IPv6 address as its IPv4 address", () => {
    expect(
      failedTokenKey(request({ "X-Forwarded-For": "::ffff:203.0.113.9" }), "x-forwarded-for"),
    ).toBe("ip:203.0.113.9");
  });

  it("keys an IPv6 address by its /64", () => {
    const key = (ip: string) =>
      failedTokenKey(request({ "X-Forwarded-For": ip }), "x-forwarded-for");
    expect(key("2001:db8:1:2::1")).toBe("ip6:2001:0db8:0001:0002::/64");
    expect(key("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("ip6:2001:0db8:0001:0002::/64");
    expect(key("2001:db8:1:3::1")).toBe("ip6:2001:0db8:0001:0003::/64");
    expect(key("::1")).toBe("ip6:0000:0000:0000:0000::/64");
  });

  it("uses one shared key when the configured header is missing or holds no address", () => {
    expect(failedTokenKey(request(), "x-forwarded-for")).toBe("unknown");
    expect(failedTokenKey(request({ "X-Forwarded-For": "not-an-ip" }), "x-forwarded-for")).toBe(
      "unknown",
    );
  });
});
