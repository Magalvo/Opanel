import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";

import { accountRefSchema } from "./account-ref";
import {
  BUG_REPORT_OUTCOMES,
  bugReportEvidenceSchema,
  originLayerSchema,
  severitySchema,
} from "./bug-reports";
import { MAX_CURSOR_LENGTH, pageSchema } from "./pagination";
import { taskParamsSchema } from "./tasks";

// The reports behind a task, as people and agents read them (WT-06 decision 15, WS-090). A
// file of its own: `tasks.ts` imports `bug-reports.ts`, so neither can hold this contract.

export const bugReportSchema = z
  .strictObject({
    id: z.uuid(),
    taskId: z.uuid(),
    agent: accountRefSchema.meta({ description: "The agent that sent the report." }),
    outcome: z.enum(BUG_REPORT_OUTCOMES),
    originLayer: originLayerSchema,
    confidence: z.number().min(0).max(1).nullable(),
    severity: severitySchema,
    fingerprint: z.string(),
    runId: z.string().nullable(),
    title: z.string(),
    summary: z.string().nullable(),
    evidence: bugReportEvidenceSchema.nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "BugReport" });

export type BugReport = z.infer<typeof bugReportSchema>;

export const bugReportPageSchema = pageSchema(bugReportSchema).meta({ id: "BugReportPage" });

export type BugReportPage = z.infer<typeof bugReportPageSchema>;

/** Reports can be large, so pages are smaller than doc 0004's default (WS-090 section 2). */
export const BUG_REPORT_PAGE_LIMIT = { default: 10, max: 25 } as const;

export const bugReportListQuerySchema = z.strictObject({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(BUG_REPORT_PAGE_LIMIT.max)
    .default(BUG_REPORT_PAGE_LIMIT.default),
  cursor: z.string().min(1).max(MAX_CURSOR_LENGTH).optional(),
});

export type BugReportListQuery = z.infer<typeof bugReportListQuerySchema>;

export const listBugReportsContract = {
  method: "get",
  path: "/api/v1/tasks/{taskId}/bug-reports",
  summary: "List the bug reports behind a task",
  description:
    "Newest first, with keyset pagination: 10 by default, 25 at most, since a report can be " +
    "large. Each report is as the agent sent it.",
  access: { kind: "permission", permission: "tasks:read" },
  request: { params: taskParamsSchema, query: bugReportListQuerySchema },
  responses: {
    200: { description: "A page of reports.", schema: bugReportPageSchema },
    400: { description: "The path or the query string is not valid.", problem: true },
    404: { description: "There is no such task.", problem: true },
  },
} satisfies EndpointContract;
