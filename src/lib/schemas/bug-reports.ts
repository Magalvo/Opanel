import { z } from "zod";

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
