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
