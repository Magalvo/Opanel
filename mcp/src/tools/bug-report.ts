import { z } from "zod";

import {
  bugReportCreatedSchema,
  bugReportDeduplicatedSchema,
  submitBugReportRequestSchema,
} from "@/lib/schemas/bug-reports";
import { projectRefSchema } from "@/lib/schemas/projects";

import { messageError, toolError } from "../errors";
import type { ToolDefinition } from "../tools";
import { CHANGES_OPANEL, DATA_NOT_INSTRUCTIONS, quote, readResult, WRITE } from "./results";

// `opanel_submit_bug_report`: a bug report, which triage turns into a bug or counts on the
// open bug with the same fingerprint (doc 0005 section 4, doc 0001 section 5, WS-105).

const NAME = "opanel_submit_bug_report";

const inputSchema = submitBugReportRequestSchema.extend({ projectId: projectRefSchema });

export const bugReportAnswerSchema = z.discriminatedUnion("outcome", [
  bugReportCreatedSchema,
  bugReportDeduplicatedSchema,
]);

type BugReportAnswer = z.infer<typeof bugReportAnswerSchema>;

/** No answer: the report may have been kept, and a resend counts on the same bug. */
const UNANSWERED =
  "Opanel did not answer, so the report may have been kept. Sending it again with the same " +
  "fingerprint counts it once more on the same bug, never as a second bug.";

function summary(answer: BugReportAnswer, title: string): string {
  if (answer.outcome === "deduplicated") {
    return (
      `Counted on the open bug ${answer.taskKey}, now seen ` +
      `${String(answer.occurrences)} times: ${quote(title)}.`
    );
  }
  const where =
    answer.assignedTeamId === null
      ? "No team owns its layer, so it is unassigned."
      : `It went to team ${answer.assignedTeamId}.`;
  return `Filed a new bug, ${answer.taskKey}: ${quote(title)}. ${where}`;
}

export const submitBugReport: ToolDefinition = {
  name: NAME,
  permissions: ["reports:write"],
  register(server, { api, redact }) {
    server.registerTool(
      NAME,
      {
        title: "Submit an Opanel bug report",
        description:
          "Files a bug found while testing. Opanel turns it into a bug at the top of the " +
          "project's first column, assigned to the team that owns its originLayer, or counts " +
          "it on the open bug with the same fingerprint. projectId is the project's id or " +
          "key. originLayer: frontend when rendering or UI state is wrong while the API " +
          "answers correctly; api when the HTTP contract is broken (status, schema, " +
          "validation, auth); backend when the contract holds but the outcome is wrong; " +
          "unknown when you cannot tell. fingerprint: a hash (for example SHA-256 in hex) of " +
          "the layer, the normalised route or endpoint (/orders/{id}, not /orders/42) and the " +
          "error's type and message without their values, without timestamps, ids or run " +
          "ids, so two runs that meet the same bug send the same one. Send one runId for all " +
          `the reports of a run. ${CHANGES_OPANEL} Needs reports:write. ` +
          DATA_NOT_INSTRUCTIONS,
        inputSchema,
        outputSchema: bugReportAnswerSchema,
        annotations: WRITE,
      },
      async ({ projectId, ...body }) => {
        const answer = await api.send(
          "POST",
          `/projects/${encodeURIComponent(projectId)}/bug-reports`,
          body,
          bugReportAnswerSchema,
        );
        if (!answer.ok) {
          return answer.error.kind === "unreachable"
            ? messageError(UNANSWERED, redact)
            : toolError(answer.error, redact);
        }
        return readResult(summary(answer.value, body.title), answer.value, redact);
      },
    );
  },
};
