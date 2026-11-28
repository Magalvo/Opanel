import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { opa, page } from "@/components/board/test-data";
import { calls, hold, installFetch, on, problem } from "@/components/fake-api";

import { done, item, listUrl, ops, PROJECTS, todo } from "./test-data";

// The list view (WS-130 section 4, tests 7 and 8).

const navigation = { replace: vi.fn(), search: new URLSearchParams() };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace, refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/tasks",
  useSearchParams: () => navigation.search,
}));

const { TaskList } = await import("./task-list");

function rowKeys(): string[] {
  const table = screen.getByRole("table", { name: "Tasks" });
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell").at(0)?.textContent ?? "");
}

function listReads(): string[] {
  return calls("GET")
    .map(([url]) => url)
    .filter((url) => url.startsWith("/api/v1/tasks"));
}

beforeEach(() => {
  installFetch();
  navigation.replace.mockReset();
  navigation.search = new URLSearchParams();
  on(PROJECTS, page([opa, ops]));
});

describe("TaskList: reading (WS-130 test 7)", () => {
  it("reads the first page in the URL's order and filter, and says how many it shows", async () => {
    navigation.search = new URLSearchParams("type=bug&sort=priority");
    on(listUrl("priority", "type=bug"), page([item(1, todo), item(2, null, {}, ops)]));
    render(<TaskList />);

    await waitFor(() => {
      expect(rowKeys()).toEqual(["OPA-1", "OPS-2"]);
    });
    expect(screen.getByRole("status", { name: "List status" })).toHaveTextContent(
      "Showing 2 tasks.",
    );
  });

  it("reads again once per order change, applying only the latest answer", async () => {
    on(listUrl(), page([item(1, todo), item(2, todo)]));
    const user = userEvent.setup();
    render(<TaskList />);
    await waitFor(() => {
      expect(rowKeys()).toEqual(["OPA-1", "OPA-2"]);
    });

    const byKey = hold(listUrl("key"));
    on(listUrl("title"), page([item(2, todo), item(1, todo)]));
    await user.click(screen.getByRole("button", { name: "Sort by Key" }));
    await user.click(screen.getByRole("button", { name: "Sort by Title" }));
    await waitFor(() => {
      expect(rowKeys()).toEqual(["OPA-2", "OPA-1"]);
    });
    await byKey(page([item(1, todo)]));

    expect(rowKeys()).toEqual(["OPA-2", "OPA-1"]);
    expect(listReads()).toEqual([
      listUrl().slice(4),
      listUrl("key").slice(4),
      listUrl("title").slice(4),
    ]);
    expect(navigation.replace).toHaveBeenLastCalledWith("/tasks?sort=title", { scroll: false });
  });

  it("reads again when the filter changes", async () => {
    on(listUrl(), page([item(1, todo), item(2, done)]));
    on(listUrl("-updated", "projectId=OPS"), page([item(4, null, {}, ops)]));
    const user = userEvent.setup();
    render(<TaskList />);
    await waitFor(() => {
      expect(rowKeys()).toEqual(["OPA-1", "OPA-2"]);
    });

    await user.click(screen.getByRole("button", { name: "Project" }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Operations" }));

    await waitFor(() => {
      expect(rowKeys()).toEqual(["OPS-4"]);
    });
  });

  it("loads more, showing each task once, and says when more remain", async () => {
    on(listUrl(), page([item(1, todo), item(2, todo)], "next"));
    on(listUrl("-updated", "", "next"), page([item(2, todo), item(3, todo)]));
    const user = userEvent.setup();
    render(<TaskList />);
    await waitFor(() => {
      expect(screen.getByRole("status", { name: "List status" })).toHaveTextContent(
        "Showing 2 tasks; more to load.",
      );
    });

    await user.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => {
      expect(rowKeys()).toEqual(["OPA-1", "OPA-2", "OPA-3"]);
    });
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("reads the first page again on Refresh, and not before", async () => {
    on(listUrl(), page([item(1, todo)]));
    const user = userEvent.setup();
    render(<TaskList />);
    await waitFor(() => {
      expect(rowKeys()).toEqual(["OPA-1"]);
    });
    on(listUrl(), page([item(1, todo), item(5, todo)]));

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(rowKeys()).toEqual(["OPA-1", "OPA-5"]);
    });
    expect(listReads()).toHaveLength(2);
  });
});

describe("TaskList: empty and failed (WS-130 test 8)", () => {
  it("says there are no tasks yet without a filter", async () => {
    on(listUrl(), page([]));
    render(<TaskList />);

    expect(await screen.findByText("No tasks yet.")).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("says no task matches a filter, and clears it", async () => {
    navigation.search = new URLSearchParams("priority=urgent");
    on(listUrl("-updated", "priority=urgent"), page([]));
    on(listUrl(), page([item(1, todo)]));
    const user = userEvent.setup();
    render(<TaskList />);

    const empty = await screen.findByRole("region", { name: "No tasks" });
    expect(empty).toHaveTextContent("No tasks match these filters.");
    await user.click(within(empty).getByRole("button", { name: "Clear filters" }));

    await waitFor(() => {
      expect(rowKeys()).toEqual(["OPA-1"]);
    });
    expect(navigation.replace).toHaveBeenLastCalledWith("/tasks", { scroll: false });
  });

  it("names the refused filter of a 400, and tries again", async () => {
    on(
      listUrl("-updated", "priority=high"),
      problem(400, "invalid_request", [{ path: "labelId", message: "Not in these projects." }]),
    );
    navigation.search = new URLSearchParams("priority=high");
    const user = userEvent.setup();
    render(<TaskList />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Some filters are not valid: labelId.");
    on(listUrl("-updated", "priority=high"), page([item(1, todo)]));
    await user.click(within(alert).getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(rowKeys()).toEqual(["OPA-1"]);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says the list could not be loaded on another failure", async () => {
    on(listUrl(), problem(500, "internal_error"));
    render(<TaskList />);

    expect(await screen.findByRole("alert")).toHaveTextContent("The tasks could not be loaded.");
  });

  it("says when the link held a parameter it cannot read", async () => {
    navigation.search = new URLSearchParams("sort=status");
    on(listUrl(), page([item(1, todo)]));
    render(<TaskList />);

    await waitFor(() => {
      expect(rowKeys()).toEqual(["OPA-1"]);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Some filters in this link were not understood and are ignored.",
    );
  });

  it("still names a project chip by its key from the projects it read", async () => {
    navigation.search = new URLSearchParams(`projectId=${ops.id}`);
    on(listUrl("-updated", `projectId=${ops.id}`), page([item(1, null, {}, ops)]));
    render(<TaskList />);

    expect(await screen.findByRole("button", { name: "Remove Project: OPS" })).toBeVisible();
  });
});

describe("TaskList: the Sprint filter (WS-143 test 7)", () => {
  it("offers it, and reads the list with it", async () => {
    navigation.search = new URLSearchParams("sprintId=active");
    on(listUrl("-updated", "sprintId=active"), page([item(1, todo)]));
    render(<TaskList />);

    await waitFor(() => {
      expect(rowKeys()).toEqual(["OPA-1"]);
    });
    const bar = screen.getByRole("search", { name: "Filter tasks" });
    expect(within(bar).getByRole("button", { name: "Sprint" })).toBeVisible();
    expect(within(bar).getByRole("button", { name: "Remove Sprint: Active sprint" })).toBeVisible();
  });
});
