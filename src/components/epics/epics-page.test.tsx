import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { json, opa, page, PROJECT } from "@/components/board/test-data";
import { bodyOf, calls, installFetch, on, problem } from "@/components/fake-api";
import { FakeSource } from "@/hooks/fake-event-source";
import type { Epic } from "@/lib/schemas/epics";
import type { ProjectEvent } from "@/lib/schemas/events";
import type { Project } from "@/lib/schemas/projects";

const router = { back: vi.fn(), push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/projects/OPA/epics",
}));

const { ProjectFrame } = await import("@/components/projects/project-frame");
const { EpicsPage } = await import("./epics-page");

function epic(n: number, title: string, extra: Partial<Epic> = {}): Epic {
  return {
    id: `eeeeeeee-eeee-4eee-8eee-${String(n).padStart(12, "0")}`,
    projectId: opa.id,
    title,
    description: "",
    status: "open",
    startDate: null,
    targetDate: null,
    progress: { doneTasks: 0, totalTasks: 0 },
    version: 1,
    createdAt: "2026-11-12T10:00:00.000Z",
    updatedAt: "2026-11-12T10:00:00.000Z",
    ...extra,
  };
}

const launch = epic(1, "Launch", {
  description: "The **first** release.\n\n<script>window.injected = true</script>",
  startDate: "2026-11-01",
  targetDate: "2026-12-01",
  progress: { doneTasks: 2, totalTasks: 5 },
  version: 3,
});
const polish = epic(2, "Polish");

const OPEN = "GET /api/v1/projects/OPA/epics?limit=50&status=open";
const CLOSED = "GET /api/v1/projects/OPA/epics?limit=50&status=closed";
const ALL = "GET /api/v1/projects/OPA/epics?limit=50&status=all";

async function renderEpics({
  project = opa,
  canManageEpics = true,
  show = "open",
  first = "Launch",
}: {
  project?: Project;
  canManageEpics?: boolean;
  show?: "open" | "closed" | "all";
  first?: string | null;
} = {}) {
  on(PROJECT, json(project));
  const user = userEvent.setup();
  render(
    <ProjectFrame projectKey="OPA" canManageProjects={false}>
      <EpicsPage show={show} canManageEpics={canManageEpics} />
    </ProjectFrame>,
  );
  if (first === null) {
    await screen.findByText(/^No (open |closed )?epics/);
  } else {
    await screen.findByRole("button", { name: first });
  }
  return user;
}

function status() {
  return screen.getByRole("status", { name: "Epic messages" });
}

function rowOf(title: string) {
  return screen.getByRole("row", { name: new RegExp(title) });
}

async function openEpic(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(screen.getByRole("button", { name: title }));
  return screen.getByRole("dialog", { name: title });
}

beforeEach(() => {
  installFetch();
  router.push.mockReset();
  on(OPEN, page([launch, polish]));
});

