import { readFileSync } from "node:fs";
import path from "node:path";

import { Validator } from "@seriousme/openapi-schema-validator";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { healthResponseSchema } from "@/lib/schemas/health";

import packageJson from "../../../package.json";
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
  content: z.object({
    "application/json": z.object({ schema: z.object({ $ref: z.string() }) }),
  }),
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
  components: z.object({ schemas: z.record(z.string(), z.unknown()) }),
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
      expect(response.content["application/json"].schema.$ref).toBe(
        "#/components/schemas/HealthResponse",
      );
    }
  });

  it("marks public endpoints as requiring no credentials", () => {
    expect(parsedDocument().paths["/api/v1/health"]?.get?.security).toEqual([]);
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

  it("matches the committed docs/api/openapi.json", () => {
    const committed: unknown = JSON.parse(readFileSync(COMMITTED_FILE, "utf8"));

    expect(
      committed,
      "docs/api/openapi.json is out of date. Run `pnpm openapi:generate` and commit the result.",
    ).toEqual(documentAsJson());
  });
});
