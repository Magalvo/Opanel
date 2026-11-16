// The JSON body budget of WS-044, through the real server and transport.
import { request as httpRequest } from "node:http";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";

const BUDGET = 512 * 1024;
const headers = { Origin: E2E_BASE_URL, "Content-Type": "application/json" };

/** A JSON body of exactly `bytes` bytes: a string literal of ASCII letters. */
function bodyOf(bytes: number): string {
  return `"${"a".repeat(bytes - 2)}"`;
}

test("the budget plus one byte is refused with 413; a small body gets its normal answer", async ({
  request,
}) => {
  const tooLarge = await request.post("/api/v1/auth/sign-in", {
    headers,
    data: bodyOf(BUDGET + 1),
  });
  expect(tooLarge.status()).toBe(413);
  expect(tooLarge.headers()["content-type"]).toContain("application/problem+json");
  const problem = (await tooLarge.json()) as { code: string; requestId: string };
  expect(problem.code).toBe("payload_too_large");
  expect(problem.requestId).toMatch(/^[0-9a-f-]{36}$/);

  const small = await request.post("/api/v1/auth/sign-in", {
    headers,
    data: { email: "nobody@example.com", password: "not the password at all" },
  });
  expect(small.status()).toBe(401);

  const atBudget = await request.post("/api/v1/auth/sign-in", {
    headers,
    data: bodyOf(BUDGET),
  });
  expect(atBudget.status()).toBe(400);
});

test("a chunked body with no Content-Length is counted and refused too", async () => {
  const url = new URL("/api/v1/auth/sign-in", E2E_BASE_URL);
  const status = await new Promise<number>((resolve, reject) => {
    const outgoing = httpRequest(
      url,
      { method: "POST", headers: { ...headers, "Transfer-Encoding": "chunked" } },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    outgoing.on("error", reject);
    const chunk = "a".repeat(64 * 1024);
    outgoing.write('"');
    for (let sent = 0; sent < BUDGET + 128 * 1024; sent += chunk.length) {
      outgoing.write(chunk);
    }
    outgoing.end('"');
  });

  expect(status).toBe(413);
});

test("a body of 11 MB is refused with 413, not truncated by a proxy buffer", async ({
  request,
}) => {
  const response = await request.post("/api/v1/auth/sign-in", {
    headers,
    data: bodyOf(11 * 1024 * 1024),
  });

  expect(response.status()).toBe(413);
});
