import { z } from "zod";

/**
 * The version an update was based on (canonical doc 0004 section 6, doc 0002 section 4).
 * Versions start at 1 and grow by one with every change; a mismatch is `409 version_conflict`.
 */
export const versionSchema = z
  .int()
  .min(1)
  .meta({ description: "The `version` of the entity this change is based on." });