describe("EpicsPage: the list", () => {
  it("says it is loading, then shows a table with title, status, dates and progress", async () => {
    on(PROJECT, json(opa));
    render(
      <ProjectFrame projectKey="OPA" canManageProjects={false}>
        <EpicsPage show="open" canManageEpics />
      </ProjectFrame>,
    );
    expect(await screen.findByText("Loading epics…")).toBeInTheDocument();
    await screen.findByRole("button", { name: "Launch" });

    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Title",
      "Status",
      "Start",
      "Target",
      "Progress",
    ]);
    const row = rowOf("Launch");
    expect(row).toHaveTextContent("Open");
    expect(row).toHaveTextContent("2026-11-01");
    expect(row).toHaveTextContent("2026-12-01");
    expect(rowOf("Polish")).toHaveTextContent("—");
  });

  it("shows progress as a named progress bar with the numbers as text, or No tasks", async () => {
    await renderEpics();

    const bar = within(rowOf("Launch")).getByRole("progressbar", {
      name: "2 of 5 tasks done",
    });
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "5");
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(rowOf("Launch")).toHaveTextContent("2 / 5");
    expect(within(rowOf("Polish")).queryByRole("progressbar")).toBeNull();
    expect(rowOf("Polish")).toHaveTextContent("No tasks");
  });

  it("explains a failure to load, and retries", async () => {
    on(OPEN, problem(500, "internal_error"));
    on(PROJECT, json(opa));
    const user = userEvent.setup();
    render(
      <ProjectFrame projectKey="OPA" canManageProjects={false}>
        <EpicsPage show="open" canManageEpics />
      </ProjectFrame>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the epics.");
    on(OPEN, page([polish]));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Polish" })).toBeInTheDocument();
  });

  it("loads more while there are more", async () => {
    on(OPEN, page([launch], "c1"));
    on(`${OPEN}&cursor=c1`, page([polish]));
    const user = await renderEpics();

    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByRole("button", { name: "Polish" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it.each([
    ["open", OPEN, "No open epics."],
    ["closed", CLOSED, "No closed epics."],
    ["all", ALL, "No epics yet."],
  ] as const)("asks for %s epics and has its own empty message", async (show, url, empty) => {
    on(url, page([]));
    await renderEpics({ show, first: null });

    expect(screen.getByText(empty)).toBeInTheDocument();
    expect(calls("GET").some(([requested]) => `GET ${requested}` === url)).toBe(true);
  });

  it("keeps the Show choice in the URL", async () => {
    const user = await renderEpics();
    const show = screen.getByLabelText("Show");
    expect(show).toHaveValue("open");

    await user.selectOptions(show, "Closed");
    expect(router.push).toHaveBeenLastCalledWith("/projects/OPA/epics?show=closed");
    await user.selectOptions(show, "All");
    expect(router.push).toHaveBeenLastCalledWith("/projects/OPA/epics?show=all");
    await user.selectOptions(show, "Open");
    expect(router.push).toHaveBeenLastCalledWith("/projects/OPA/epics");
  });
});

describe("EpicsPage: reading an epic", () => {
  it("shows title, status, dates, progress and the description as Markdown, with no controls", async () => {
    const user = await renderEpics({ canManageEpics: false });

    const dialog = await openEpic(user, "Launch");

    expect(within(dialog).getByText("first", { selector: "strong" })).toBeInTheDocument();
    expect(dialog.querySelector("script")).toBeNull();
    expect(dialog).toHaveTextContent("Open");
    expect(dialog).toHaveTextContent("2026-11-01");
    expect(within(dialog).getByRole("progressbar", { name: "2 of 5 tasks done" })).toBeVisible();
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(within(dialog).queryByLabelText("Start date")).toBeNull();
    for (const name of ["Save changes", "Close epic", "Reopen epic"]) {
      expect(within(dialog).queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByRole("button", { name: "New epic" })).toBeNull();
  });
});

describe("EpicsPage: creating", () => {
  it("requires a title and refuses a target before the start, at the field", async () => {
    const user = await renderEpics();
    await user.click(screen.getByRole("button", { name: "New epic" }));
    const dialog = screen.getByRole("dialog", { name: "New epic" });

    await user.click(within(dialog).getByRole("button", { name: "Create epic" }));
    expect(within(dialog).getByLabelText("Title")).toHaveAccessibleDescription("Enter a title.");

    await user.type(within(dialog).getByLabelText("Title"), "Beta");
    await user.type(within(dialog).getByLabelText("Start date"), "2026-12-10");
    await user.type(within(dialog).getByLabelText("Target date"), "2026-12-01");
    await user.click(within(dialog).getByRole("button", { name: "Create epic" }));
    expect(within(dialog).getByLabelText("Target date")).toHaveAccessibleDescription(
      "The target date cannot be before the start date.",
    );
    expect(calls("POST")).toEqual([]);
  });

  it("posts only the given fields and adds the epic to an Open list", async () => {
    on("POST /api/v1/projects/OPA/epics", json(epic(3, "Beta"), 201));
    const user = await renderEpics();
    await user.click(screen.getByRole("button", { name: "New epic" }));
    const dialog = screen.getByRole("dialog", { name: "New epic" });

    await user.type(within(dialog).getByLabelText("Title"), "Beta");
    await user.type(within(dialog).getByLabelText("Target date"), "2026-12-24");
    await user.click(within(dialog).getByRole("button", { name: "Create epic" }));

    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ title: "Beta", targetDate: "2026-12-24" });
    expect(await screen.findByRole("button", { name: "Beta" })).toBeInTheDocument();
    expect(status()).toHaveTextContent("Beta was created.");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not add a new epic to a Closed list", async () => {
    on(CLOSED, page([epic(4, "Done thing", { status: "closed" })]));
    on("POST /api/v1/projects/OPA/epics", json(epic(3, "Beta"), 201));
    const user = await renderEpics({ show: "closed", first: "Done thing" });
    await user.click(screen.getByRole("button", { name: "New epic" }));
    const dialog = screen.getByRole("dialog", { name: "New epic" });

    await user.type(within(dialog).getByLabelText("Title"), "Beta");
    await user.click(within(dialog).getByRole("button", { name: "Create epic" }));

    await waitFor(() => {
      expect(status()).toHaveTextContent("Beta was created.");
    });
    expect(screen.queryByRole("button", { name: "Beta" })).toBeNull();
  });

  it("shows the API's field errors at their field", async () => {
    on(
      "POST /api/v1/projects/OPA/epics",
      problem(400, "invalid_request", [{ path: "title", message: "Too long." }]),
    );
    const user = await renderEpics();
    await user.click(screen.getByRole("button", { name: "New epic" }));
    const dialog = screen.getByRole("dialog", { name: "New epic" });

    await user.type(within(dialog).getByLabelText("Title"), "Beta");
    await user.click(within(dialog).getByRole("button", { name: "Create epic" }));

    expect(await within(dialog).findByText("Too long.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Title")).toHaveAccessibleDescription("Too long.");
  });
});

describe("EpicsPage: editing", () => {
  it("saves only the changes with the version, clears a date as null, and updates the row", async () => {
    on(
      "PATCH /api/v1/epics/" + launch.id,
      json({ ...launch, title: "Launch v2", startDate: null, version: 4 }),
    );
    const user = await renderEpics();
    const dialog = await openEpic(user, "Launch");
    const save = within(dialog).getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();

    await user.clear(within(dialog).getByLabelText("Title"));
    await user.type(within(dialog).getByLabelText("Title"), "Launch v2");
    await user.clear(within(dialog).getByLabelText("Start date"));
    await user.click(save);

    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({
      title: "Launch v2",
      startDate: null,
      version: 3,
    });
    // The list is behind the modal dialog, so it is hidden from assistive technology.
    expect(
      await screen.findByRole("button", { name: "Launch v2", hidden: true }),
    ).toBeInTheDocument();
    expect(status()).toHaveTextContent("Saved.");

    on(
      "PATCH /api/v1/epics/" + launch.id,
      json({ ...launch, title: "Launch v3", startDate: null, version: 5 }),
    );
    const again = screen.getByRole("dialog");
    await user.clear(within(again).getByLabelText("Title"));
    await user.type(within(again).getByLabelText("Title"), "Launch v3");
    await user.click(within(again).getByRole("button", { name: "Save changes" }));
    expect(bodyOf(calls("PATCH")[1]?.[1])).toEqual({ title: "Launch v3", version: 4 });
  });

  it("sends a new description, and its preview renders it", async () => {
    on("PATCH /api/v1/epics/" + launch.id, json({ ...launch, description: "# Plan", version: 4 }));
    const user = await renderEpics();
    const dialog = await openEpic(user, "Launch");

    await user.clear(within(dialog).getByLabelText("Description"));
    await user.type(within(dialog).getByLabelText("Description"), "# Plan");
    await user.click(within(dialog).getByRole("button", { name: "Preview" }));
    expect(within(dialog).getByRole("heading", { name: "Plan" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Write" }));
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ description: "# Plan", version: 3 });
  });

  it("refills from current after a version conflict, and explains", async () => {
    on("PATCH /api/v1/epics/" + launch.id, () =>
      Response.json(
        {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          code: "version_conflict",
          detail: "Changed.",
          requestId: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
          current: { ...launch, title: "Their launch", version: 9 },
        },
        { status: 409 },
      ),
    );
    const user = await renderEpics();
    const dialog = await openEpic(user, "Launch");

    await user.type(within(dialog).getByLabelText("Title"), " mine");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(await within(dialog).findByDisplayValue("Their launch")).toBeInTheDocument();
    expect(status()).toHaveTextContent(
      "Someone else changed this epic. Their version is shown; make your change again.",
    );
  });

  it("turns read-only when the project turns out to be archived", async () => {
    on("PATCH /api/v1/epics/" + launch.id, problem(409, "project_archived"));
    const user = await renderEpics();
    on(PROJECT, json({ ...opa, archivedAt: "2026-11-16T10:00:00.000Z", version: 4 }));
    const dialog = await openEpic(user, "Launch");

    await user.type(within(dialog).getByLabelText("Title"), "!");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText("This project is archived. Its epics are read-only."),
    ).toBeInTheDocument();
    expect(status()).toHaveTextContent("The project is archived.");
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New epic" })).toBeNull();
  });
});

describe("EpicsPage: closing and reopening", () => {
  it("asks before closing an epic with tasks not done, and Cancel changes nothing", async () => {
    const user = await renderEpics();
    const dialog = await openEpic(user, "Launch");

    await user.click(within(dialog).getByRole("button", { name: "Close epic" }));
    const confirm = screen.getByRole("alertdialog", { name: "Close Launch?" });
    expect(confirm).toHaveTextContent("3 of its tasks are not done yet.");
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));

    expect(calls("PATCH")).toEqual([]);
  });

  it("closes after confirming, sends the status with the version, and leaves the Open list", async () => {
    on("PATCH /api/v1/epics/" + launch.id, json({ ...launch, status: "closed", version: 4 }));
    const user = await renderEpics();
    const dialog = await openEpic(user, "Launch");

    await user.click(within(dialog).getByRole("button", { name: "Close epic" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Close epic" }),
    );

    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ status: "closed", version: 3 });
    expect(status()).toHaveTextContent("Launch was closed.");
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Reopen epic" }),
    ).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Launch" })).toBeNull();
    });
  });

  it("closes at once when every task is done, and reopens", async () => {
    const finished = epic(5, "Finished", { progress: { doneTasks: 2, totalTasks: 2 } });
    on(OPEN, page([finished]));
    on(`PATCH /api/v1/epics/${finished.id}`, json({ ...finished, status: "closed", version: 2 }));
    const user = await renderEpics({ first: "Finished" });
    const dialog = await openEpic(user, "Finished");

    await user.click(within(dialog).getByRole("button", { name: "Close epic" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ status: "closed", version: 1 });

    on(`PATCH /api/v1/epics/${finished.id}`, json({ ...finished, status: "open", version: 3 }));
    await user.click(within(dialog).getByRole("button", { name: "Reopen epic" }));
    expect(bodyOf(calls("PATCH")[1]?.[1])).toEqual({ status: "open", version: 2 });
    expect(status()).toHaveTextContent("Finished was reopened.");
  });
});

