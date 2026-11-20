import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";
import { PAYLOAD_TOO_LARGE } from "@/lib/openapi/responses";

import { projectParamsSchema } from "./projects";

// The vocabularies of bug reports and triage (canonical doc 0001 sections 5 and 6, doc 0003
// section 4, WS-086). The database checks name the same values; a test keeps them equal.

/** A bug's severity: the reporter's view of its impact, not its priority. */
export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const severitySchema = z.enum(SEVERITIES).meta({ id: "Severity" });
export type Severity = z.infer<typeof severitySchema>;

/** The layer an agent believes a bug comes from (doc 0001 section 5). */
export const ORIGIN_LAYERS = ["frontend", "api", "backend", "unknown"] as const;
export const originLayerSchema = z.enum(ORIGIN_LAYERS).meta({ id: "OriginLayer" });
export type OriginLayer = z.infer<typeof originLayerSchema>;

/** The layers a routing rule may name: `unknown` always goes to the triage team. */
export const ROUTED_LAYERS = ["frontend", "api", "backend"] as const;
export const routedLayerSchema = z.enum(ROUTED_LAYERS);
export type RoutedLayer = z.infer<typeof routedLayerSchema>;

/** What the triage pipeline did with a report (doc 0001 section 5). */
export const BUG_REPORT_OUTCOMES = ["created", "deduplicated"] as const;
export type BugReportOutcome = (typeof BUG_REPORT_OUTCOMES)[number];

/** Link types between tasks; WT-09 adds the others of doc 0003 section 7. */
export const TASK_LINK_TYPES = ["regression_of"] as const;
export type TaskLinkType = (typeof TASK_LINK_TYPES)[number];

/** The longest fingerprint an agent may send (doc 0001 section 5). */
export const FINGERPRINT_MAX_LENGTH = 128;

// The bug report an agent sends (doc 0001 section 5, WT-06 decision 12, WS-089). The task's
// title rule is repeated here: `tasks.ts` imports this file, so it cannot import back.

const text = (max: number) => z.string().max(max);

export const bugReportEvidenceSchema = z
  .strictObject({
    stepsToReproduce: z.array(z.string().min(1).max(1_000)).max(50).optional(),
    expected: text(4_000).optional(),
    actual: text(4_000).optional(),
    url: z
      .url({ protocol: /^https?$/ })
      .max(2_000)
      .optional()
      .meta({ description: "An `http:` or `https:` URL." }),
    http: z
      .strictObject({
        method: z.string().regex(/^[A-Za-z]{1,16}$/, "1 to 16 letters."),
        path: z.string().min(1).max(2_000),
        status: z.int().min(100).max(599),
        responseSnippet: text(4_000).optional(),
      })
      .optional(),
    consoleErrors: z.array(z.string().min(1).max(2_000)).max(50).optional(),
    diagnosis: text(4_000)
      .optional()
      .meta({ description: "Why the agent believes the layer is at fault." }),
  })
  .meta({ id: "BugReportEvidence" });

export const submitBugReportRequestSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(200),
    fingerprint: z
      .string()
      .regex(/^[\x20-\x7E]{1,128}$/, "1 to 128 printable ASCII characters.")
      .meta({
        description:
          "Opaque to Opanel. A hash of the layer, the normalised route or endpoint and the " +
          "error signature, without timestamps or ids.",
      }),
    originLayer: originLayerSchema.default("unknown"),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .meta({ description: "The agent's confidence in `originLayer`." }),
    severity: severitySchema.default("medium"),
    summary: text(10_000).optional().meta({ description: "Markdown, shown as text." }),
    evidence: bugReportEvidenceSchema.optional(),
    runId: z
      .string()
      .min(1)
      .max(128)
      .optional()
      .meta({ description: "Groups the reports of one test run." }),
  })
  .meta({ id: "SubmitBugReportRequest" });

export type SubmitBugReportRequest = z.infer<typeof submitBugReportRequestSchema>;

export const bugReportCreatedSchema = z
  .strictObject({
    outcome: z.literal("created"),
    taskId: z.uuid(),
    taskKey: z.string(),
    assignedTeamId: z
      .uuid()
      .nullable()
      .meta({ description: "Null when no team owns the layer and there is no triage team." }),
  })
  .meta({ id: "BugReportCreated" });

export const bugReportDeduplicatedSchema = z
  .strictObject({
    outcome: z.literal("deduplicated"),
    taskId: z.uuid(),
    taskKey: z.string(),
    occurrences: z.int().min(2),
  })
  .meta({ id: "BugReportDeduplicated" });

export type BugReportAnswer =
  z.infer<typeof bugReportCreatedSchema> | z.infer<typeof bugReportDeduplicatedSchema>;

export const submitBugReportContract = {
  method: "post",
  path: "/api/v1/projects/{projectId}/bug-reports",
  summary: "Submit a bug report",
  description:
    "Keeps the report and, in the same transaction, counts it on the open bug with the same " +
    "fingerprint or creates a `bug` task at the top of the project's first column, assigned " +
    "to the team of its layer. For agents with `reports:write`; people file bugs as tasks.",
  access: { kind: "permission", permission: "reports:write" },
  request: { params: projectParamsSchema, body: submitBugReportRequestSchema },
  responses: {
    200: {
      description: "An open bug has this fingerprint: the report was counted on it.",
      schema: bugReportDeduplicatedSchema,
    },
    201: { description: "A new bug was created.", schema: bugReportCreatedSchema },
    400: { description: "The path or the body is not valid.", problem: true },
    404: { description: "There is no such project.", problem: true },
    409: { description: "The project is archived (code `project_archived`).", problem: true },
    413: PAYLOAD_TOO_LARGE,
    415: { description: "The body is not JSON.", problem: true },
  },
} satisfies EndpointContract;
