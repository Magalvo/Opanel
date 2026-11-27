import type { TaskLinkType } from "@/lib/schemas/bug-reports";

type Direction = "outgoing" | "incoming";

/** One way a link reads from a task: a group of the "Links" section, a "Link type" choice. */
export interface LinkReading {
  type: TaskLinkType;
  direction: Direction;
  label: string;
}

/**
 * The seven readings in the order the "Links" section shows them (WS-136 section 2).
 * `relates_to` reads the same both ways, so it is one reading, `outgoing`.
 */
export const LINK_GROUPS: readonly LinkReading[] = [
  { type: "blocks", direction: "outgoing", label: "Blocks" },
  { type: "blocks", direction: "incoming", label: "Is blocked by" },
  { type: "duplicates", direction: "outgoing", label: "Duplicates" },
  { type: "duplicates", direction: "incoming", label: "Is duplicated by" },
  { type: "regression_of", direction: "outgoing", label: "Regression of" },
  { type: "regression_of", direction: "incoming", label: "Has regression" },
  { type: "relates_to", direction: "outgoing", label: "Relates to" },
];
