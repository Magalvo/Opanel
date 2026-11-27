"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import { z } from "zod";

import { AccountName } from "@/components/account-name";
import { taskHref, TYPE_LABELS } from "@/components/board/task-card";
import { Button } from "@/components/ui/button";
import { accountRefSchema } from "@/lib/schemas/account-ref";
import type { ActivityEvent } from "@/lib/schemas/activity";
import { severitySchema, TASK_LINK_TYPES } from "@/lib/schemas/bug-reports";
import { prioritySchema, taskTypeSchema } from "@/lib/schemas/tasks";

import { SEVERITY_LABELS } from "./bug-labels";
import { formatDueDate } from "./due-date";
import { PRIORITY_LABELS } from "./task-meta";

// One line of a task's timeline: an event as a sentence (WS-119 section 3). Values are read
// with the shapes of WS-117 and checked; one that does not match reads "changed the field".

const namedSchema = z.object({ id: z.string(), name: z.string().nullable() });
const labelsSchema = z.array(z.object({ id: z.string(), name: z.string() }));
const columnValueSchema = z.object({ column: namedSchema.nullable() });
const reportedSchema = z.object({ occurrences: z.number() });
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const linkSchema = z.object({
  type: z.enum(TASK_LINK_TYPES),
  direction: z.enum(["outgoing", "incoming"]),
  task: z.object({ id: z.string(), key: z.string() }).nullable(),
});

/** How a link reads from its task, by direction (doc 0003 section 7). */
const LINK_READINGS = {
  blocks: { outgoing: "blocks", incoming: "is blocked by" },
  duplicates: { outgoing: "duplicates", incoming: "is duplicated by" },
  regression_of: { outgoing: "is a regression of", incoming: "has regression" },
  relates_to: { outgoing: "relates to", incoming: "relates to" },
} as const;

/** "linked this task: blocks API-3", the key a link to the task (WS-134 section 7). */
function linkChange(value: unknown, added: boolean): ReactNode {
  const parsed = linkSchema.safeParse(value);
  if (!parsed.success) return added ? "added a link" : "removed a link";
  const { type, direction, task } = parsed.data;
  return (
    <>
      {added ? "linked this task: " : "removed the link: "}
      {LINK_READINGS[type][direction]}{" "}
      {task === null ? (
        "a task in another project"
      ) : (
        <Link
          href={taskHref(task.key)}
          className="font-mono underline-offset-4 hover:underline focus-visible:underline"
        >
          {task.key}
        </Link>
      )}
    </>
  );
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", DAY],
  ["hour", 60 * MINUTE],
  ["minute", MINUTE],
];
const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "always" });

/** "3 minutes ago", "2 days ago"; "just now" under a minute; the date after 30 days. */
export function relativeTime(at: Date, now: Date): string {
  const elapsed = now.getTime() - at.getTime();
  if (elapsed < MINUTE) return "just now";
  if (elapsed > 30 * DAY) return at.toLocaleDateString();
  for (const [unit, size] of UNITS) {
    if (elapsed >= size) return RELATIVE.format(-Math.floor(elapsed / size), unit);
  }
  return "just now";
}

function quoted(text: string): string {
  return `“${text}”`;
}

