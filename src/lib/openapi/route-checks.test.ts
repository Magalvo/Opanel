import { describe, expect, it } from "vitest";

import { exportedHandlers, missingChecks } from "./route-checks";

const twoExports = `import { route } from "@/server/http/route";

// Authenticated.
export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  const { actor } = await authenticate(request);
  requirePermission(actor, "accounts:manage");
  return json(await list(actor));
});

export const POST = route(async (request) => {
  assertSameOrigin(request, getEnv().APP_URL);
  return json(await create());
});
`;

describe("exportedHandlers", () => {
  it("returns each exported method with its own text only", () => {
    const handlers = exportedHandlers(twoExports);

    expect(handlers.map((handler) => handler.method)).toEqual(["GET", "POST"]);
    expect(handlers[0]?.source).toContain("requirePermission(");
    expect(handlers[0]?.source).not.toContain("assertSameOrigin(");
    expect(handlers[1]?.source).toContain("assertSameOrigin(");
    expect(handlers[1]?.source).not.toContain("authenticate(");
  });

  it("finds handlers declared as functions, and ignores other exports", () => {
    const handlers = exportedHandlers(
      `export const dynamic = "force-dynamic";\n\nexport async function GET(): Promise<Response> {\n  return new Response();\n}\n\nexport function DELETE() {}\n`,
    );

    expect(handlers.map((handler) => handler.method)).toEqual(["GET", "DELETE"]);
  });
});

describe("missingChecks", () => {
  const base = { file: "v1/things/route.ts", authenticationOnly: false };
  const complete = `export const POST = route(async (request) => {
  assertSameOrigin(request, getEnv().APP_URL);
  const { actor } = await authenticate(request);
  requirePermission(actor, "things:write");
  return json({});
});`;

  it("accepts a protected, state-changing handler that makes all three calls", () => {
    expect(missingChecks({ ...base, method: "POST", isPublic: false, source: complete })).toEqual(
      [],
    );
  });

  it.each([
    ["authenticate(", "authenticate"],
    ["requirePermission(", "requirePermission"],
    ["assertSameOrigin(", "assertSameOrigin"],
  ])("reports a missing %s, naming the file, the method and the call", (call, name) => {
    const source = complete
      .split("\n")
      .filter((line) => !line.includes(call))
      .join("\n");

    const problems = missingChecks({ ...base, method: "POST", isPublic: false, source });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("v1/things/route.ts");
    expect(problems[0]).toContain("POST");
    expect(problems[0]).toContain(name);
  });

  it("is not fooled by a call that is only mentioned in a comment", () => {
    const source = complete.replace(
      '  requirePermission(actor, "things:write");',
      "  // requirePermission(actor) is done by the service",
    );

    expect(missingChecks({ ...base, method: "POST", isPublic: false, source }).join(" ")).toContain(
      "requirePermission",
    );
  });

  it("asks a public state-changing handler only for the origin check", () => {
    const source = `export const POST = route(async (request) => {
  assertSameOrigin(request, getEnv().APP_URL);
  return json({});
});`;

    expect(missingChecks({ ...base, method: "POST", isPublic: true, source })).toEqual([]);
    expect(
      missingChecks({ ...base, method: "POST", isPublic: true, source: "export const POST = x;" }),
    ).toHaveLength(1);
  });

  it("asks nothing of a public read", () => {
    expect(
      missingChecks({
        ...base,
        method: "GET",
        isPublic: true,
        source: "export async function GET() { return new Response(); }",
      }),
    ).toEqual([]);
  });

  it("lets an authentication-only read go without a permission check", () => {
    const source = `export const GET = route(async (request) => {
  const { actor } = await authenticate(request);
  return json(actor);
});`;

    expect(
      missingChecks({ ...base, method: "GET", isPublic: false, authenticationOnly: true, source }),
    ).toEqual([]);
    expect(missingChecks({ ...base, method: "GET", isPublic: false, source }).join(" ")).toContain(
      "requirePermission",
    );
  });

  it("does not ask a read for the origin check", () => {
    const source = `export const GET = route(async (request) => {
  const { actor } = await authenticate(request);
  requirePermission(actor, "things:read");
  return json({});
});`;

    expect(missingChecks({ ...base, method: "GET", isPublic: false, source })).toEqual([]);
  });
});
