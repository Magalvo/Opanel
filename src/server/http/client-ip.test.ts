import { describe, expect, it } from "vitest";

import { clientIpFrom } from "./client-ip";

function request(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/v1/x", { headers });
}

describe("clientIpFrom", () => {
  it("is null when no header is configured, whatever the request says", () => {
    expect(clientIpFrom(request({ "X-Forwarded-For": "203.0.113.7" }), undefined)).toBeNull();
  });

  it("reads the configured header, case-insensitively", () => {
    expect(clientIpFrom(request({ "X-Forwarded-For": "203.0.113.7" }), "x-forwarded-for")).toBe(
      "203.0.113.7",
    );
    expect(clientIpFrom(request({ "CF-Connecting-IP": "2001:db8::1" }), "cf-connecting-ip")).toBe(
      "2001:db8::1",
    );
  });

  it("takes the last address of a list: the one the trusted proxy appended", () => {
    expect(
      clientIpFrom(request({ "X-Forwarded-For": "1.1.1.1, 203.0.113.7" }), "x-forwarded-for"),
    ).toBe("203.0.113.7");
  });

  it("is null when the header is missing or does not hold an IP address", () => {
    expect(clientIpFrom(request({}), "x-forwarded-for")).toBeNull();
    expect(clientIpFrom(request({ "X-Forwarded-For": "not-an-ip" }), "x-forwarded-for")).toBeNull();
    expect(clientIpFrom(request({ "X-Forwarded-For": "" }), "x-forwarded-for")).toBeNull();
  });
});