function listed(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

function nameOf(ref: z.infer<typeof namedSchema>, deleted: string): string {
  return ref.name ?? deleted;
}

/** Labels for a field's values, or `undefined` when the value is not one of them. */
function labelled(field: string, value: unknown): string | null | undefined {
  if (value === null) return null;
  const read = (schema: z.ZodType<string>, labels: Record<string, string>) => {
    const parsed = schema.safeParse(value);
    return parsed.success ? labels[parsed.data] : undefined;
  };
  switch (field) {
    case "type":
      return read(taskTypeSchema, TYPE_LABELS);
    case "priority":
      return read(prioritySchema, PRIORITY_LABELS);
    case "severity":
      return read(severitySchema, SEVERITY_LABELS);
    case "dueDate": {
      const parsed = dateSchema.safeParse(value);
      return parsed.success ? formatDueDate(parsed.data) : undefined;
    }
    case "title": {
      const parsed = z.string().safeParse(value);
      return parsed.success ? quoted(parsed.data) : undefined;
    }
    default:
      return undefined;
  }
}

const FIELD_NAMES: Record<string, string> = {
  type: "type",
  priority: "priority",
  severity: "severity",
  dueDate: "due date",
  title: "title",
};

function changedValue(field: string, oldValue: unknown, newValue: unknown): ReactNode {
  const name = FIELD_NAMES[field];
  const before = labelled(field, oldValue);
  const after = labelled(field, newValue);
  if (name === undefined || before === undefined || after === undefined) return undefined;
  if (before === null && after !== null) return `set the ${name} to ${after}`;
  if (after === null) return `cleared the ${name}`;
  return `changed the ${name} from ${before ?? ""} to ${after}`;
}

/** Assignee, team or epic: "assigned it to", "changed … from … to …", "unassigned". */
function changedRef(field: string, oldValue: unknown, newValue: unknown): ReactNode {
  if (field === "assigneeAccountId") {
    const person = accountRefSchema.nullable();
    const before = person.safeParse(oldValue);
    const after = person.safeParse(newValue);
    if (!before.success || !after.success) return undefined;
    if (before.data === null && after.data === null) return undefined;
    if (before.data === null && after.data !== null) {
      return (
        <>
          assigned it to <AccountName account={after.data} />
        </>
      );
    }
    if (after.data === null && before.data !== null) {
      return (
        <>
          unassigned <AccountName account={before.data} />
        </>
      );
    }
    if (before.data === null || after.data === null) return undefined;
    return (
      <>
        changed the assignee from <AccountName account={before.data} /> to{" "}
        <AccountName account={after.data} />
      </>
    );
  }
  const words =
    field === "assigneeTeamId"
      ? {
          set: "assigned it to the team",
          clear: "removed the team",
          noun: "team",
          deleted: "a deleted team",
        }
      : field === "epicId"
        ? {
            set: "put it in the epic",
            clear: "took it out of the epic",
            noun: "epic",
            deleted: "a deleted epic",
          }
        : field === "parentId"
          ? {
              set: "made it a sub-task of",
              clear: "removed it from",
              noun: "parent",
              deleted: "a deleted task",
            }
          : undefined;
  if (words === undefined) return undefined;
  const ref = namedSchema.nullable();
  const before = ref.safeParse(oldValue);
  const after = ref.safeParse(newValue);
  if (!before.success || !after.success) return undefined;
  if (before.data === null && after.data !== null) {
    return `${words.set} ${nameOf(after.data, words.deleted)}`;
  }
  if (after.data === null && before.data !== null) {
    return `${words.clear} ${nameOf(before.data, words.deleted)}`;
  }
  if (before.data === null || after.data === null) return undefined;
  // A parent change moves the task between parents (WS-135 section 6).
  const change = field === "parentId" ? "moved it" : `changed the ${words.noun}`;
  return `${change} from ${nameOf(before.data, words.deleted)} to ${nameOf(after.data, words.deleted)}`;
}

function changedLabels(oldValue: unknown, newValue: unknown): ReactNode {
  const before = labelsSchema.safeParse(oldValue ?? []);
  const after = labelsSchema.safeParse(newValue ?? []);
  if (!before.success || !after.success) return undefined;
  const had = new Set(before.data.map((label) => label.id));
  const has = new Set(after.data.map((label) => label.id));
  const added = after.data.filter((label) => !had.has(label.id)).map((label) => label.name);
  const removed = before.data.filter((label) => !has.has(label.id)).map((label) => label.name);
  const parts: string[] = [];
  if (added.length > 0) {
    parts.push(`added the label${added.length > 1 ? "s" : ""} ${listed(added)}`);
  }
  if (removed.length > 0) {
    parts.push(`removed the label${removed.length > 1 ? "s" : ""} ${listed(removed)}`);
  }
  return parts.length === 0 ? undefined : parts.join(" and ");
}

function columnName(value: unknown): string | undefined {
  const parsed = columnValueSchema.safeParse(value);
  if (!parsed.success) return undefined;
  return parsed.data.column === null
    ? "the backlog"
    : nameOf(parsed.data.column, "a deleted column");
}

function DescriptionChange({
  oldValue,
  newValue,
}: Readonly<{ oldValue: unknown; newValue: unknown }>) {
  const [open, setOpen] = useState(false);
  const before = z.string().catch("").parse(oldValue);
  const after = z.string().catch("").parse(newValue);
  return (
    <>
      changed the description{" "}
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0 text-foreground underline"
        onClick={() => {
          setOpen(!open);
        }}
      >
        {open ? "Hide changes" : "Show changes"}
      </Button>
      {open && (
        <span className="mt-2 grid gap-2">
          <span className="grid gap-1">
            <span className="text-xs font-medium">Before</span>
            <span className="rounded border p-2 break-words whitespace-pre-wrap">{before}</span>
          </span>
          <span className="grid gap-1">
            <span className="text-xs font-medium">After</span>
            <span className="rounded border p-2 break-words whitespace-pre-wrap">{after}</span>
          </span>
        </span>
      )}
    </>
  );
}

/** What the event did, after its actor's name. */
function what(event: ActivityEvent): ReactNode {
  switch (event.type) {
    case "created": {
      const place = columnName(event.newValue);
      return place === undefined ? "created the task" : `created the task in ${place}`;
    }
    case "moved": {
      const from = columnName(event.oldValue);
      const to = columnName(event.newValue);
      return from === undefined || to === undefined ? "moved it" : `moved it from ${from} to ${to}`;
    }
    case "deleted":
      return "deleted the task";
    case "restored":
      return "restored the task";
    case "reported_again": {
      const parsed = reportedSchema.safeParse(event.newValue);
      return parsed.success
        ? `reported it again (${String(parsed.data.occurrences)} reports in all)`
        : "reported it again";
    }
    case "linked":
      return linkChange(event.newValue, true);
    case "unlinked":
      return linkChange(event.oldValue, false);
    case "field_changed": {
      const field = event.field ?? "task";
      if (field === "description") {
        return <DescriptionChange oldValue={event.oldValue} newValue={event.newValue} />;
      }
      const sentence =
        field === "labels"
          ? changedLabels(event.oldValue, event.newValue)
          : (changedValue(field, event.oldValue, event.newValue) ??
            changedRef(field, event.oldValue, event.newValue));
      return sentence ?? `changed the ${field}`;
    }
  }
}

/** One change of the timeline: who, what, and when (WS-119 sections 3 and 4). */
export function ActivityLine({ event, now }: Readonly<{ event: ActivityEvent; now: Date }>) {
  const at = new Date(event.createdAt);
  return (
    <p className="text-sm text-muted-foreground">
      <span className="font-medium text-foreground">
        {event.actor === null ? "Opanel" : <AccountName account={event.actor} />}
      </span>{" "}
      {what(event)}
      {" · "}
      <time dateTime={event.createdAt} title={at.toLocaleString()}>
        {relativeTime(at, now)}
      </time>
    </p>
  );
}
