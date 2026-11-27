import type { TaskLinkType } from "@/lib/schemas/bug-reports";

type Direction = "outgoing" | "incoming";

/** How a link reads from its task, by direction (doc 0003 section 7). */
export const LINK_READINGS = {
  blocks: { outgoing: "blocks", incoming: "is blocked by" },
  duplicates: { outgoing: "duplicates", incoming: "is duplicated by" },
  regression_of: { outgoing: "is a regression of", incoming: "has regression" },
  relates_to: { outgoing: "relates to", incoming: "relates to" },
} as const satisfies Record<TaskLinkType, Record<Direction, string>>;

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
