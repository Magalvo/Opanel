import type { z } from "zod";

import type { ProblemCode } from "@/lib/schemas/problem";

import type { ProblemResponseContract, VersionConflictResponseContract } from "./contract";

/** What each other `409` of a versioned write means (WS-083). */
const OTHER_CONFLICTS: Partial<Record<ProblemCode, string>> = {
  project_archived: "the project is archived (code `project_archived`)",
  last_done_column: "it would leave the project without a Done column (code `last_done_column`)",
  account_inactive: "the person to assign is deactivated (code `account_inactive`)",
  sprint_active: "a sprint is active, so sprints cannot be turned off (code `sprint_active`)",
  sprint_completed: "the sprint is completed (code `sprint_completed`)",
  sprint_not_planned: "the sprint is not planned (code `sprint_not_planned`)",
  sprint_not_active: "the sprint is not active (code `sprint_not_active`)",
  sprints_disabled: "the project does not use sprints (code `sprints_disabled`)",
  no_active_sprint: "a column is asked while no sprint is active (code `no_active_sprint`)",
  subtask_follows_parent:
    "the place disagrees with the parent's sprint, which a sub-task follows (code " +
    "`subtask_follows_parent`)",
};

/**
 * The `409` of an update that sends `version` (canonical doc 0004 section 6, WS-027), and
 * the other `409` codes the operation can answer (WS-083): required, so that each versioned
 * write states them, even when there are none.
 */
export function versionConflictResponse(
  entity: z.ZodType,
  otherCodes: readonly ProblemCode[],
): VersionConflictResponseContract {
  const others = otherCodes.map((code) => OTHER_CONFLICTS[code] ?? `code \`${code}\``);
  return {
    description: [
      "The entity was changed since the `version` that was sent (code `version_conflict`). " +
        "`current` is the entity as it is now.",
      ...(others.length === 0 ? [] : [`Or ${others.join("; or ")}.`]),
    ].join(" "),
    conflictOf: entity,
    otherCodes,
  };
}

/**
 * The `400` of an operation that takes no query parameter: `route()` refuses any (WS-083,
 * canonical doc 0004 section 3).
 */
export const UNKNOWN_QUERY = {
  description: "The query string names a parameter this operation does not take.",
  problem: true,
} as const satisfies ProblemResponseContract;

/** The `400` of an operation whose path names a project (WS-083). */
export const BAD_PATH = {
  description: "The path is not valid.",
  problem: true,
} as const satisfies ProblemResponseContract;

/** The `413` of every operation that takes a JSON body (WS-044). */
export const PAYLOAD_TOO_LARGE = {
  description: "The request body is larger than 512 KiB (code `payload_too_large`).",
  problem: true,
} as const satisfies ProblemResponseContract;
