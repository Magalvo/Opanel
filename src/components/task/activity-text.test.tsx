import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { ActivityEvent } from "@/lib/schemas/activity";

import { ActivityLine, relativeTime } from "./activity-text";

// The sentences of the timeline (WS-119 section 3, tests 1 to 3).

const ada = { id: "66666666-6666-4666-8666-666666666666", name: "Ada Lovelace", kind: "human" };
const bot = { id: "14141414-1414-4414-8414-141414141414", name: "QA Bot", kind: "agent" };
const team = (name: string | null) => ({ id: "77777777-7777-4777-8777-777777777777", name });
const column = (name: string | null) => ({ id: "11111111-1111-4111-8111-111111111111", name });
const NOW = new Date("2026-11-24T12:00:00.000Z");

function event(fields: Partial<ActivityEvent>): ActivityEvent {
  return {
    kind: "event",
    id: "1",
    type: "field_changed",
    field: null,
    oldValue: null,
    newValue: null,
    actor: { ...ada, kind: "human" },
    createdAt: "2026-11-24T11:57:00.000Z",
    ...fields,
  };
}

function sentence(fields: Partial<ActivityEvent>): string {
  const { container } = render(<ActivityLine event={event(fields)} now={NOW} />);
  const text = container.textContent;
  return text.replace(/\s*·.*$/, "");
}

describe("ActivityLine: the sentences (WS-119 test 1)", () => {
  it.each([
    [
      { type: "created", newValue: { key: "OPA-1", column: column("To do") } },
      "created the task in To do",
    ],
    [
      { type: "created", newValue: { key: "OPA-1", column: null } },
      "created the task in the backlog",
    ],
    [{ field: "title", oldValue: "Old", newValue: "New" }, "changed the title from “Old” to “New”"],
    [{ field: "type", oldValue: "task", newValue: "bug" }, "changed the type from Task to Bug"],
    [
      { field: "priority", oldValue: "none", newValue: "urgent" },
      "changed the priority from None to Urgent",
    ],
    [{ field: "severity", oldValue: null, newValue: "high" }, "set the severity to High"],
    [{ field: "severity", oldValue: "high", newValue: null }, "cleared the severity"],
    [
      { field: "dueDate", oldValue: null, newValue: "2030-06-10" },
      "set the due date to Jun 10, 2030",
    ],
    [{ field: "dueDate", oldValue: "2030-06-10", newValue: null }, "cleared the due date"],
    [
      { field: "dueDate", oldValue: "2030-06-10", newValue: "2030-07-01" },
      "changed the due date from Jun 10, 2030 to Jul 1, 2030",
    ],
    [{ field: "assigneeAccountId", oldValue: null, newValue: ada }, "assigned it to Ada Lovelace"],
    [{ field: "assigneeAccountId", oldValue: ada, newValue: null }, "unassigned Ada Lovelace"],
    [
      { field: "assigneeAccountId", oldValue: ada, newValue: bot },
      "changed the assignee from Ada Lovelace to QA BotAgent",
    ],
    [
      { field: "assigneeTeamId", oldValue: null, newValue: team("Frontend") },
      "assigned it to the team Frontend",
    ],
    [
      { field: "assigneeTeamId", oldValue: team(null), newValue: null },
      "removed the team a deleted team",
    ],
    [{ field: "epicId", oldValue: null, newValue: team("Launch") }, "put it in the epic Launch"],
    [
      { field: "epicId", oldValue: team("Launch"), newValue: null },
      "took it out of the epic Launch",
    ],
    [
      {
        field: "labels",
        oldValue: [
          { id: "a", name: "red" },
          { id: "b", name: "blue" },
        ],
        newValue: [
          { id: "b", name: "blue" },
          { id: "c", name: "green" },
        ],
      },
      "added the label green and removed the label red",
    ],
    [
      {
        field: "labels",
        oldValue: [],
        newValue: [
          { id: "a", name: "red" },
          { id: "b", name: "blue" },
        ],
      },
      "added the labels red and blue",
    ],
    [
      { type: "moved", oldValue: { column: column("To do") }, newValue: { column: null } },
      "moved it from To do to the backlog",
    ],
    [
      { type: "moved", oldValue: { column: column(null) }, newValue: { column: column("Done") } },
      "moved it from a deleted column to Done",
    ],
    [{ type: "deleted" }, "deleted the task"],
    [{ type: "restored" }, "restored the task"],
    [
      { type: "reported_again", newValue: { reportId: "r", occurrences: 3 } },
      "reported it again (3 reports in all)",
    ],
    [{ field: "storyPoints", oldValue: 1, newValue: 2 }, "changed the storyPoints"],
    [{ field: "priority", oldValue: 7, newValue: { odd: true } }, "changed the priority"],
  ] as [Partial<ActivityEvent>, string][])("%o reads “%s”", (fields, text) => {
    expect(sentence(fields)).toBe(`Ada Lovelace ${text}`);
  });

  it("names an agent with its badge, and Opanel when no account acted", () => {
    expect(sentence({ type: "deleted", actor: { ...bot, kind: "agent" } })).toBe(
      "QA BotAgent deleted the task",
    );
    expect(sentence({ type: "deleted", actor: null })).toBe("Opanel deleted the task");
  });
});

