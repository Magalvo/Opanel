import { readFileSync } from "node:fs";
import path from "node:path";

import { Validator } from "@seriousme/openapi-schema-validator";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { healthResponseSchema } from "@/lib/schemas/health";
import { problemSchema } from "@/lib/schemas/problem";
import { taskSchema } from "@/lib/schemas/tasks";
import { SESSION_COOKIE_NAMES } from "@/lib/session-cookie";

import packageJson from "../../../package.json";
import type { EndpointContract } from "./contract";
import { contracts } from "./contracts";
import { buildOpenApiDocument } from "./document";
import { versionConflictResponse } from "./responses";

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
  // A schema is a reference, or (a version conflict with other conflicts, WS-083) anyOf them.
  content: z
    .record(
      z.string(),
      z.object({
        schema: z.object({
          $ref: z.string().optional(),
          anyOf: z.array(z.object({ $ref: z.string() })).optional(),
        }),
      }),
    )
    .optional(),
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
    // And the 400 of a query string, which it does not take (WS-083).
    expect(Object.keys(operation?.responses ?? {}).sort()).toEqual(["200", "400", "503"]);
    for (const response of [operation?.responses["200"], operation?.responses["503"]]) {
      expect(response?.content?.["application/json"]?.schema.$ref).toBe(
        "#/components/schemas/HealthResponse",
      );
    }
  });

  it("marks public endpoints as requiring no credentials", () => {
    expect(parsedDocument().paths["/api/v1/health"]?.get?.security).toEqual([]);
  });

  it("declares the session cookie and the agents' bearer token (WS-075)", () => {
    const scheme = parsedDocument().components.securitySchemes?.sessionCookie;

    expect(scheme).toMatchObject({ type: "apiKey", in: "cookie", name: SESSION_COOKIE_NAMES[0] });
    // Over https the cookie has another name; OpenAPI can declare only one.
    expect(scheme?.description).toContain(SESSION_COOKIE_NAMES[1]);
    expect(Object.keys(parsedDocument().components.securitySchemes ?? {}).sort()).toEqual([
      "bearerAuth",
      "sessionCookie",
    ]);
    expect(parsedDocument().components.securitySchemes?.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
  });

  it("requires credentials on every operation that is not public: a token too, unless session-only", () => {
    const { paths } = parsedDocument();

    for (const contract of contracts) {
      const security = paths[contract.path]?.[contract.method]?.security;
      const expected =
        contract.access.kind === "public"
          ? []
          : contract.access.kind === "session"
            ? [{ sessionCookie: [] }]
            : [{ sessionCookie: [] }, { bearerAuth: [] }];
      expect(security, `${contract.method} ${contract.path}`).toEqual(expected);
    }
    expect(contracts.some((contract) => contract.access.kind !== "public")).toBe(true);
  });

  it("names the permission of every permission-checked operation, and only there", () => {
    const { paths } = z
      .object({
        paths: z.record(z.string(), z.record(z.string(), z.record(z.string(), z.unknown()))),
      })
      .parse(documentAsJson());

    for (const contract of contracts) {
      const operation = paths[contract.path]?.[contract.method];
      const where = `${contract.method} ${contract.path}`;
      if (contract.access.kind === "permission") {
        expect(operation?.["x-opanel-permission"], where).toBe(contract.access.permission);
        expect(operation?.description, where).toContain(
          `Requires the \`${contract.access.permission}\` permission.`,
        );
      } else {
        expect(operation?.["x-opanel-permission"], where).toBeUndefined();
      }
    }
  });

  it("documents the version conflict of PATCH /api/v1/projects/{projectId} (WS-028)", () => {
    const conflict =
      parsedDocument().paths["/api/v1/projects/{projectId}"]?.patch?.responses["409"];

    expect(conflict?.content?.["application/problem+json"]?.schema.anyOf?.[0]?.$ref).toBe(
      "#/components/schemas/ProjectVersionConflict",
    );
  });

  it("documents the version conflicts of the column writes (WS-029)", () => {
    const { paths } = parsedDocument();

    for (const conflict of [
      paths["/api/v1/columns/{columnId}"]?.patch?.responses["409"],
      paths["/api/v1/columns/{columnId}/move"]?.post?.responses["409"],
    ]) {
      expect(conflict?.content?.["application/problem+json"]?.schema.anyOf?.[0]?.$ref).toBe(
        "#/components/schemas/ColumnVersionConflict",
      );
    }
  });

  it("documents the version conflict of PATCH /api/v1/tasks/{taskId} (WS-030)", () => {
    const conflict = parsedDocument().paths["/api/v1/tasks/{taskId}"]?.patch?.responses["409"];

    expect(conflict?.content?.["application/problem+json"]?.schema.anyOf?.[0]?.$ref).toBe(
      "#/components/schemas/TaskVersionConflict",
    );
  });

  it("documents the version conflict of POST /api/v1/tasks/{taskId}/move (WS-031)", () => {
    const conflict = parsedDocument().paths["/api/v1/tasks/{taskId}/move"]?.post?.responses["409"];

    expect(conflict?.content?.["application/problem+json"]?.schema.anyOf?.[0]?.$ref).toBe(
      "#/components/schemas/TaskVersionConflict",
    );
  });

  it("documents the version conflict of PATCH /api/v1/epics/{epicId} (WS-033)", () => {
    const conflict = parsedDocument().paths["/api/v1/epics/{epicId}"]?.patch?.responses["409"];

    expect(conflict?.content?.["application/problem+json"]?.schema.anyOf?.[0]?.$ref).toBe(
      "#/components/schemas/EpicVersionConflict",
    );
  });

  it("describes the events of a project as a text/event-stream of ProjectEvent (WS-047)", () => {
    const operation = parsedDocument().paths["/api/v1/projects/{projectId}/events"]?.get;

    expect(operation?.responses["200"]?.content?.["text/event-stream"]?.schema.$ref).toBe(
      "#/components/schemas/ProjectEvent",
    );
    expect(operation?.responses["200"]?.description).toContain("event:");
    expect(Object.keys(operation?.responses["429"]?.content ?? {})).toEqual([
      "application/problem+json",
    ]);
    // And the 400 of a path that names no project (WS-083).
    expect(Object.keys(operation?.responses ?? {}).sort()).toEqual([
      "200",
      "400",
      "401",
      "403",
      "404",
      "429",
    ]);
  });

  it("describes Me as one of HumanMe and AgentMe; PATCH /me answers HumanMe (WS-076)", () => {
    const { paths, components } = parsedDocument();
    const json = (status: string, method: "get" | "patch") =>
      paths["/api/v1/me"]?.[method]?.responses[status]?.content?.["application/json"]?.schema.$ref;

    expect(json("200", "get")).toBe("#/components/schemas/Me");
    expect(json("200", "patch")).toBe("#/components/schemas/HumanMe");
    expect(components.schemas.Me).toMatchObject({
      oneOf: [{ $ref: "#/components/schemas/HumanMe" }, { $ref: "#/components/schemas/AgentMe" }],
      discriminator: {
        propertyName: "kind",
        mapping: {
          human: "#/components/schemas/HumanMe",
          agent: "#/components/schemas/AgentMe",
        },
      },
    });
    expect(components.schemas.AgentMe).toMatchObject({
      properties: { kind: { const: "agent" } },
      required: expect.not.arrayContaining(["email"]) as unknown,
    });
    expect(JSON.stringify(components.schemas.AgentMe)).not.toContain('"email"');
    expect(components.schemas.HumanMe).toMatchObject({
      properties: { kind: { const: "human" }, projectIds: { type: "null" } },
    });
  });

  it("describes POST /api/v1/projects/{projectId}/bug-reports with both answers (WS-089)", () => {
    const { paths } = parsedDocument();
    const operation = paths["/api/v1/projects/{projectId}/bug-reports"]?.post;
    const json = (status: string) =>
      operation?.responses[status]?.content?.["application/json"]?.schema.$ref;

    expect(json("201")).toBe("#/components/schemas/BugReportCreated");
    expect(json("200")).toBe("#/components/schemas/BugReportDeduplicated");
    expect(Object.keys(operation?.responses ?? {})).toEqual(
      expect.arrayContaining(["400", "401", "403", "404", "409", "413", "415", "429"]),
    );
  });

  it("describes the reports of a task, paged 25 at most, and the links of a Task (WS-090)", () => {
    const document = documentAsJson();
    const { paths, components } = parsedDocument();
    const operation = paths["/api/v1/tasks/{taskId}/bug-reports"]?.get;

    expect(operation?.responses["200"]?.content?.["application/json"]?.schema.$ref).toBe(
      "#/components/schemas/BugReportPage",
    );
    expect(JSON.stringify(document.paths)).toContain('"maximum":25');
    expect(components.schemas.Task).toMatchObject({
      properties: { links: { type: "array", items: { $ref: "#/components/schemas/TaskLink" } } },
      required: expect.arrayContaining(["links"]) as unknown,
    });
    expect(JSON.stringify(components.schemas.TaskSummary)).not.toContain('"links"');
  });

  it("gives tasks their bug fields, and takes severity on create and edit (WS-088)", () => {
    const { schemas } = parsedDocument().components;
    const severity = { anyOf: [{ $ref: "#/components/schemas/Severity" }, { type: "null" }] };

    expect(schemas.Severity).toMatchObject({ enum: ["low", "medium", "high", "critical"] });
    for (const name of ["Task", "TaskSummary"]) {
      expect(schemas[name], name).toMatchObject({
        properties: {
          severity,
          fingerprint: { type: ["string", "null"] },
          occurrences: { type: "integer", minimum: 0 },
          lastReportedAt: { anyOf: [{ format: "date-time" }, { type: "null" }] },
        },
        required: expect.arrayContaining([
          "severity",
          "fingerprint",
          "occurrences",
          "lastReportedAt",
        ]) as unknown,
      });
    }
    expect(schemas.CreateTaskRequest).toMatchObject({
      properties: { severity: { $ref: "#/components/schemas/Severity" } },
    });
    expect(schemas.UpdateTaskRequest).toMatchObject({ properties: { severity } });
    for (const name of ["CreateTaskRequest", "UpdateTaskRequest"]) {
      const { properties } = z
        .object({ properties: z.record(z.string(), z.unknown()) })
        .parse(schemas[name]);
      expect(Object.keys(properties), name).not.toContain("fingerprint");
      expect(Object.keys(properties), name).not.toContain("occurrences");
    }
  });

  it("gives tasks a priority and a due date, on answers and on create and edit (WS-102)", () => {
    const { schemas } = parsedDocument().components;
    const priority = { $ref: "#/components/schemas/Priority" };

    expect(schemas.Priority).toMatchObject({
      type: "string",
      enum: ["none", "low", "medium", "high", "urgent"],
    });
    for (const name of ["Task", "TaskSummary"]) {
      expect(schemas[name], name).toMatchObject({
        properties: {
          priority,
          dueDate: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
        },
        required: expect.arrayContaining(["priority", "dueDate"]) as unknown,
      });
    }
    expect(schemas.CreateTaskRequest).toMatchObject({
      properties: { priority, dueDate: { type: "string", format: "date" } },
    });
    expect(schemas.UpdateTaskRequest).toMatchObject({
      properties: {
        priority,
        dueDate: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
      },
    });
  });

  it("describes labels, their operations, and labels on tasks (WS-107)", () => {
    const { schemas } = parsedDocument().components;
    const { paths } = parsedDocument();
    const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

    expect(schemas.LabelColour).toMatchObject({
      type: "string",
      enum: ["gray", "red", "orange", "amber", "green", "teal", "blue", "indigo", "purple", "pink"],
    });
    expect(schemas.Label).toMatchObject({
      properties: { colour: ref("LabelColour") },
      required: expect.arrayContaining(["id", "projectId", "name", "colour", "version"]) as unknown,
    });
    expect(schemas.LabelRef).toMatchObject({ required: ["id", "name", "colour"] });
    for (const name of ["Task", "TaskSummary"]) {
      expect(schemas[name], name).toMatchObject({
        properties: { labels: { type: "array", items: ref("LabelRef") } },
        required: expect.arrayContaining(["labels"]) as unknown,
      });
    }
    for (const name of ["CreateTaskRequest", "UpdateTaskRequest"]) {
      expect(schemas[name], name).toMatchObject({
        properties: { labelIds: { type: "array", maxItems: 20 } },
      });
    }
    expect(Object.keys(paths["/api/v1/projects/{projectId}/labels"] ?? {}).sort()).toEqual([
      "get",
      "post",
    ]);
    expect(Object.keys(paths["/api/v1/labels/{labelId}"] ?? {}).sort()).toEqual([
      "delete",
      "patch",
    ]);
    expect(paths["/api/v1/labels/{labelId}"]?.patch?.responses["409"]?.content).toBeDefined();
  });

  it("describes a task's activity and both kinds of item (WS-117)", () => {
    const { schemas } = parsedDocument().components;
    const { paths } = parsedDocument();
    const operation = paths["/api/v1/tasks/{taskId}/activity"]?.get;

    expect(operation?.["x-opanel-permission"]).toBe("tasks:read");
    expect(Object.keys(operation?.responses ?? {}).sort()).toEqual(
      expect.arrayContaining(["200", "400", "403", "404"]) as unknown,
    );
    expect(schemas.TaskActivityComment).toMatchObject({
      required: expect.arrayContaining(["kind", "comment"]) as unknown,
    });
    expect(schemas.TaskActivityEvent).toMatchObject({
      required: expect.arrayContaining([
        "kind",
        "id",
        "type",
        "field",
        "oldValue",
        "newValue",
        "actor",
        "createdAt",
      ]) as unknown,
    });
    expect(schemas.NamedRef).toMatchObject({ required: ["id", "name"] });
  });

  it("names the reporter and the comment author as AccountRef, with its kind (WS-074)", () => {
    const { schemas } = parsedDocument().components;

    expect(schemas.AccountRef).toMatchObject({
      type: "object",
      properties: { kind: { $ref: "#/components/schemas/AccountKind" } },
      required: ["id", "name", "kind"],
      additionalProperties: false,
    });
    expect(schemas.AccountKind).toMatchObject({ type: "string", enum: ["human", "agent"] });
    expect(schemas.CommentAuthor).toBeUndefined();
    for (const name of ["Task", "TaskSummary"]) {
      expect(schemas[name], name).toMatchObject({
        properties: { reporter: { $ref: "#/components/schemas/AccountRef" } },
      });
    }
    expect(JSON.stringify(schemas.Comment)).toContain('"#/components/schemas/AccountRef"');
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

  it("documents the token's 429 on every operation a token may call, and nowhere else (WS-083)", () => {
    const { paths } = parsedDocument();
    let counted = 0;

    for (const [path, item] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(item)) {
        const where = `${method} ${path}`;
        const byToken = JSON.stringify(operation.security ?? []).includes("bearerAuth");
        // Sign-in and the other public operations have their own `rate_limited`, by email or
        // address; the token's is its own sentence.
        const limited = operation.responses["429"]?.description ?? "";
        expect(limited.includes("The API token made too many requests"), where).toBe(byToken);
        if (byToken) counted += 1;
      }
    }
    expect(counted).toBeGreaterThan(40);
  });

  it("declares Retry-After, whole seconds of at least 1, on every 429 (WS-083)", () => {
    const { paths } = z
      .object({
        paths: z.record(
          z.string(),
          z.record(
            z.string(),
            z.object({ responses: z.record(z.string(), z.record(z.string(), z.unknown())) }),
          ),
        ),
      })
      .parse(documentAsJson());
    let counted = 0;

    for (const [path, item] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(item)) {
        const limited = operation.responses["429"];
        if (limited === undefined) continue;
        counted += 1;
        expect(limited.headers, `${method} ${path}`).toMatchObject({
          "Retry-After": { schema: { type: "integer", minimum: 1 } },
        });
      }
    }
    expect(paths["/api/v1/auth/sign-in"]?.post?.responses["429"]).toBeDefined();
    expect(counted).toBeGreaterThan(40);
  });

  it("documents the 400 of an invalid project on the event stream (WS-083)", () => {
    const invalid =
      parsedDocument().paths["/api/v1/projects/{projectId}/events"]?.get?.responses["400"];

    expect(invalid?.content?.["application/problem+json"]?.schema.$ref).toBe(
      "#/components/schemas/Problem",
    );
  });

  it.each([
    ["/api/v1/projects/{projectId}", "patch", "Project", ["project_archived"]],
    ["/api/v1/columns/{columnId}", "patch", "Column", ["project_archived", "last_done_column"]],
    ["/api/v1/columns/{columnId}/move", "post", "Column", ["project_archived"]],
    ["/api/v1/tasks/{taskId}", "patch", "Task", ["project_archived", "account_inactive"]],
    ["/api/v1/tasks/{taskId}/move", "post", "Task", ["project_archived"]],
    ["/api/v1/epics/{epicId}", "patch", "Epic", ["project_archived"]],
  ])("documents every 409 of %s %s (WS-083)", (path, method, entity, codes) => {
    const conflict = z
      .object({
        description: z.string(),
        content: z.object({
          "application/problem+json": z.object({
            schema: z.object({ anyOf: z.array(z.unknown()) }),
          }),
        }),
      })
      .parse(
        z
          .object({
            paths: z.record(
              z.string(),
              z.record(z.string(), z.object({ responses: z.record(z.string(), z.unknown()) })),
            ),
          })
          .parse(documentAsJson()).paths[path]?.[method]?.responses["409"],
      );

    expect(conflict.content["application/problem+json"].schema.anyOf).toEqual([
      { $ref: `#/components/schemas/${entity}VersionConflict` },
      { $ref: "#/components/schemas/Problem" },
    ]);
    for (const code of ["version_conflict", ...codes]) {
      expect(conflict.description).toContain(`\`${code}\``);
    }
  });

  it("describes the triage settings of a project (WS-087)", () => {
    const { paths } = parsedDocument();
    const triage = paths["/api/v1/projects/{projectId}/triage"];

    expect(triage?.get?.responses["200"]?.content?.["application/json"]?.schema.$ref).toBe(
      "#/components/schemas/TriageSettings",
    );
    expect(
      triage?.patch?.responses["409"]?.content?.["application/problem+json"]?.schema.anyOf,
    ).toEqual([
      { $ref: "#/components/schemas/TriageSettingsVersionConflict" },
      { $ref: "#/components/schemas/Problem" },
    ]);
    expect(triage?.patch?.responses["400"]).toBeDefined();
  });

  it("accepts both a version conflict and a project_archived body as the task PATCH's 409 (WS-083)", () => {
    const base = {
      type: "about:blank",
      title: "Conflict",
      status: 409,
      detail: "A conflict.",
      requestId: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
    };
    const archived = { ...base, code: "project_archived" };
    // The two schemas the anyOf of the 409 names: the version conflict and Problem.
    const versionConflict = problemSchema.extend({
      code: z.literal("version_conflict"),
      current: taskSchema,
    });

    expect(problemSchema.safeParse(archived).success).toBe(true);
    expect(versionConflict.safeParse(archived).success).toBe(false);
    expect(problemSchema.safeParse({ ...base, code: "version_conflict" }).success).toBe(true);
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
      access: { kind: "permission", permission: "tasks:write" },
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
      access: { kind: "public" },
      responses: { 200: { description: "The thing.", schema: thingSchema } },
    } satisfies EndpointContract;

    const endSession = {
      method: "post",
      path: "/api/v1/things/end",
      summary: "End a thing",
      access: { kind: "authenticated" },
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

      expect(Object.keys(responses).sort()).toEqual(["201", "400", "401", "403", "429"]);
      expect(Object.keys(responses["401"]?.content ?? {})).toEqual(["application/problem+json"]);
      // A description written in the contract wins over the generic one.
      expect(responses["403"]?.description).toBe("The actor may not create things here.");
    });

    it("describes a no-content response without a body", () => {
      const { responses } = operation(endSession.path, "post");

      expect(responses["204"]?.description).toBe("Ended.");
      expect(responses["204"]?.content).toBeUndefined();
      expect(Object.keys(responses).sort()).toEqual(["204", "401", "403", "429"]);
    });

    it("accepts a session or a token on the protected one and nothing on the public one", () => {
      expect(operation(createThing.path, "post").security).toEqual([
        { sessionCookie: [] },
        { bearerAuth: [] },
      ]);
      expect(operation(publicThing.path, "get").security).toEqual([]);
    });

    it("describes a version conflict with the entity as current, under its own name", () => {
      const updateThing = {
        method: "patch",
        path: "/api/v1/things/{thingId}",
        summary: "Update a thing",
        access: { kind: "permission", permission: "tasks:write" },
        request: { params: z.strictObject({ thingId: z.uuid() }) },
        responses: {
          200: { description: "Updated.", schema: thingSchema },
          409: versionConflictResponse(thingSchema, []),
        },
      } satisfies EndpointContract;
      const document = z
        .object({
          paths: z.record(z.string(), z.record(z.string(), anyOperationSchema)),
          components: z.object({ schemas: z.record(z.string(), z.unknown()) }),
        })
        .parse(JSON.parse(JSON.stringify(buildOpenApiDocument([updateThing]))));
      const conflict = document.paths["/api/v1/things/{thingId}"]?.patch?.responses["409"];

      expect(Object.keys(conflict?.content ?? {})).toEqual(["application/problem+json"]);
      expect(conflict?.content?.["application/problem+json"]?.schema.$ref).toBe(
        "#/components/schemas/TestThingVersionConflict",
      );
      expect(document.components.schemas.TestThingVersionConflict).toMatchObject({
        properties: {
          code: { const: "version_conflict" },
          current: { $ref: "#/components/schemas/TestThing" },
        },
      });
    });

    it("refuses a version conflict for an entity schema without an id", () => {
      const anonymous = z.strictObject({ id: z.uuid() });
      const contract = {
        method: "patch",
        path: "/api/v1/anonymous",
        summary: "Update",
        access: { kind: "authenticated" },
        responses: { 409: versionConflictResponse(anonymous, []) },
      } satisfies EndpointContract;

      expect(() => buildOpenApiDocument([contract])).toThrow(/id/);
    });

    it("names the permission on a permission-checked operation only", () => {
      const document = testDocument();
      const paths = z
        .object({
          paths: z.record(z.string(), z.record(z.string(), z.record(z.string(), z.unknown()))),
        })
        .parse(document).paths;

      expect(paths[createThing.path]?.post?.["x-opanel-permission"]).toBe("tasks:write");
      expect(paths[createThing.path]?.post?.description).toBe(
        "Requires the `tasks:write` permission.",
      );
      expect(paths[endSession.path]?.post?.["x-opanel-permission"]).toBeUndefined();
      expect(paths[endSession.path]?.post?.description).toBeUndefined();
      expect(paths[publicThing.path]?.get?.["x-opanel-permission"]).toBeUndefined();
    });

    it("adds 429 rate_limited where a token is accepted, not on public or session-only operations (WS-083)", () => {
      const sessionThing = {
        method: "post",
        path: "/api/v1/things/mine",
        summary: "My thing",
        access: { kind: "session" },
        responses: { 204: { description: "Done.", noContent: true } },
      } satisfies EndpointContract;
      const paths = z
        .object({ paths: z.record(z.string(), z.record(z.string(), anyOperationSchema)) })
        .parse(
          JSON.parse(
            JSON.stringify(
              buildOpenApiDocument([createThing, publicThing, endSession, sessionThing]),
            ),
          ),
        ).paths;

      for (const [path, method] of [
        [createThing.path, "post"],
        [endSession.path, "post"],
      ] as const) {
        const limited = paths[path]?.[method]?.responses["429"];
        expect(limited?.description, `${method} ${path}`).toContain("`rate_limited`");
        expect(limited?.content?.["application/problem+json"]?.schema.$ref).toBe(
          "#/components/schemas/Problem",
        );
      }
      expect(paths[publicThing.path]?.get?.responses["429"]).toBeUndefined();
      expect(paths[sessionThing.path]?.post?.responses["429"]).toBeUndefined();
    });

    it("keeps an operation's own 429 and adds the token's to it (WS-083)", () => {
      const streamThing = {
        method: "get",
        path: "/api/v1/things/stream",
        summary: "A stream",
        access: { kind: "authenticated" },
        responses: {
          200: { description: "Things.", noContent: true },
          429: { description: "Too many streams (code `too_many_streams`).", problem: true },
        },
      } satisfies EndpointContract;
      const paths = z
        .object({ paths: z.record(z.string(), z.record(z.string(), anyOperationSchema)) })
        .parse(JSON.parse(JSON.stringify(buildOpenApiDocument([streamThing])))).paths;
      const limited = paths[streamThing.path]?.get?.responses["429"];

      expect(limited?.description).toContain("Too many streams (code `too_many_streams`).");
      expect(limited?.description).toContain("`rate_limited`");
    });

    it("documents a version conflict and the other conflicts as anyOf, naming each code (WS-083)", () => {
      function conflictOf(codes: readonly ("project_archived" | "last_done_column")[]) {
        const updateThing = {
          method: "patch",
          path: "/api/v1/things/{thingId}",
          summary: "Update a thing",
          access: { kind: "permission", permission: "tasks:write" },
          responses: { 409: versionConflictResponse(thingSchema, codes) },
        } satisfies EndpointContract;
        const document = z
          .object({ paths: z.record(z.string(), z.record(z.string(), z.unknown())) })
          .parse(JSON.parse(JSON.stringify(buildOpenApiDocument([updateThing]))));
        return z
          .object({
            responses: z.object({
              "409": z.object({
                description: z.string(),
                content: z.object({
                  "application/problem+json": z.object({ schema: z.unknown() }),
                }),
              }),
            }),
          })
          .parse(document.paths["/api/v1/things/{thingId}"]?.patch).responses["409"];
      }

      const both = conflictOf(["project_archived", "last_done_column"]);
      expect(both.content["application/problem+json"].schema).toEqual({
        anyOf: [
          { $ref: "#/components/schemas/TestThingVersionConflict" },
          { $ref: "#/components/schemas/Problem" },
        ],
      });
      expect(both.description).toContain("`project_archived`");
      expect(both.description).toContain("`last_done_column`");

      const alone = conflictOf([]);
      expect(alone.content["application/problem+json"].schema).toEqual({
        $ref: "#/components/schemas/TestThingVersionConflict",
      });
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
