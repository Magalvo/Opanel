import { describe, expect, it } from "vitest";

import {
  BACKLOG_KEYS,
  BOARD_KEYS,
  chipsOf,
  filterQuery,
  fullIndex,
  isEmpty,
  LIST_KEYS,
  readFilter,
  readSort,
  withoutValue,
  withValue,
  writeFilter,
  writeSort,
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

// The list view's filter and order in the URL (WS-130 section 2, tests 1 and 2).

const PROJECT_ID = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

describe("readFilter with projects (WS-130 test 1)", () => {
  it("reads projectId by key and by id, repeated, written first", () => {
    const { filter, ignored } = readFilter(
      new URLSearchParams(`type=bug&projectId=OPA&projectId=${PROJECT_ID}`),
      LIST_KEYS,
    );

    expect(ignored).toEqual([]);
    expect(filter).toEqual({ projectId: ["OPA", PROJECT_ID], type: ["bug"] });
    expect(writeFilter(filter)).toBe(`projectId=OPA&projectId=${PROJECT_ID}&type=bug`);
  });

  it("ignores a column on the list, and a project on the board and the backlog", () => {
    expect(readFilter(new URLSearchParams(`columnId=${COLUMN}`), LIST_KEYS).ignored).toEqual([
      "columnId",
    ]);
    expect(readFilter(new URLSearchParams("projectId=OPA"), BOARD_KEYS).ignored).toEqual([
      "projectId",
    ]);
    expect(readFilter(new URLSearchParams("projectId=OPA"), BACKLOG_KEYS).ignored).toEqual([
      "projectId",
    ]);
  });

  it("refuses a project reference the API would refuse", () => {
    expect(readFilter(new URLSearchParams("projectId=not a key"), LIST_KEYS)).toEqual({
      filter: {},
      ignored: ["projectId"],
    });
  });

  it("names a project chip by its key", () => {
    const chips = chipsOf(
      { projectId: ["OPA", PROJECT_ID, "ZZZ"] },
      { projects: new Map([[PROJECT_ID, "OPS"]]) },
    );

    expect(chips.map((chip) => chip.label)).toEqual([
      "Project: OPA",
      "Project: OPS",
      "Project: ZZZ",
    ]);
  });
});

describe("readSort and writeSort (WS-130 test 2)", () => {
  const SORTS = ["key", "title", "priority", "dueDate", "created", "updated"] as const;

  it("round-trips every sort both ways", () => {
    for (const field of SORTS) {
      for (const sort of [field, `-${field}`] as const) {
        expect(readSort(new URLSearchParams(writeSort(sort)))).toEqual({ sort, ignored: false });
      }
    }
  });

  it("reads no sort as -updated, and leaves -updated out of the link", () => {
    expect(readSort(new URLSearchParams(""))).toEqual({ sort: "-updated", ignored: false });
    expect(writeSort("-updated")).toBe("");
    expect(writeSort("priority")).toBe("sort=priority");
  });

  it("reads an unreadable sort as -updated and says it was ignored", () => {
    expect(readSort(new URLSearchParams("sort=status"))).toEqual({
      sort: "-updated",
      ignored: true,
    });
  });
});
