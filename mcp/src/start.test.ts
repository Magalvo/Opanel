import { afterEach, describe, expect, it, vi } from "vitest";

import { prepare } from "./start";
import {
  fakeFetch,
  jsonResponse,
  memoryStream,
  problemResponse,
  QA_AGENT,
  TOKEN,
  URL_BASE,
} from "./testing";

// Start-up: the configuration and the `GET /me` check (WS-099 tests 6 and 11).

const env = { OPANEL_URL: URL_BASE, OPANEL_TOKEN: TOKEN };

async function run(
  respond: () => Response | Promise<Response>,
  environment: Record<string, string> = env,
) {
  const stderr = memoryStream();
  const result = await prepare({ env: environment, fetch: fakeFetch(respond).fetch, stderr });
  return { result, stderr: stderr.text() };
}

afterEach(() => {
  vi.restoreAllMocks();
});

const human = {
  id: QA_AGENT.id,
  kind: "human",
  name: "Ana",
  email: "ana@example.com",
  role: "admin",
  permissions: [],
  projectIds: null,
};

describe("prepare", () => {
  it("answers the agent when the token is an agent's", async () => {
    const { result, stderr } = await run(() => jsonResponse(200, QA_AGENT));

    expect(result.ok && result.me).toEqual(QA_AGENT);
    expect(stderr).toBe("");
  });

  it.each<[string, () => Response, RegExp]>([
    ["a rejected token", () => problemResponse(401, "unauthenticated", "No."), /rejected/],
    ["a disabled agent", () => problemResponse(403, "agent_disabled", "Off."), /disabled/],
    [
      "an unreachable server",
      () => {
        throw new TypeError("fetch failed");
      },
      /unreachable/,
    ],
    ["a page that is not Opanel", () => new Response("<html></html>"), /not .*Opanel server/],
    ["a person's account", () => jsonResponse(200, human), /not an agent/],
    ["another problem", () => problemResponse(500, "internal_error", "Boom"), /500 internal_error/],
  ])("stops on %s with a message on stderr", async (_name, respond, message) => {
    const { result, stderr } = await run(respond);

    expect(result.ok).toBe(false);
    expect(stderr).toMatch(message);
    expect(stderr).not.toContain(TOKEN);
  });

  it("stops on a bad configuration before any request", async () => {
    const fake = fakeFetch(() => jsonResponse(200, QA_AGENT));
    const stderr = memoryStream();

    const result = await prepare({
      env: { OPANEL_URL: URL_BASE, OPANEL_TOKEN: "nope" },
      fetch: fake.fetch,
      stderr,
    });

    expect(result.ok).toBe(false);
    expect(stderr.text()).toContain("OPANEL_TOKEN");
    expect(fake.calls).toEqual([]);
  });

  it("warns about plain http and carries on", async () => {
    const { result, stderr } = await run(() => jsonResponse(200, QA_AGENT), {
      OPANEL_URL: "http://opanel.internal",
      OPANEL_TOKEN: TOKEN,
    });

    expect(result.ok).toBe(true);
    expect(stderr).toMatch(/warning/i);
  });

  it("writes nothing to stdout", async () => {
    const stdout = vi.spyOn(process.stdout, "write");

    await run(() => jsonResponse(200, QA_AGENT));
    await run(() => problemResponse(401, "unauthenticated", "No."));

    expect(stdout).not.toHaveBeenCalled();
  });
});
