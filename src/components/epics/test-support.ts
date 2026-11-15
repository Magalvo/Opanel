import type { Epic } from "@/lib/schemas/epics";

import { PROJECT_ID } from "../projects/test-support";

export function epic(id: string, title: string, overrides: Partial<Epic> = {}): Epic {
  return {
    id,
    projectId: PROJECT_ID,
    title,
    description: "",
    status: "open",
    startDate: null,
    targetDate: null,
    progress: { doneTasks: 0, totalTasks: 0 },
    version: 1,
    createdAt: "2026-11-12T10:00:00.000Z",
    updatedAt: "2026-11-12T10:00:00.000Z",
    ...overrides,
  };
}

export const AUTH_ID = "33333333-3333-4333-8333-333333333333";
export const BILLING_ID = "77777777-7777-4777-8777-777777777777";
export const OLD_ID = "88888888-8888-4888-8888-888888888888";

export const auth = epic(AUTH_ID, "Auth", {
  description: "Sign-in and **sessions**.",
  startDate: "2026-11-01",
  targetDate: "2026-12-15",
  progress: { doneTasks: 2, totalTasks: 5 },
});
export const billing = epic(BILLING_ID, "Billing");
export const old = epic(OLD_ID, "Legacy", {
  status: "closed",
  progress: { doneTasks: 4, totalTasks: 4 },
});
