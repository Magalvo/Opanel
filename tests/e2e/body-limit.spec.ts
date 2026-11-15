import http from "node:http";

import { expect, test } from "@playwright/test";

import { E2E_BASE_URL } from "./environment";

const BUDGET = 512 * 1024;
const SIGN_IN = "/api/v1/auth/sign-in";

/** `{"email":"a@b.test","password":"xxx…"}` of exactly this many bytes. */
function bodyOfBytes(bytes: number): string {
  const frame = '{"email":"a@b.test","password":""}'.length;
  return `{"email":"a@b.test","password":"${"x".repeat(bytes - frame)}"}`;
}

test.describe("the size of a request body", () => {
  test("a body over the budget is refused with a problem response, and a small one is not", async ({
    request,
  }) => {
    const big = await request.post(SIGN_IN, {
      headers: { Origin: E2E_BASE_URL, "Content-Type": "application/json" },
      data: bodyOfBytes(BUDGET + 1),
    });

    expect(big.status()).toBe(413);
    expect(big.headers()["content-type"]).toBe("application/problem+json");
    expect(big.headers()["x-request-id"]).toBeTruthy();
    expect(((await big.json()) as { code: string }).code).toBe("payload_too_large");

    const small = await request.post(SIGN_IN, {
      headers: { Origin: E2E_BASE_URL, "Content-Type": "application/json" },
      data: bodyOfBytes(200),
    });
    expect([400, 401]).toContain(small.status());
  });

  test("a body at exactly the budget is read, not refused for its size", async ({ request }) => {
    const response = await request.post(SIGN_IN, {
      headers: { Origin: E2E_BASE_URL, "Content-Type": "application/json" },
      data: bodyOfBytes(BUDGET),
    });

    expect(response.status()).not.toBe(413);
  });

  test("a chunked body with no Content-Length is counted as it arrives", async () => {
    const target = new URL(E2E_BASE_URL);

    const status = await new Promise<number>((resolve, reject) => {
      const outgoing = http.request(
        {
          host: target.hostname,
          port: Number(target.port),
          path: SIGN_IN,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: E2E_BASE_URL,
            "Transfer-Encoding": "chunked",
          },
        },
        (incoming) => {
          incoming.resume();
          resolve(incoming.statusCode ?? 0);
        },
      );
      // The server may answer, and close, before the whole body is sent.
      outgoing.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "EPIPE" && error.code !== "ECONNRESET") reject(error);
      });
      outgoing.write('{"email":"a@b.test","password":"');
      for (let sent = 0; sent < BUDGET * 3; sent += 64 * 1024) {
        outgoing.write("x".repeat(64 * 1024));
      }
      outgoing.end('"}');
    });

    expect(status).toBe(413);
  });
});
