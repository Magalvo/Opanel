import type { BugReportOutcome, OriginLayer, Severity } from "@/lib/schemas/bug-reports";

// The words the board's cards and the task detail use for bugs (WS-091 section 1).

export const SEVERITY_LABELS: Record<Severity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const LAYER_LABELS: Record<OriginLayer, string> = {
  frontend: "Frontend",
  api: "API",
  backend: "Backend",
  unknown: "Unknown",
};

export const OUTCOME_LABELS: Record<BugReportOutcome, string> = {
  created: "New bug",
  deduplicated: "Repeat",
};

/** "Reported once, on …" or "Reported 3 times, last on …"; times as the detail shows them. */
export function reportedText(occurrences: number, lastReportedAt: string | null): string {
  const time = lastReportedAt === null ? null : new Date(lastReportedAt).toLocaleString();
  if (occurrences === 1) return time === null ? "Reported once" : `Reported once, on ${time}`;
  const count = `Reported ${String(occurrences)} times`;
  return time === null ? count : `${count}, last on ${time}`;
}

/** The agent's confidence as a whole percentage. */
export function confidenceText(confidence: number | null): string {
  return confidence === null ? "Not given" : `${String(Math.round(confidence * 100))}%`;
}
