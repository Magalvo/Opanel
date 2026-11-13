import { readFileSync } from "node:fs";
import path from "node:path";

import { Validator } from "@seriousme/openapi-schema-validator";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { healthResponseSchema } from "@/lib/schemas/health";
import { SESSION_COOKIE_NAMES } from "@/lib/session-cookie";

import packageJson from "../../../package.json";
import type { EndpointContract } from "./contract";
import { contracts } from "./contracts";
import { buildOpenApiDocument } from "./document";

const COMMITTED_FILE = path.join(process.cwd(), "docs/api/openapi.json");

// The document as a client receives it: plain JSON.
function documentAsJson(): Record<string, unknown> {
  return z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(JSON.stringify(buildOpenApiDocument())));
}

const responseSchema = z.object({
  description: z.string().min(1),
  // Absent on a no-content response such as the 204 of sign-out.
  // JSON for successes, problem+json for errors.
  content: z.record(z.string(), z.object({ schema: z.object({ $ref: z.string() }) })).optional(),
});

const documentSchema = z.object({
  openapi: z.string(),
  info: z.object({
    title: z.string(),
    version: z.string(),
    license: z.object({ name: z.string() }),
  }),
  paths: z.record(
    z.string(),
    z.record(
      z.string(),
      z.object({
        summary: z.string().min(1),
        security: z.array(z.unknown()).optional(),
        responses: z.record(z.string(), responseSchema),
      }),
    ),
  ),
  components: z.object({
    schemas: z.record(z.string(), z.unknown()),
    securitySchemes: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  }),
});

function parsedDocument(): z.infer<typeof documentSchema> {
  return documentSchema.parse(documentAsJson());
}

