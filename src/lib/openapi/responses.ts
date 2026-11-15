import type { z } from "zod";

import type { VersionConflictResponseContract } from "./contract";

/** The `409` of an update that sends `version` (canonical doc 0004 section 6, WS-027). */
export function versionConflictResponse(entity: z.ZodType): VersionConflictResponseContract {
  return {
    description:
      "The entity was changed since the `version` that was sent (code `version_conflict`). " +
      "`current` is the entity as it is now.",
    conflictOf: entity,
  };
}

/** The `413` of every operation that takes a JSON body (WS-044). */
export const PAYLOAD_TOO_LARGE = {
  description: "The body is larger than 512 KiB (code `payload_too_large`).",
  problem: true,
} as const;