describe("ActivityLine: the description (WS-119 test 2)", () => {
  it("says it changed, and shows both texts as plain text with Show changes", async () => {
    const user = userEvent.setup();
    render(
      <ActivityLine
        event={event({ field: "description", oldValue: "Old *text*", newValue: "New text" })}
        now={NOW}
      />,
    );

    expect(screen.getByText(/changed the description/)).toBeVisible();
    expect(screen.queryByText("Old *text*")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show changes" }));
    expect(screen.getByText("Old *text*")).toBeVisible();
    expect(screen.getByText("New text")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Hide changes" }));
    expect(screen.queryByText("New text")).not.toBeInTheDocument();
  });
});

describe("relativeTime (WS-119 test 3)", () => {
  it.each([
    ["2026-11-24T11:59:40.000Z", "just now"],
    ["2026-11-24T11:57:00.000Z", "3 minutes ago"],
    ["2026-11-24T09:00:00.000Z", "3 hours ago"],
    ["2026-11-22T12:00:00.000Z", "2 days ago"],
  ])("%s is %s", (at, text) => {
    expect(relativeTime(new Date(at), NOW)).toBe(text);
  });

  it("gives the date after 30 days", () => {
    const at = new Date("2026-09-01T12:00:00.000Z");
    expect(relativeTime(at, NOW)).toBe(at.toLocaleDateString());
  });

  it("puts the exact time in a time element", () => {
    const { container } = render(<ActivityLine event={event({ type: "deleted" })} now={NOW} />);
    const time = container.querySelector("time");
    expect(time).toHaveAttribute("datetime", "2026-11-24T11:57:00.000Z");
    expect(time).toHaveAttribute("title", new Date("2026-11-24T11:57:00.000Z").toLocaleString());
    expect(time).toHaveTextContent("3 minutes ago");
  });
});

describe("ActivityLine: links (WS-134 test 14)", () => {
  const other = { id: "88888888-8888-4888-8888-888888888888", key: "API-3" };
  const link = (type: string, direction: string, task: unknown = other) => ({
    type,
    direction,
    task,
  });

  it.each([
    ["blocks", "outgoing", "blocks"],
    ["blocks", "incoming", "is blocked by"],
    ["duplicates", "outgoing", "duplicates"],
    ["duplicates", "incoming", "is duplicated by"],
    ["regression_of", "outgoing", "is a regression of"],
    ["regression_of", "incoming", "has regression"],
    ["relates_to", "outgoing", "relates to"],
  ])("%s %s reads “%s”, added and removed", (type, direction, reading) => {
    expect(sentence({ type: "linked", newValue: link(type, direction) })).toBe(
      `Ada Lovelace linked this task: ${reading} API-3`,
    );
    expect(sentence({ type: "unlinked", oldValue: link(type, direction) })).toBe(
      `Ada Lovelace removed the link: ${reading} API-3`,
    );
  });

  it("links the other task's key", () => {
    render(
      <ActivityLine
        event={event({ type: "linked", newValue: link("blocks", "outgoing") })}
        now={NOW}
      />,
    );
    expect(screen.getByRole("link", { name: "API-3" })).toHaveAttribute(
      "href",
      "/projects/API/tasks/API-3",
    );
  });

  it("names a task out of reach, and reads an unknown shape plainly", () => {
    expect(sentence({ type: "linked", newValue: link("blocks", "outgoing", null) })).toBe(
      "Ada Lovelace linked this task: blocks a task in another project",
    );
    expect(sentence({ type: "unlinked", oldValue: { odd: true } })).toBe(
      "Ada Lovelace removed a link",
    );
    expect(sentence({ type: "linked", newValue: null })).toBe("Ada Lovelace added a link");
  });
});

// The sentences of a parent change (WS-135 test 9).

describe("ActivityLine: a parent change (WS-135)", () => {
  const task = (name: string | null) => ({ id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000009", name });

  it.each([
    [{ field: "parentId", oldValue: null, newValue: task("OPA-1") }, "made it a sub-task of OPA-1"],
    [{ field: "parentId", oldValue: task("OPA-1"), newValue: null }, "removed it from OPA-1"],
    [
      { field: "parentId", oldValue: task("OPA-1"), newValue: task("OPA-4") },
      "moved it from OPA-1 to OPA-4",
    ],
    [
      { field: "parentId", oldValue: null, newValue: task(null) },
      "made it a sub-task of a deleted task",
    ],
  ] as const)("%j", (fields, words) => {
    expect(sentence(fields)).toContain(words);
  });
});
