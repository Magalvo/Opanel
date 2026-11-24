import { describe, expect, it } from "vitest";

import {
  BOARD_KEYS,
  BACKLOG_KEYS,
  chipsOf,
  filterQuery,
  fullIndex,
  isEmpty,
  readFilter,
  withValue,
  withoutValue,
  writeFilter,
} from "./task-filter";

// The filter in the URL (WS-120 section 2, tests 1 and 2).

const LABEL = "bbbb0000-0000-4000-8000-000000000001";
const COLUMN = "11111111-1111-4111-8111-111111111111";

describe("readFilter and writeFilter (WS-120 test 1)", () => {
  it("round-trips every parameter, repeated ones too, in a fixed order", () => {
    const query =
      "dueTo=2030-01-31&priority=urgent&q=login&labelId=" +
      LABEL +
      "&type=bug&type=story&assigneeAccountId=me&done=false&reporterKind=agent" +
      "&epicId=none&severity=high&dueFrom=2030-01-01&assigneeTeamId=none&category=todo" +
      "&reporterAccountId=me&columnId=" +
      COLUMN;

    const { filter, ignored } = readFilter(new URLSearchParams(query), BOARD_KEYS);

    expect(ignored).toEqual([]);
    expect(writeFilter(filter)).toBe(
      `q=login&type=bug&type=story&category=todo&done=false&columnId=${COLUMN}` +
        "&assigneeTeamId=none&assigneeAccountId=me&reporterAccountId=me&reporterKind=agent" +
        `&labelId=${LABEL}&epicId=none&priority=urgent&severity=high` +
        "&dueFrom=2030-01-01&dueTo=2030-01-31",
    );
    expect(readFilter(new URLSearchParams(writeFilter(filter)), BOARD_KEYS).filter).toEqual(filter);
  });

  it("drops what it cannot read and names it, keeping the rest", () => {
    const { filter, ignored } = readFilter(
      new URLSearchParams("priority=huge&type=bug&dueFrom=2030-02-01&dueTo=2030-01-01&page=2"),
      BOARD_KEYS,
    );

    expect(filter).toEqual({ type: ["bug"], dueFrom: ["2030-02-01"] });
    expect(ignored).toEqual(["priority", "dueTo"]);
  });

  it("gives the backlog no columnId, and ignores one in its link", () => {
    const { filter, ignored } = readFilter(
      new URLSearchParams(`columnId=${COLUMN}&type=bug`),
      BACKLOG_KEYS,
    );

    expect(filter).toEqual({ type: ["bug"] });
    expect(ignored).toEqual(["columnId"]);
  });

  it("makes the API's query, and knows an empty filter", () => {
    expect(filterQuery({ type: ["bug"], q: ["a b"] })).toBe("&q=a+b&type=bug");
    expect(filterQuery({})).toBe("");
    expect(isEmpty({})).toBe(true);
    expect(isEmpty({ type: [] })).toBe(true);
    expect(isEmpty({ type: ["bug"] })).toBe(false);
  });

  it("adds and removes one value", () => {
    expect(withValue({ type: ["bug"] }, "type", "story")).toEqual({ type: ["bug", "story"] });
    expect(withValue({ type: ["bug"] }, "type", "bug")).toEqual({ type: ["bug"] });
    expect(withoutValue({ type: ["bug", "story"] }, "type", "bug")).toEqual({ type: ["story"] });
    expect(withoutValue({ type: ["bug"] }, "type", "bug")).toEqual({});
  });
});

describe("chipsOf (WS-120 test 2)", () => {
  it("names every value, those without a control too, and each chip's filter without it", () => {
    const chips = chipsOf(
      {
        q: ["login"],
        type: ["bug"],
        assigneeAccountId: ["me", "none"],
        labelId: [LABEL],
        epicId: ["none"],
        columnId: [COLUMN],
        category: ["in_progress"],
        reporterKind: ["agent"],
        dueFrom: ["2030-06-10"],
        done: ["false"],
      },
      {
        labels: new Map([[LABEL, "release"]]),
        columns: new Map([[COLUMN, "To do"]]),
      },
    );

    expect(chips.map((chip) => chip.label)).toEqual([
      "Search: login",
      "Type: Bug",
      "Column category: In progress",
      "Not done",
      "Column: To do",
      "Assignee: Me",
      "Assignee: Unassigned",
      "Reporter: Agents",
      "Label: release",
      "Epic: No epic",
      "Due from Jun 10, 2030",
    ]);
    expect(chips[1]?.without).not.toHaveProperty("type");
    expect(chips[5]?.without.assigneeAccountId).toEqual(["none"]);
  });

  it("says so when it does not know a name", () => {
    const chips = chipsOf({ labelId: [LABEL] }, {});

    expect(chips.map((chip) => chip.label)).toEqual(["Label: an unknown label"]);
  });
});

describe("fullIndex (WS-120 section 4)", () => {
  const ids = (list: string) => list.split("").map((id) => ({ id }));

  it("puts a moved item right after the shown item above it", () => {
    // Shown: b, d; d moves above b. Hidden a stays first.
    expect(fullIndex(ids("abcd"), ids("bd"), "d", 0)).toBe(1);
    // Shown: a, c, e; a moves below c, before the hidden d.
    expect(fullIndex(ids("abcde"), ids("ace"), "a", 1)).toBe(2);
  });

  it("puts it at the end when nothing is shown around it", () => {
    expect(fullIndex(ids("abc"), ids("b"), "b", 0)).toBe(2);
  });

  it("puts it into another list, after the shown item above", () => {
    // Moving x into a list where c is shown and a, b are hidden: below c.
    expect(fullIndex(ids("abc"), ids("c"), "x", 1)).toBe(3);
    expect(fullIndex(ids("abc"), ids("c"), "x", 0)).toBe(2);
  });
});