describe("EpicsPage: read-only", () => {
  it("has no create, edit, close or reopen control on an archived project, and says why", async () => {
    const user = await renderEpics({
      project: { ...opa, archivedAt: "2026-11-16T10:00:00.000Z" },
    });

    expect(screen.getByText("This project is archived. Its epics are read-only.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "New epic" })).toBeNull();
    const dialog = await openEpic(user, "Launch");
    expect(within(dialog).queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Close epic" })).toBeNull();
  });
});

describe("EpicsPage: accessibility", () => {
  it("closes the epic dialog with Escape and returns focus to its title", async () => {
    const user = await renderEpics();
    const opener = screen.getByRole("button", { name: "Launch" });

    await user.click(opener);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => {
      expect(opener).toHaveFocus();
    });
  });

  it("closes the new epic dialog with Escape and returns focus", async () => {
    const user = await renderEpics();
    const opener = screen.getByRole("button", { name: "New epic" });

    await user.click(opener);
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(opener).toHaveFocus();
    });
  });
});

describe("EpicsPage: live (WS-049 section 4)", () => {
  function send(type: ProjectEvent["type"], entity: string, version: number | null = 2) {
    act(() => {
      FakeSource.latest().send(type, {
        id: crypto.randomUUID(),
        type,
        projectId: opa.id,
        entity,
        entityId: launch.id,
        version,
        actorAccountId: "55555555-5555-4555-8555-555555555555",
        at: "2026-11-18T10:00:00.000Z",
      });
    });
  }

  async function renderLive() {
    const user = await renderEpics();
    act(() => {
      FakeSource.latest().open();
    });
    return user;
  }

  function reads(): number {
    return calls("GET").filter(([url]) => url.startsWith("/api/v1/projects/OPA/epics?")).length;
  }

  it("shows an epic created elsewhere", async () => {
    await renderLive();
    on(OPEN, page([launch, polish, epic(3, "Beta")]));

    send("epic.changed", "epic");

    expect(await screen.findByRole("button", { name: "Beta" })).toBeInTheDocument();
  });

  it("updates progress when a task changes", async () => {
    await renderLive();
    on(OPEN, page([{ ...launch, progress: { doneTasks: 3, totalTasks: 5 } }, polish]));

    send("task.moved", "task");

    expect(
      await within(rowOf("Launch")).findByRole("progressbar", { name: "3 of 5 tasks done" }),
    ).toBeInTheDocument();
  });

  it("reloads once for a burst of events, and once more after it", async () => {
    await renderLive();
    const before = reads();

    for (let i = 0; i < 5; i++) send("task.updated", "task");

    await waitFor(
      () => {
        expect(reads() - before).toBe(2);
      },
      { timeout: 2_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(reads() - before).toBe(2);
  });

  it("reads as many epics as are shown", async () => {
    on(OPEN, page([launch], "C2"));
    on(`${OPEN}&cursor=C2`, page([polish]));
    const user = await renderEpics();
    act(() => {
      FakeSource.latest().open();
    });
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByRole("button", { name: "Polish" });
    on(`${OPEN}&cursor=C2`, page([{ ...polish, title: "Polish, renamed" }]));

    send("epic.changed", "epic");

    expect(await screen.findByRole("button", { name: "Polish, renamed" })).toBeInTheDocument();
  });

  it("keeps an open epic's dialog when it leaves the list elsewhere", async () => {
    const user = await renderLive();
    const dialog = await openEpic(user, "Launch");
    on(OPEN, page([polish]));

    send("epic.changed", "epic");

    await waitFor(() => {
      expect(reads()).toBeGreaterThan(1);
    });
    expect(dialog).toBeVisible();
  });

  it("reloads after a reconnect", async () => {
    await renderLive();
    on(OPEN, page([launch, polish, epic(4, "Missed")]));

    act(() => {
      FakeSource.latest().drop();
      FakeSource.latest().open();
    });

    expect(await screen.findByRole("button", { name: "Missed" })).toBeInTheDocument();
  });
});
