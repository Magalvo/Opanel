// The sentences of the sprint rules (WS-143 section 3, WS-144 section 9), shared by the task
// page, the board and the backlog, so each refusal reads the same everywhere.
import { ApiFailure } from "@/lib/api-client";

/** What to do about each refusal of the sprint rules (WS-143 section 3). */
const SPRINT_RULES: Readonly<Record<string, string>> = {
  no_active_sprint: "No sprint is active. Start one from the backlog to put tasks on the board.",
  subtask_follows_parent: "A sub-task stays where its parent is. Move the parent instead.",
  sprint_completed: "This task belongs to a completed sprint's record.",
  sprints_disabled: "This project does not use sprints.",
};

/** The sentence for a refusal of the sprint rules; `null` for any other failure. */
export function sprintRuleSentence(failure: unknown): string | null {
  if (!(failure instanceof ApiFailure) || failure.code === null) return null;
  return SPRINT_RULES[failure.code] ?? null;
}

/** Another sprint is active: refused when starting one, or turning sprints off. */
export const SPRINT_ACTIVE = "Complete the active sprint first.";

/** A start of a sprint that is no longer planned. */
export const SPRINT_NOT_PLANNED = "This sprint has already started.";

/** A completion of a sprint that is no longer active. */
export const SPRINT_NOT_ACTIVE = "This sprint is no longer active.";

/** A sub-task dragged to another section of the backlog, refused before any request. */
export const SUBTASK_STAYS = "A sub-task stays in its parent's sprint.";
