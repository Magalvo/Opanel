import type { ApiToken } from "@/lib/schemas/agents";
import type { AgentRole, AgentScope } from "@/lib/schemas/permissions";

// What the Agents page calls things (WS-077). Admins read the sentence; agent authors find
// the scope names, shown as a hint, in the OpenAPI document (question 3).

export const ROLE_LABELS: Readonly<Record<AgentRole, string>> = {
  qa_agent: "QA agent",
  worker_agent: "Worker agent",
};

export const ROLE_DESCRIPTIONS: Readonly<Record<AgentRole, string>> = {
  qa_agent: "Reads boards, files bug reports and comments on tasks.",
  worker_agent: "Everything a QA agent does, and creates and edits tasks.",
};

export const SCOPE_LABELS: Readonly<Record<AgentScope, string>> = {
  "projects:read": "See projects, teams and people",
  "tasks:read": "Read tasks, epics and comments",
  "reports:write": "Submit bug reports",
  "comments:write": "Comment on tasks",
  "tasks:write": "Create and edit tasks",
};

export const TOKEN_STATUS_LABELS: Readonly<Record<ApiToken["status"], string>> = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
};

export const EXPIRY_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "No expiry" },
] as const;

export function dateTime(value: string | null, never = "Never"): string {
  return value === null ? never : new Date(value).toLocaleString();
}