describe("buildOpenApiDocument", () => {
  it("is an OpenAPI 3.1 document with the project's metadata", () => {
    const document = parsedDocument();

    expect(document.openapi).toMatch(/^3\.1\.\d+$/);
    expect(document.info.title).toBe("Opanel API");
    expect(document.info.version).toBe(packageJson.version);
    expect(document.info.license.name).toBe("MIT");
  });

  it("describes GET /api/v1/health with both responses", () => {
    const operation = parsedDocument().paths["/api/v1/health"]?.get;

    expect(operation).toBeDefined();
    expect(Object.keys(operation?.responses ?? {}).sort()).toEqual(["200", "503"]);
    for (const response of Object.values(operation?.responses ?? {})) {
      expect(response.content?.["application/json"]?.schema.$ref).toBe(
        "#/components/schemas/HealthResponse",
      );
    }
  });

  it("marks public endpoints as requiring no credentials", () => {
    expect(parsedDocument().paths["/api/v1/health"]?.get?.security).toEqual([]);
  });

  it("declares the session cookie as the way to authenticate", () => {
    const scheme = parsedDocument().components.securitySchemes?.sessionCookie;

    expect(scheme).toMatchObject({ type: "apiKey", in: "cookie", name: SESSION_COOKIE_NAMES[0] });
    // Over https the cookie has another name; OpenAPI can declare only one.
    expect(scheme?.description).toContain(SESSION_COOKIE_NAMES[1]);
    expect(Object.keys(parsedDocument().components.securitySchemes ?? {})).toEqual([
      "sessionCookie",
    ]);
  });

  it("requires the session cookie on every operation that is not public, and only there", () => {
    const { paths } = parsedDocument();

    for (const contract of contracts) {
      const security = paths[contract.path]?.[contract.method]?.security;
      expect(security, `${contract.method} ${contract.path}`).toEqual(
        contract.public ? [] : [{ sessionCookie: [] }],
      );
    }
    expect(contracts.some((contract) => !contract.public)).toBe(true);
  });

  it("derives the health schema from the Zod schema", () => {
    const component = parsedDocument().components.schemas.HealthResponse;
    const { shape } = healthResponseSchema;

    // The expected values are read from the Zod schema itself, so changing the schema
    // changes the expectation, and the document has to follow.
    expect(component).toMatchObject({
      type: "object",
      properties: {
        status: { type: "string", enum: shape.status.options },
        database: { type: "string", enum: shape.database.options },
      },
      required: Object.keys(shape),
      additionalProperties: false,
    });
  });

  it("is valid according to the official OpenAPI 3.1 schema", async () => {
    const result = await new Validator().validate(documentAsJson());

    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  describe("with contracts that have requests and errors", () => {
    const thingSchema = z
      .strictObject({ id: z.uuid(), title: z.string() })
      .meta({ id: "TestThing" });

    const createThing = {
      method: "post",
      path: "/api/v1/projects/{projectId}/things",
      summary: "Create a thing",
      public: false,
      request: {
        params: z.strictObject({ projectId: z.uuid() }),
        query: z.strictObject({ dryRun: z.enum(["true", "false"]).optional() }),
        body: z.strictObject({ title: z.string().min(1) }).meta({ id: "TestThingInput" }),
      },
      responses: {
        201: { description: "Created.", schema: thingSchema },
        400: { description: "The body is not valid.", problem: true },
        403: { description: "The actor may not create things here.", problem: true },
      },
    } satisfies EndpointContract;

    const publicThing = {
      method: "get",
      path: "/api/v1/public-thing",
      summary: "A public thing",
      public: true,
      responses: { 200: { description: "The thing.", schema: thingSchema } },
    } satisfies EndpointContract;

    const endSession = {
      method: "post",
      path: "/api/v1/things/end",
      summary: "End a thing",
      public: false,
      responses: { 204: { description: "Ended.", noContent: true } },
    } satisfies EndpointContract;

    const anyOperationSchema = z.object({
      security: z.array(z.record(z.string(), z.array(z.string()))).optional(),
      parameters: z
        .array(z.object({ name: z.string(), in: z.string(), required: z.boolean().optional() }))
        .optional(),
      requestBody: z
        .object({
          required: z.boolean().optional(),
          content: z.record(z.string(), z.object({ schema: z.object({ $ref: z.string() }) })),
        })
        .optional(),
      responses: z.record(
        z.string(),
        z.object({
          description: z.string().min(1),
          content: z
            .record(z.string(), z.object({ schema: z.object({ $ref: z.string() }) }))
            .optional(),
        }),
      ),
    });

    function testDocument(): Record<string, unknown> {
      return z
        .record(z.string(), z.unknown())
        .parse(
          JSON.parse(JSON.stringify(buildOpenApiDocument([createThing, publicThing, endSession]))),
        );
    }

    function operation(path: string, method: string): z.infer<typeof anyOperationSchema> {
      const paths = z
        .object({ paths: z.record(z.string(), z.record(z.string(), anyOperationSchema)) })
        .parse(testDocument()).paths;
      const found = paths[path]?.[method];
      if (found === undefined) {
        throw new Error(`no operation ${method} ${path}`);
      }
      return found;
    }

    it("describes error responses as problem details", () => {
      const { responses } = operation(createThing.path, "post");

      expect(Object.keys(responses["400"]?.content ?? {})).toEqual(["application/problem+json"]);
      expect(responses["400"]?.content?.["application/problem+json"]?.schema.$ref).toBe(
        "#/components/schemas/Problem",
      );
      expect(Object.keys(responses["201"]?.content ?? {})).toEqual(["application/json"]);
    });

    it("adds 401 and 403 to operations that need credentials", () => {
      const { responses } = operation(createThing.path, "post");

      expect(Object.keys(responses).sort()).toEqual(["201", "400", "401", "403"]);
      expect(Object.keys(responses["401"]?.content ?? {})).toEqual(["application/problem+json"]);
      // A description written in the contract wins over the generic one.
      expect(responses["403"]?.description).toBe("The actor may not create things here.");
    });

    it("describes a no-content response without a body", () => {
      const { responses } = operation(endSession.path, "post");

      expect(responses["204"]?.description).toBe("Ended.");
      expect(responses["204"]?.content).toBeUndefined();
      expect(Object.keys(responses).sort()).toEqual(["204", "401", "403"]);
    });

    it("requires the session cookie on the protected one and nothing on the public one", () => {
      expect(operation(createThing.path, "post").security).toEqual([{ sessionCookie: [] }]);
      expect(operation(publicThing.path, "get").security).toEqual([]);
    });

    it("adds neither to public operations", () => {
      const { responses } = operation(publicThing.path, "get");

      expect(Object.keys(responses)).toEqual(["200"]);
    });

    it("describes path and query parameters and the request body", () => {
      const { parameters, requestBody } = operation(createThing.path, "post");

      expect(parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "projectId", in: "path", required: true }),
          expect.objectContaining({ name: "dryRun", in: "query" }),
        ]),
      );
      expect(parameters).toHaveLength(2);
      expect(requestBody?.required).toBe(true);
      expect(requestBody?.content["application/json"]?.schema.$ref).toBe(
        "#/components/schemas/TestThingInput",
      );
    });

    it("is still a valid OpenAPI 3.1 document", async () => {
      const result = await new Validator().validate(testDocument());

      expect(result.errors ?? []).toEqual([]);
      expect(result.valid).toBe(true);
    });
  });

  it("matches the committed docs/api/openapi.json", () => {
    const committed: unknown = JSON.parse(readFileSync(COMMITTED_FILE, "utf8"));

    expect(
      committed,
      "docs/api/openapi.json is out of date. Run `pnpm openapi:generate` and commit the result.",
    ).toEqual(documentAsJson());
  });
});
